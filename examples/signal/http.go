package signal

import (
	"fmt"
	"github.com/pion/rtcp"
	"github.com/pion/webrtc/v2"
	"io"
	"io/ioutil"
	"net/http"
	"time"
)

const (
	rtcpPLIInterval = time.Second * 3
	numRoom         = 10
)

type Room struct {
	Id         int
	Streamer   *webrtc.PeerConnection
	LocalTrack *webrtc.Track
}

var roomId = 0
var config = webrtc.Configuration{
	ICEServers: []webrtc.ICEServer{
		{
			URLs: []string{"stun:stun.l.google.com:19302"},
		},
	},
}

type Hub struct {
	Creator  chan *Creator
	Joiner   chan *webrtc.PeerConnection
	Rooms    map[string]*Room
	Response chan string
}

type Client struct {
	Hub *Hub
}

func NewHub() *Hub {
	return &Hub{
		Creator:  make(chan *Creator),
		Joiner:   make(chan *webrtc.PeerConnection),
		Rooms:    make(map[string]*Room),
		Response: make(chan string),
	}
}

func (h *Hub) Run() {
	for {
		select {
		case creator := <-h.Creator:
			roomId = roomId + 1
			fmt.Println("listen local track")
			localTrack := <-creator.LocalTrack
			h.Rooms[string(roomId)] = &Room{
				Id:         roomId,
				Streamer:   creator.PeerConnection,
				LocalTrack: localTrack,
			}
			fmt.Println("created room " + string(roomId))
		}
	}
}

func (h *Hub) JoinLive(api *webrtc.API, roomId int, sdp []byte) string {
	room := h.Rooms[string(roomId)]
	if room == nil {
		return ""
	}
	recvOnlyOffer := webrtc.SessionDescription{}
	Decode(sdp, &recvOnlyOffer)

	// Create a new PeerConnection
	peerConnection, err := api.NewPeerConnection(config)
	if err != nil {
		panic(err)
	}
	_, err = peerConnection.AddTrack(room.LocalTrack)
	if err != nil {
		panic(err)
	}
	// Set the remote SessionDescription
	err = peerConnection.SetRemoteDescription(recvOnlyOffer)
	if err != nil {
		panic(err)
	}
	// Create answer
	answer, err := peerConnection.CreateAnswer(nil)
	if err != nil {
		panic(err)
	}
	// Sets the LocalDescription, and starts our UDP listeners
	err = peerConnection.SetLocalDescription(answer)
	if err != nil {
		panic(err)
	}
	// Get the LocalDescription and take it to base64 so we can paste in browser
	return Encode(answer)
}

func (h *Hub) CreateLive(api *webrtc.API, sdp []byte) string {
	offer := webrtc.SessionDescription{}
	Decode(sdp, &offer)

	// Create a new RTCPeerConnection
	pc, err := api.NewPeerConnection(webrtc.Configuration{
		ICEServers: []webrtc.ICEServer{
			{
				URLs: []string{"stun:stun.l.google.com:19302"},
			},
		},
	})
	if err != nil {
		panic(err)
	}

	// Allow us to receive 1 video track
	if _, err = pc.AddTransceiver(webrtc.RTPCodecTypeVideo); err != nil {
		panic(err)
	}
	localTrackChan := make(chan *webrtc.Track)
	// Set a handler for when a new remote track starts, this just distributes all our packets
	// to connected peers
	pc.OnTrack(func(remoteTrack *webrtc.Track, receiver *webrtc.RTPReceiver) {
		// Send a PLI on an interval so that the publisher is pushing a keyframe every rtcpPLIInterval
		// This can be less wasteful by processing incoming RTCP events, then we would emit a NACK/PLI when a viewer requests it
		go func() {
			ticker := time.NewTicker(rtcpPLIInterval)
			for range ticker.C {
				if rtcpSendErr := pc.WriteRTCP([]rtcp.Packet{&rtcp.PictureLossIndication{MediaSSRC: remoteTrack.SSRC()}}); rtcpSendErr != nil {
					fmt.Println(rtcpSendErr)
				}
			}
		}()
		// Create a local track, all our SFU clients will be fed via this track
		localTrack, newTrackErr := pc.NewTrack(remoteTrack.PayloadType(), remoteTrack.SSRC(), "video", "pion")
		if newTrackErr != nil {
			panic(newTrackErr)
		}
		localTrackChan <- localTrack
		rtpBuf := make([]byte, 1400)
		for {
			i, readErr := remoteTrack.Read(rtpBuf)
			if readErr != nil {
				panic(readErr)
			}
			// ErrClosedPipe means we don't have any subscribers, this is ok if no peers have connected yet
			if _, err = localTrack.Write(rtpBuf[:i]); err != nil && err != io.ErrClosedPipe {
				panic(err)
			}
		}
	})
	// Set the remote SessionDescription
	err = pc.SetRemoteDescription(offer)
	if err != nil {
		panic(err)
	}
	// Create answer
	answer, err := pc.CreateAnswer(nil)
	if err != nil {
		panic(err)
	}
	// Sets the LocalDescription, and starts our UDP listeners
	err = pc.SetLocalDescription(answer)
	if err != nil {
		panic(err)
	}
	h.Creator <- &Creator{
		LocalTrack:     localTrackChan,
		PeerConnection: pc,
	}
	fmt.Println("response answer")
	return Encode(answer)
}

type Creator struct {
	PeerConnection *webrtc.PeerConnection
	LocalTrack     chan *webrtc.Track
}

// HTTPSDPServer starts a HTTP Server that consumes SDPs
func HTTPSDPServer() {
	hub := NewHub()
	go hub.Run()

	m := webrtc.MediaEngine{}
	// Setup the codecs you want to use.
	// Only support VP8, this makes our proxying code simpler
	m.RegisterCodec(webrtc.NewRTPVP8Codec(webrtc.DefaultPayloadTypeVP8, 90000))
	// Create the API object with the MediaEngine
	api := webrtc.NewAPI(webrtc.WithMediaEngine(m))
	webDir := http.Dir("examples/p2p/sfu-minimal/dist")
	fs := http.FileServer(webDir)
	http.Handle("/", fs)
	http.HandleFunc("/join", func(w http.ResponseWriter, r *http.Request) {
		body, _ := ioutil.ReadAll(r.Body)
		res := hub.JoinLive(api, roomId, body)
		fmt.Println("join")
		defer func() {
			r.Body.Close()
		}()
		_, _ = io.WriteString(w, res)
	})
	http.HandleFunc("/create", func(w http.ResponseWriter, r *http.Request) {
		body, _ := ioutil.ReadAll(r.Body)
		defer func() {
			r.Body.Close()
		}()
		res := hub.CreateLive(api, body)
		_, _ = io.WriteString(w, res)
	})

	err := http.ListenAndServe(":9090", nil)
	if err != nil {
		panic(err)
	}
}
