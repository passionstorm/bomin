package signal

import (
	"errors"
	"fmt"
	"github.com/pion/rtcp"
	"github.com/pion/webrtc/v2"
	"io"
	"sync"
	"time"
)

const (
	recorder = false
)

type Room struct {
	Id         int
	Streamer   *webrtc.PeerConnection
	VideoTrack *webrtc.Track
	AudioTrack *webrtc.Track
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

var (
	videoTrackLock = sync.RWMutex{}
	audioTrackLock = sync.RWMutex{}
)

type Client struct {
	Hub *Hub
}

type Creator struct {
	VideoTrack     chan *webrtc.Track
	AudioTrack     chan *webrtc.Track
	PeerConnection *webrtc.PeerConnection
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
			vTrack, aTrack := <-creator.VideoTrack, <-creator.AudioTrack
			h.Rooms[string(roomId)] = &Room{
				Id:         roomId,
				Streamer:   creator.PeerConnection,
				VideoTrack: vTrack,
				AudioTrack: aTrack,
			}
			fmt.Println("created room " + string(roomId))
		}
	}
}

func (h *Hub) JoinLive(api *webrtc.API, roomId int, sdp []byte) string {
	defer func() {
		if e := recover(); e != nil {
			errString := fmt.Sprintf("FLVWriter has already been closed:%v", e)
			err := errors.New(errString)
			checkError(err)
		}
	}()
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
	// Waiting for publisher track finish
	for {
		videoTrackLock.RLock()
		if room.VideoTrack == nil {
			videoTrackLock.RUnlock()
			//if videoTrack == nil, waiting..
			time.Sleep(100 * time.Millisecond)
		} else {
			videoTrackLock.RUnlock()
			break
		}
	}
	//add track video
	//videoTrackLock.RLock()
	_, err = peerConnection.AddTrack(room.VideoTrack)
	//videoTrackLock.RUnlock()
	checkError(err)
	//add track audio
	//audioTrackLock.RLock()
	_, err = peerConnection.AddTrack(room.AudioTrack)
	//audioTrackLock.RUnlock()
	checkError(err)
	// Set the remote SessionDescription
	err = peerConnection.SetRemoteDescription(recvOnlyOffer)
	checkError(err)
	// Create answer
	answer, err := peerConnection.CreateAnswer(nil)
	checkError(err)
	// Sets the LocalDescription, and starts our UDP listeners
	err = peerConnection.SetLocalDescription(answer)
	checkError(err)
	// Get the LocalDescription and take it to base64 so we can paste in browser
	return Encode(answer)
}

func checkError(err error) {
	if err != nil {
		panic(err)
	}
}

func TrackVideo(room *Room, pc *webrtc.PeerConnection, track *webrtc.Track) {
	var err error
	fmt.Println(track.PayloadType())
	videoTrackLock.Lock()
	room.VideoTrack, err = pc.NewTrack(track.PayloadType(), track.SSRC(), "video", "bomin")
	videoTrackLock.Unlock()
	checkError(err)
	go func() {
		ticker := time.NewTicker(3 * time.Second)
		for range ticker.C {
			if rtcpSendErr := pc.WriteRTCP([]rtcp.Packet{&rtcp.PictureLossIndication{MediaSSRC: track.SSRC()}}); rtcpSendErr != nil {
				fmt.Println(rtcpSendErr)
			}
		}
	}()
	rtpBuf := make([]byte, 1400)
	for {
		i, readErr := track.Read(rtpBuf)
		checkError(readErr)
		videoTrackLock.RLock()
		_, err = room.VideoTrack.Write(rtpBuf[:i])
		videoTrackLock.RUnlock()
		if err != nil && err != io.ErrClosedPipe {
			panic(err)
		}
	}
}

func TrackAudio(room *Room, pc *webrtc.PeerConnection, track *webrtc.Track) {
	var err error
	audioTrackLock.Lock()
	room.AudioTrack, err = pc.NewTrack(track.PayloadType(), track.SSRC(), "audio", "bomin")
	audioTrackLock.Unlock()
	checkError(err)
	rtpBuf := make([]byte, 1400)
	for {
		i, err := track.Read(rtpBuf)
		checkError(err)
		audioTrackLock.RLock()
		_, err = room.AudioTrack.Write(rtpBuf[:i])
		audioTrackLock.RUnlock()
		if err != nil && err != io.ErrClosedPipe {
			checkError(err)
		}
	}
}

func (h *Hub) CreateLive(api *webrtc.API, sdp []byte) string {
	defer func() {
		if e := recover(); e != nil {
			errString := fmt.Sprintf("FLVWriter has already been closed:%v", e)
			err := errors.New(errString)
			checkError(err)
		}
	}()
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
	checkError(err)
	// Allow us to receive 1 audio track, and 1 video track
	_, err = pc.AddTransceiver(webrtc.RTPCodecTypeAudio)
	checkError(err)
	_, err = pc.AddTransceiver(webrtc.RTPCodecTypeVideo)
	checkError(err)
	roomId = roomId + 1
	newRoom := &Room{
		Id:       roomId,
		Streamer: pc,
	}
	h.Rooms[string(roomId)] = newRoom
	// Set a handler for when a new remote track starts, this just distributes all our packets
	// to connected peers
	pc.OnTrack(func(track *webrtc.Track, receiver *webrtc.RTPReceiver) {
		// Send a PLI on an interval so that the publisher is pushing a keyframe every rtcpPLIInterval
		// This can be less wasteful by processing incoming RTCP events, then we would emit a NACK/PLI when a viewer requests it
		payloadType := track.PayloadType()
		//track video
		if payloadType == webrtc.DefaultPayloadTypeVP8 || payloadType == webrtc.DefaultPayloadTypeH264 {
			TrackVideo(newRoom, pc, track)
		} else if payloadType == webrtc.DefaultPayloadTypeOpus {
			TrackAudio(newRoom, pc, track)
		}
	})
	// Set the handler for ICE connection state
	// This will notify you when the peer has connected/disconnected

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

	fmt.Println("response answer")
	return Encode(answer)
}
