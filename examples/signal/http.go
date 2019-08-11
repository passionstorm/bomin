package signal

import (
	"fmt"
	"github.com/pion/webrtc/v2"
	"io"
	"io/ioutil"
	"net/http"
)

func GetMediaAPI() *webrtc.API {
	m := webrtc.MediaEngine{}
	//m.RegisterCodec(webrtc.NewRTPOpusCodec(webrtc.DefaultPayloadTypeOpus, 48000))
	//m.RegisterCodec(webrtc.NewRTPVP8Codec(webrtc.DefaultPayloadTypeVP8, 90000))
	m.RegisterDefaultCodecs()
	return webrtc.NewAPI(webrtc.WithMediaEngine(m))
}

// HTTPSDPServer starts a HTTP Server that consumes SDPs
func HTTPSDPServer() {
	hub := NewHub()
	go hub.Run()
	api := GetMediaAPI()
	webDir := http.Dir("examples/p2p/sfu-minimal/dist")
	fs := http.FileServer(webDir)
	http.Handle("/", fs)
	http.HandleFunc("/join", func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			r.Body.Close()
		}()

		body, _ := ioutil.ReadAll(r.Body)
		res := hub.JoinLive(api, roomId, body)
		fmt.Println("join")
		_, _ = io.WriteString(w, res)
	})
	http.HandleFunc("/create", func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			r.Body.Close()
		}()
		body, _ := ioutil.ReadAll(r.Body)
		res := hub.CreateLive(api, body)
		_, _ = io.WriteString(w, res)
	})
	err := http.ListenAndServeTLS(":9090", "cert.pem", "key.pem", nil)
	if err != nil {
		panic(err)
	}
}
