package ivfwriter

import (
	"encoding/binary"
	"fmt"
	"github.com/pion/rtp"
	"github.com/pion/rtp/codecs"
	"io"
	"os"
)

const (
	headerLen   = 11
	maxQueueNum = 5
)

// IVFWriter is used to take RTP packets and write them to an IVF on disk
// maxLate determines how long we should wait until we get a valid Sample
// The larger the value the less packet loss you will see, but higher latency
type IVFWriter struct {
	stream       io.Writer
	fd           *os.File
	frameCount uint64
	currentFrame []byte

	packetQueue chan *rtp.Packet

	// Interface that allows us to take RTP packets to samples
	depacketizer rtp.Depacketizer
	maxLate      uint16
	buffer       [65536]*rtp.Packet
	lastPush     uint16

	// Last seqnum that has been successfully popped
	// isContiguous is false when we start or when we have a gap
	// that is older then maxLate
	isContiguous     bool
	lastPopSeq       uint16
	lastPopTimestamp uint64
	firstTimestamp uint64
}

// New builds a new IVF writer
func New(fileName string) (*IVFWriter, error) {
	f, err := os.Create(fileName)
	if err != nil {
		return nil, err
	}
	writer, err := NewWith(f)
	if err != nil {
		return nil, err
	}
	writer.fd = f
	return writer, nil
}

// NewWith initialize a new IVF writer with an io.Writer output
func NewWith(out io.Writer) (*IVFWriter, error) {
	if out == nil {
		return nil, fmt.Errorf("file not opened")
	}

	writer := &IVFWriter{
		stream:      out,
		packetQueue: make(chan *rtp.Packet, maxQueueNum),
		maxLate:     512,
	}
	if err := writer.writeHeader(); err != nil {
		return nil, err
	}

	return writer, nil
}

func (i *IVFWriter) Push(p *rtp.Packet) {
	i.buffer[p.SequenceNumber] = p
	i.lastPush = p.SequenceNumber
	i.buffer[p.SequenceNumber-i.maxLate] = nil
}

/*
	https://wiki.multimedia.cx/index.php/IVF

	IVF is a simple file format that transports raw VP8 data.
	Multi-byte numbers of little-endian. An IVF file begins with a 32-byte header:

	bytes 0-3    signature: 'DKIF'
	bytes 4-5    version (should be 0)
	bytes 6-7    length of header in bytes
	bytes 8-11   codec FourCC (e.g., 'VP80')
	bytes 12-13  width in pixels
	bytes 14-15  height in pixels
	bytes 16-19  frame rate
	bytes 20-23  time scale
	bytes 24-27  number of frames in file
	bytes 28-31  unused

	The header is followed by a series of frames. Each frame consists of a 12-byte header followed by data:

	bytes 0-3    size of frame in bytes (not including the 12-byte header)
	bytes 4-11   64-bit presentation timestamp
	bytes 12..   frame data
*/

func (i *IVFWriter) writeHeader() error {
	header := make([]byte, 32)
	copy(header[0:3], []byte("DKIF"))                 //  signature: 'DKIF'
	binary.LittleEndian.PutUint16(header[4:], 0)     // version (should be 0)
	binary.LittleEndian.PutUint16(header[6:], 32)    // length of header in bytes
	copy(header[8:11], []byte("VP80"))                // codec FourCC (e.g., 'VP80')
	binary.LittleEndian.PutUint16(header[12:], 640) // width in pixels
	binary.LittleEndian.PutUint16(header[14:], 480) // height in pixels
	binary.LittleEndian.PutUint32(header[16:], 30)  // frame rate
	binary.LittleEndian.PutUint32(header[20:], 1)     // time scale
	binary.LittleEndian.PutUint32(header[24:], 900)   // Frame count, will be updated on first Close() call
	binary.LittleEndian.PutUint32(header[28:], 0)     // Unused

	_, err := i.stream.Write(header)
	return err
}

func (i *IVFWriter) Pop(packet chan *rtp.Packet) {
	for i := 0; i < maxQueueNum; i++ {
		tmpPkt, ok := <-packet
		if ok {
			packet <- tmpPkt
		}

		<-packet
	}

	defer func() {
		if e := recover(); e != nil {
			fmt.Println("FLVWriter has already been closed:%v", e)
		}
	}()
}

// WriteRTP adds a new packet and writes the appropriate headers for it
func (i *IVFWriter) WriteRTP(packet *rtp.Packet) error {
	if i.stream == nil {
		return fmt.Errorf("file not opened")
	}
	if !packet.Marker {
		return nil
	}
	if len(i.currentFrame) == 0 {
		return nil
	}
	vp8Packet := codecs.VP8Packet{}
	if _, err := vp8Packet.Unmarshal(packet.Payload); err != nil {
		return err
	}
	i.currentFrame = append(i.currentFrame, vp8Packet.Payload[0:]...)
	frameHeader := make([]byte, 12)
	binary.LittleEndian.PutUint32(frameHeader[0:], uint32(len(i.currentFrame))) // Frame length
	binary.LittleEndian.PutUint64(frameHeader[4:], i.frameCount)                     // PTS
	i.frameCount++
	if _, err := i.stream.Write(frameHeader); err != nil {
		return err
	}
	if _, err := i.stream.Write(i.currentFrame); err != nil {
		return err
	}

	i.currentFrame = nil
	return nil

}

// Close stops the recording
func (i *IVFWriter) Close() error {
	defer func() {
		i.fd = nil
		i.stream = nil
	}()
	if i.fd == nil {
		// Returns no error as it may be convenient to call
		// Close() multiple times
		return nil
	}
	/*
		bytes 16-19  frame rate
		bytes 20-23  time scale
		bytes 24-27  number of frames in file
	*/
	// Update the framerate
	if _, err := i.fd.Seek(24, 0); err != nil {
		return err
	}
	buff := make([]byte, 4)
	binary.LittleEndian.PutUint32(buff, uint32(i.frameCount))
	if _, err := i.fd.Write(buff); err != nil {
		return err
	}

	return i.fd.Close()
}
