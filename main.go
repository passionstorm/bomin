package main

import (
	"bomin/protocol/hls"
	"bomin/protocol/httpflv"
	"bomin/protocol/httpopera"
	"bomin/protocol/rtmp"
	"bomin/protocol/websocket"
	"bomin/utils/network"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
)

var (
	version        = "master"
	rtmpAddr       = flag.String("rtmp-addr", ":1935", "RTMP server listen address")
	httpFlvAddr    = flag.String("httpflv-addr", ":7001", "HTTP-FLV server listen address")
	hlsAddr        = flag.String("hls-addr", ":7002", "HLS server listen address")
	operaAddr      = flag.String("manage-addr", ":8090", "HTTP manage interface server listen address")
	configfilename = flag.String("cfgfile", "livego.cfg", "live configure filename")
	webAddr = flag.String("addr", ":443", "http service address")
)

func init() {
	log.SetFlags(log.Lshortfile | log.Ltime | log.Ldate)
	flag.Parse()
}

func startHls() *hls.Server {
	hlsListen, err := net.Listen("tcp", *hlsAddr)
	if err != nil {
		log.Fatal(err)
	}

	hlsServer := hls.NewServer()
	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Println("HLS server panic: ", r)
			}
		}()
		log.Println("HLS listen On", *hlsAddr)
		hlsServer.Serve(hlsListen)
	}()
	return hlsServer
}

func startRtmp(stream *rtmp.RtmpStream, hlsServer *hls.Server) {
	rtmpListen, err := net.Listen("tcp", *rtmpAddr)
	if err != nil {
		log.Fatal(err)
	}

	var rtmpServer *rtmp.Server

	if hlsServer == nil {
		rtmpServer = rtmp.NewRtmpServer(stream, nil)
		log.Printf("hls server disable....")
	} else {
		rtmpServer = rtmp.NewRtmpServer(stream, hlsServer)
		log.Printf("hls server enable....")
	}

	defer func() {
		if r := recover(); r != nil {
			log.Println("RTMP server panic: ", r)
		}
	}()
	log.Println("RTMP Listen On", *rtmpAddr)
	rtmpServer.Serve(rtmpListen)
}

func startHTTPFlv(stream *rtmp.RtmpStream) {
	flvListen, err := net.Listen("tcp", *httpFlvAddr)
	if err != nil {
		log.Fatal(err)
	}

	hdlServer := httpflv.NewServer(stream)
	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Println("HTTP-FLV server panic: ", r)
			}
		}()
		log.Println("HTTP-FLV listen On", *httpFlvAddr)
		hdlServer.Serve(flvListen)
	}()
}

func startHTTPOpera(stream *rtmp.RtmpStream) {
	if *operaAddr != "" {
		opListen, err := net.Listen("tcp", *operaAddr)
		if err != nil {
			log.Fatal(err)
		}
		opServer := httpopera.NewServer(stream, *rtmpAddr)
		go func() {
			defer func() {
				if r := recover(); r != nil {
					log.Println("HTTP-Operation server panic: ", r)
				}
			}()
			log.Println("HTTP-Operation listen On", *operaAddr)
			opServer.Serve(opListen)
		}()
	}
}



func startHTTPSWeb() {
	//webDir := http.Dir("demo")
	webDir := http.Dir("demo_p2p")
	fs := http.FileServer(webDir)
	hub := websocket.NewHub()
	go hub.Run()
	http.Handle("/", fs)
	http.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		websocket.ServeWs(hub, w, r)
	})

	// Create a CA certificate pool and add cert.pem to it
	//caCert, err := ioutil.ReadFile("tls/cert.pem")
	//if err != nil {
	//	log.Fatal(err)
	//}
	//caCertPool := x509.NewCertPool()
	//caCertPool.AppendCertsFromPEM(caCert)
	//
	//// Create the TLS Config with the CA pool and enable Client certificate validation
	//tlsConfig := &tls.Config{
	//	ClientCAs: caCertPool,
	//	ClientAuth: tls.RequireAndVerifyClientCert,
	//}
	//tlsConfig.BuildNameToCertificate()

	// Create a Server instance to listen on port 8443 with the TLS config
	//server := &http.Server{
	//	Addr:      ":443",
	//	//TLSConfig: tlsConfig,
	//}

	go func() {
		err := http.ListenAndServe(":80", nil)
		//err := http.ListenAndServeTLS(":443","cert.pem", "key.pem",nil)
		//err := http.ListenAndServeTLS(":443", "/usr/local/share/ca-certificates/public.pem", "/usr/local/share/ca-certificates/private.key", nil)
		if err != nil {
			log.Println(err)
		}
	}()
}



func main() {
	stream := rtmp.NewRtmpStream()
	fmt.Println(network.GetOutboundIP())
	//hlsServer := startHls()
	//startHTTPFlv(stream)
	startHTTPSWeb()
	//startRtmp(stream, hlsServer)
	startRtmp(stream, nil)
}
