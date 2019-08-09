package media

import (
	"bomin/media/ivfwriter"
	"bomin/media/opuswriter"
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v2"
)

// Sample contains media, and the amount of samples in it
type Sample struct {
	Data    []byte
	Samples uint32
}

// Writer defines an interface to handle
// the creation of media files
type Writer interface {
	// Add the content of an RTP packet to the media
	WriteRTP(packet *rtp.Packet) error
	// Close the media
	// Note: Close implementation must be idempotent
	Close() error
}

type Disk struct {
}

func (m *Disk) SaveToDisk(w Writer, track *webrtc.Track) {
	defer func() {
		if err := w.Close(); err != nil {
			panic(err)
		}
	}()
	for {
		rtpPacket, err := track.ReadRTP()
		if err != nil {
			panic(err)
		}
		if err := w.WriteRTP(rtpPacket); err != nil {
			panic(err)
		}
	}
}

func (m *Disk) Recorder() (*opuswriter.OpusWriter, *ivfwriter.IVFWriter) {
	opusFile, err := opuswriter.New("output.opus", 48000, 2)
	if err != nil {
		panic(err)
	}
	ivfFile, err := ivfwriter.New("output.ivf")
	if err != nil {
		panic(err)
	}

	return opusFile, ivfFile
}
