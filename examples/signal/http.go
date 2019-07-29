package signal

import (
	"flag"
	"net/http"
	"strconv"
)

// HTTPSDPServer starts a HTTP Server that consumes SDPs
func HTTPSDPServer() (chan string, chan string) {
	port := flag.Int("port", 9090, "http server port")
	flag.Parse()
	sdpChan := make(chan string)
	answer := make(chan string)
	webDir := http.Dir("examples/p2p/sfu-minimal/dist")
	fs := http.FileServer(webDir)
	http.Handle("/", fs)
	http.HandleFunc("/sdp", func(w http.ResponseWriter, r *http.Request) {
		body := r.FormValue("sdp")
		sdpChan <- body
		w.Write([]byte(<-answer))
	})

	go func() {
		err := http.ListenAndServe(":"+strconv.Itoa(*port), nil)
		if err != nil {
			panic(err)
		}
	}()

	return sdpChan, answer
}
