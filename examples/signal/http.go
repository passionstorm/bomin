package signal

import (
	"flag"
	"fmt"
	"io"
	"io/ioutil"
	"net/http"
	"strconv"
)

// HTTPSDPServer starts a HTTP Server that consumes SDPs
func HTTPSDPServer() (chan []byte, chan string) {
	port := flag.Int("port", 9090, "http server port")
	flag.Parse()
	sdpChan := make(chan []byte)
	answerChan := make(chan string)
	webDir := http.Dir("examples/p2p/sfu-minimal/dist")
	fs := http.FileServer(webDir)
	http.Handle("/", fs)
	http.HandleFunc("/sdp", func(w http.ResponseWriter, r *http.Request) {
		body, _ := ioutil.ReadAll(r.Body)
		fmt.Printf(string(body))
		defer r.Body.Close()
		sdpChan <- body
		io.WriteString(w, <-answerChan)
	})

	go func() {
		err := http.ListenAndServe(":"+strconv.Itoa(*port), nil)
		if err != nil {
			panic(err)
		}
	}()

	return sdpChan, answerChan
}
