package main

import (
	"bomin/examples/signal"
	"bomin/utils/network"
	"fmt"
)

func main() {
	fmt.Printf(network.GetOutboundIP())
	signal.HTTPSDPServer()

}
