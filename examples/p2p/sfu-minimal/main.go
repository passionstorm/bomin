package main

import (
	"bomin/examples/signal"
	"time"
)

const (
	rtcpPLIInterval = time.Second * 3
)

func main() {
	signal.HTTPSDPServer()

}
