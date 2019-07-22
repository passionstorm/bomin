package websocket

import (
	"bomin/utils/uid"
	"encoding/json"
	"fmt"
	"github.com/gorilla/websocket"
	"log"
	"net/http"
	"time"
)

const (
	// Time allowed to write a message to the peer.
	writeWait = 60 * time.Second
	// Time allowed to read the next pong message from the peer.
	pongWait = 60 * time.Second
	// Send pings to peer with this period. Must be less than pongWait.
	pingPeriod = (pongWait * 9) / 10
	// Maximum message size allowed from peer.
	maxMessageSize = 65535
)

var (
	newline = []byte{'\n'}
	space   = []byte{' '}
	rooms   []*Room
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
}

type Room struct {
	Admin   string
	Name    string
	Clients []*Client
}

func (r *Room) removeClient(id string) {
	for i, client := range r.Clients {
		if client.id == id {
			r.Clients[i] = r.Clients[len(r.Clients)-1]
			r.Clients[len(r.Clients)-1] = nil
			r.Clients = r.Clients[:len(r.Clients)-1]
			return
		}
	}
}

// Client is a middleman between the websocket connection and the hub.
type Client struct {
	id   string
	hub  *Hub
	Room *Room
	// The websocket connection.
	conn          *websocket.Conn
	// Buffered channel of outbound messages.
	send chan []byte
}

func remove(s []int, i int) []int {
	s[len(s)-1], s[i] = s[i], s[len(s)-1]
	return s[:len(s)-1]
}

type RequestData struct {
	Sdp       map[string]string `json:"sdp"`
	Label     int               `json:"label"`
	SocketId  string            `json:"socketId"`
	Candidate interface{}       `json:"candidate"`
}

type Signal struct {
	EventName string      `json:"event_name"`
	Data      RequestData `json:"data"`
}

func (c *Client) sendMessage(msg []byte) {
	w, err := c.conn.NextWriter(websocket.TextMessage)
	if err != nil {
		fmt.Println(err)
		return
	}
	w.Write(msg)
	if err := w.Close(); err != nil {
		return
	}
}

func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()
	c.conn.SetReadLimit(maxMessageSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error { c.conn.SetReadDeadline(time.Now().Add(pongWait)); return nil })
	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("error: %v", err)
			}
			break
		}
		fmt.Println(string(message))
		signal := Signal{}
		_ = json.Unmarshal(message, &signal)
		switch event := signal.EventName; event {
		case "join_room":
			c.joinRoom()
			break
		case "send_offer":
			var targetId = signal.Data.SocketId
			var sdp = signal.Data.Sdp
			c.sendOffer(c.id, targetId, sdp)
			break
		case "send_answer":
			var targetId = signal.Data.SocketId
			var sdp = signal.Data.Sdp
			c.sendAnswer(targetId, sdp)
			break
		case "send_ice_candidate":
			c.sendIceCandidate(signal.Data.SocketId, signal.Data.Label, signal.Data.Candidate)
			break
		}
	}
}

func (c *Client) getClientById(id string) *Client {
	for k := range c.hub.clients {
		if k.id == id {
			return k
		}
	}
	return nil
}

func (c *Client) sendIceCandidate(socketId string, label int, candidate interface{}) {
	destination := c.getClientById(socketId)
	if destination != nil {
		m := map[string]interface{}{
			"event_name": "receive_ice_candidate",
			"data": map[string]interface{}{
				"label":     label,
				"candidate": candidate,
				"socketId":  socketId,
			},
		}

		msg, _ := json.Marshal(m)
		//fmt.Println(string(msg))
		destination.sendMessage(msg)
	}
}

func (c *Client) sendAnswer(targetId string, sdp map[string]string) {
	target := c.getClientById(targetId)
	if target != nil{
		m := map[string]interface{}{
			"event_name": "receive_answer",
			"data": map[string]interface{}{
				"sdp":      sdp,
				"socketId": targetId,
			},
		}
		msg, _ := json.Marshal(m)
		target.send <- msg
	}
}

func (c *Client) sendOffer(sourceId string, targetId string, sdp map[string]string) {
	target := c.getClientById(targetId)
	if target != nil {
		m := map[string]interface{}{
			"event_name": "receive_offer",
			"data": map[string]interface{}{
				"sdp":      sdp,
				"socketId": sourceId,
			},
		}
		msg, _ := json.Marshal(m)
		target.send <- msg
	}
}

func (c *Client) joinRoom() {
	var room *Room
	room = getRoom("room")
	c.Room = room
	if room == nil {
		room = &Room{Name: "room"}
		room.Clients = append(room.Clients, c)
		rooms = append(rooms, room)
	} else {
		room.Clients = append(room.Clients, c)
	}
	connections := make([]string, 0)
	if room != nil {
		// inform the peers that they have a new peer
		msgNewPeerConnected := map[string]interface{}{
			"event_name": "new_peer_connected",
			"data": map[string]interface{}{
				"socketId": c.id,
			},
		}
		msg1, _ := json.Marshal(msgNewPeerConnected)
		for _, i := range room.Clients {
			if i != nil {
				if i.id == c.id {
					continue
				}

				if err := i.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
					continue
				}
				connections = append(connections, i.id)
				i.send <- msg1
			}
		}
	}

	// send new peer a list of all prior peers
	msgGetPeers := map[string]interface{}{
		"event_name": "get_peers",
		"data": map[string]interface{}{
			"connections": connections,
			"you":         c.id,
		},
	}
	msg2, _ := json.Marshal(msgGetPeers)
	c.send <- msg2
}

func getRoom(name string) *Room {
	for _, r := range rooms {
		if r.Name == name {
			return r
		}
	}

	return nil
}

// writePump pumps messages from the hub to the websocket connection.
//
// A goroutine running writePump is started for each connection. The
// application ensures that there is at most one writer to a connection by
// executing all writes from this goroutine.
func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()
	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				// The hub closed the channel.
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := c.conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)

			// Add queued chat messages to the current websocket message.
			//n := len(c.send)
			//for i := 0; i < n; i++ {
			//	w.Write(newline)
			//	w.Write(<-c.send)
			//}

			if err := w.Close(); err != nil {
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// serveWs handles websocket requests from the peer.
func ServeWs(hub *Hub, w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println(err)
		return
	}
	client := &Client{
		id:  uid.NewId(),
		hub: hub, conn: conn, send: make(chan []byte, 256)}

	client.hub.register <- client
	// Allow collection of memory referenced by the caller by doing all work in
	// new goroutines.
	go client.writePump()
	go client.readPump()
}
