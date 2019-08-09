package ivfwriter

import (
	"encoding/binary"
	"fmt"
	"github.com/pion/rtp"
	"github.com/pion/rtp/codecs"
	"io"
	"log"
	"os"
)

const (
	headerLen   = 11
	maxQueueNum = 512
)

// IVFWriter is used to take RTP packets and write them to an IVF on disk
type IVFWriter struct {
	stream       io.Writer
	fd           *os.File
	count        uint64
	currentFrame []byte
	packetQueue  chan *rtp.Packet
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
	}
	if err := writer.writeHeader(); err != nil {
		return nil, err
	}
	go func() {
		err := writer.HandlePacket()
		if err != nil {
			log.Println("SendPacket error:", err)
		}
	}()

	return writer, nil
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
	copy(header[0:], []byte("DKIF"))                // DKIF
	binary.LittleEndian.PutUint16(header[4:], 0)    // Version
	binary.LittleEndian.PutUint16(header[6:], 32)   // Header Size
	copy(header[8:], []byte("VP80"))                // FOURCC
	binary.LittleEndian.PutUint16(header[12:], 640) // Version
	binary.LittleEndian.PutUint16(header[14:], 480) // Header Size
	binary.LittleEndian.PutUint32(header[16:], 30)  // Framerate numerator
	binary.LittleEndian.PutUint32(header[20:], 1)   // Framerate Denominator
	binary.LittleEndian.PutUint32(header[24:], 900) // Frame count, will be updated on first Close() call
	binary.LittleEndian.PutUint32(header[28:], 0)   // Unused

	_, err := i.stream.Write(header)
	return err
}

func (i *IVFWriter) HandlePacket() error {
	defer func() {
		if e := recover(); e != nil {
			fmt.Println("FLVWriter has already been closed:%v", e)
		}
	}()
	for {
		packet, ok := <-i.packetQueue
		if ok {
			vp8Packet := codecs.VP8Packet{}
			if _, err := vp8Packet.Unmarshal(packet.Payload); err != nil {
				return err
			}

			i.currentFrame = append(i.currentFrame, vp8Packet.Payload[0:]...)

			if !packet.Marker {
				return nil
			} else if len(i.currentFrame) == 0 {
				return nil
			}

			frameHeader := make([]byte, 12)
			binary.LittleEndian.PutUint32(frameHeader[0:], uint32(len(i.currentFrame))) // Frame length
			binary.LittleEndian.PutUint64(frameHeader[4:], i.count)                     // PTS

			i.count++

			if _, err := i.stream.Write(frameHeader); err != nil {
				return err
			} else if _, err := i.stream.Write(i.currentFrame); err != nil {
				return err
			}
			i.currentFrame = nil
		}
	}
}

func (i *IVFWriter) Pop(packet chan *rtp.Packet) {
	for i := 0; i < maxQueueNum; i++ {
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
	if len(i.packetQueue) >= maxQueueNum {
		i.Pop(i.packetQueue)
	} else {
		i.packetQueue <- packet
	}

	defer func() {
		if e := recover(); e != nil {
			 fmt.Println("FLVWriter has already been closed:%v", e)
		}
	}()
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
	// Update the framecount
	if _, err := i.fd.Seek(24, 0); err != nil {
		return err
	}
	buff := make([]byte, 4)
	binary.LittleEndian.PutUint32(buff, uint32(i.count))
	if _, err := i.fd.Write(buff); err != nil {
		return err
	}

	return i.fd.Close()
}
