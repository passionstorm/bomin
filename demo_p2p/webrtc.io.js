var PeerConnection = (window.PeerConnection || window.webkitPeerConnection00 || window.webkitRTCPeerConnection);
var URL = (window.URL || window.webkitURL);
var getUserMedia = navigator.webkitGetUserMedia;
var nativeRTCIceCandidate = window.RTCIceCandidate;
var nativeRTCSessionDescription = window.RTCSessionDescription; // order is very important: "RTCSessionDescription" defined in Nighly but useless

var sdpConstraints = {
    'OfferToReceiveAudio': 1,
    'OfferToReceiveVideo': 1
};

if (navigator.webkitGetUserMedia) {
    if (!webkitMediaStream.prototype.getVideoTracks) {
        webkitMediaStream.prototype.getVideoTracks = function () {
            return this.videoTracks;
        };
        webkitMediaStream.prototype.getAudioTracks = function () {
            return this.audioTracks;
        };
    }

    // New syntax of getXXXStreams method in M26.
    // if (!webkitRTCPeerConnection.prototype.getLocalStreams) {
    //     webkitRTCPeerConnection.prototype.getLocalStreams = function () {
    //         return this.localStreams;
    //     };
    //     webkitRTCPeerConnection.prototype.getRemoteStreams = function () {
    //         return this.remoteStreams;
    //     };
    // }
}

(function () {
    var rtc = this.rtc = {};
    // Toggle debug mode (console.log)
    rtc.debug = false;
    // Holds a connection to the server.
    rtc._socket = null;
    // Holds identity for the client.
    rtc._me = null;
    // Holds callbacks for certain events.
    rtc._events = {};
    rtc.on = function (eventName, callback) {
        rtc._events[eventName] = rtc._events[eventName] || [];
        rtc._events[eventName].push(callback);
    };
    rtc.fire = function (eventName, _) {
        var events = rtc._events[eventName];
        var args = Array.prototype.slice.call(arguments, 1);
        if (!events) {
            return;
        }
        for (var i = 0, len = events.length; i < len; i++) {
            events[i].apply(null, args);
        }
    };
    // Holds the STUN/ICE server to use for PeerConnections.
    rtc.SERVER = function () {
        return {
            "iceServers": [{
                "url": "stun:stun.l.google.com:19302"
            }]
        };
    };
    // Reference to the lone PeerConnection instance.
    rtc.peers = {};
    // Array of known peer socket ids
    rtc.connections = [];
    // Stream-related variables.
    rtc.streams = [];
    rtc.numStreams = 0;
    rtc.initializedStreams = 0;
    // Reference to the data channels
    rtc.dataChannels = {};
    // PeerConnection datachannel configuration
    rtc.dataChannelConfig = {
        "optional": [{
            "RtpDataChannels": true
        }, {
            "DtlsSrtpKeyAgreement": true
        }]
    };

    rtc.pc_constraints = {
        "optional": [{
            "DtlsSrtpKeyAgreement": true
        }]
    };


    // check whether data channel is supported.
    rtc.checkDataChannelSupport = function () {
        try {
            // raises exception if createDataChannel is not supported
            var pc = new PeerConnection(rtc.SERVER(), rtc.dataChannelConfig);
            var channel = pc.createDataChannel('supportCheck', {
                reliable: false
            });
            channel.close();
            return true;
        } catch (e) {
            return false;
        }
    };

    rtc.dataChannelSupport = rtc.checkDataChannelSupport();


    /**
     * Connects to the websocket server.
     */
    rtc.connect = function (server, room) {
        room = room || ""; // by default, join a room called the blank string
        rtc._socket = new WebSocket(server);

        rtc._socket.onopen = function () {

            rtc._socket.send(JSON.stringify({
                "event_name": "join_room",
                "data": {
                    "room": room
                }
            }));

            rtc._socket.onmessage = function (msg) {
                var str = msg.data;
                var json = JSON.parse(str);
                rtc.fire(json.event_name, json.data);
            };

            rtc._socket.onerror = function (err) {
                console.error('onerror');
                console.error(err);
            };

            rtc._socket.onclose = function (data) {
                console.log('close socket');
                var id = rtc._socket.id;
                //TODO create disconnect stream
                rtc.fire('disconnect stream', id);
                if (typeof (rtc.peers[id]) !== 'undefined')
                    rtc.peers[id].close();
                delete rtc.peers[id];
                delete rtc.dataChannels[id];
                delete rtc.connections[id];
            };

            rtc.on('get_peers', function (data) {
                console.log("get_peers start...");
                rtc.connections = data.connections;
                rtc._me = data.you;
                if (rtc.offerSent) { // 'ready' was fired before 'get_peers'
                    rtc.createPeerConnections();
                    rtc.addStreams();
                    rtc.addDataChannels();
                    rtc.sendOffers();
                } else {
                    // var pc = rtc.createPeer(rtc._me);
                    // pc.ontrack = rtc.onRemoteStream;
                }
            });

            rtc.on('receive_ice_candidate', function (data) {
                const peerId = data.target_id;
                console.log('receive_ice_candidate to:' + peerId);
                var candidate = new RTCIceCandidate({
                    sdpMLineIndex: data.candidate.sdpMLineIndex,
                    candidate: data.candidate.candidate
                });
                var peer = rtc.peers[peerId];
                if (!peer || !peer.remoteDescription) {
                    peer.addIceCandidate(candidate).then(null, err => {
                        console.error(data.socketId + ": addIceCandidate <" + err.message + ">")
                    });
                }
            });

            rtc.on('new_peer_connected', function (data) {
                var remoteId = data.target_id;
                console.log("new_peer_connected " + remoteId);
                rtc.connections.push(remoteId);
                delete rtc.offerSent;
                if(rtc.mediaStream){
                    const pc = rtc.createPeer(remoteId);
                    pc.addStream(rtc.mediaStream);
                    rtc.sendOffer(remoteId);
                }
            });

            rtc.on('remove_peer_connected', function (data) {
                var id = data.socketId;
                //TODO disconnect stream
                rtc.fire('disconnect stream', id);
                if (typeof (rtc.peers[id]) !== 'undefined')
                    rtc.peers[id].close();
                delete rtc.peers[id];
                delete rtc.dataChannels[id];
                delete rtc.connections[id];
            });

            rtc.on('receive_offer', function (data) {
                console.log('receive_offer from: ' + data.source_id + ' to: ' + data.target_id);
                rtc.receiveOffer(data.source_id, data.target_id, data.sdp);
            });

            rtc.on('receive_answer', function (data) {
                const peerId = data.source_id;
                console.log('receive_answer from: ' + peerId);
                const pc = rtc.peers[peerId];
                pc.setRemoteDescription(new nativeRTCSessionDescription(data.sdp)).then(() => {
                    console.log("  Connected to " + peerId);//debug
                });
            });
        };
    };

    rtc.onRemoteStream = function (stream) {
        var video = document.getElementById('remote');
        if (video.srcObject !== stream) {
            video.srcObject = stream;
            video.play();
            console.log('pc2 received remote stream');
        }
    };

    rtc.sendOffers = function () {
        for (var i = 0, len = rtc.connections.length; i < len; i++) {
            var socketId = rtc.connections[i];
            rtc.sendOffer(socketId);
        }
    };

    rtc.onClose = function (data) {
        rtc.on('close_stream', function () {
            rtc.fire('close_stream', data);
        });
    };

    rtc.createPeerConnections = function () {
        for (var i = 0; i < rtc.connections.length; i++) {
            rtc.createPeer(rtc.connections[i]);
        }
    };

    rtc.createPeer = function (remoteId) {
        var config = rtc.pc_constraints;
        if(rtc._me === remoteId) return;
        console.log('create peer connection');
        if (rtc.dataChannelSupport) config = rtc.dataChannelConfig;
        const pc = rtc.peers[remoteId] = new PeerConnection(rtc.SERVER(), config);
        pc.onicecandidate = function (event) {
            if (event.candidate) {
                rtc._socket.send(JSON.stringify({
                    "event_name": "send_ice_candidate",
                    "data": {
                        "label": event.candidate.sdpMLineIndex,
                        "candidate": event.candidate,
                        "socketId": remoteId
                    }
                }));
                console.log('send ice candidate to: ' + remoteId);
            }
        };
        var dontDuplicate = {};
        pc.ontrack = function(event){
            console.log('on track');
            var remoteMediaStream = event.streams[0];

            if(dontDuplicate[remoteMediaStream.id]) return;
            dontDuplicate[remoteMediaStream.id] = true;

            rtc.onRemoteStream(remoteMediaStream)
        };
        console.log(pc.addTrack);
        pc.onopen = function () {
            rtc.fire('peer connection opened');
        };
        pc.onaddstream = function (event) {
            console.log('onaddstream');
            var remoteVideo = document.getElementById('remote');
            remoteVideo.srcObject = event.stream;
            remoteVideo.play();
            // rtc.waitUntilRemoteStreamStartsFlowing(remoteVideo);
        };

        if (rtc.dataChannelSupport) {
            pc.ondatachannel = function (evt) {
                if (rtc.debug) console.log('data channel connecting ' + remoteId);
                rtc.addDataChannel(remoteId, evt.channel);
            };
        }



        return pc;
    };

    rtc.waitUntilRemoteStreamStartsFlowing = function (remoteVideo) {
        if (!(remoteVideo.readyState <= HTMLMediaElement.HAVE_CURRENT_DATA
            || remoteVideo.paused || remoteVideo.currentTime <= 0)) {
            console.log('play remote video');
            remoteVideo.play();
        } else setTimeout(rtc.waitUntilRemoteStreamStartsFlowing, 50);
    };

    rtc.sendOffer = function (remoteId) {
        console.log('send offer to: ' + remoteId);
        var pc = rtc.peers[remoteId];
        pc.createOffer(sdpConstraints).then(d => {
            d.sdp = preferOpus(d.sdp);
            pc.setLocalDescription(d).then(() => {
                rtc._socket.send(JSON.stringify({
                    "event_name": "send_offer",
                    "data": {
                        "socketId": remoteId,
                        "sdp": d
                    }
                }));
            });
        }, null);
    };

    rtc.receiveOffer = function (sourceId, targetId, offerSDP) {
        var pc = rtc.peers[targetId] = new PeerConnection(sdpConstraints);
        var rtcSession = new RTCSessionDescription(offerSDP);
        //send answer
        pc.setRemoteDescription(rtcSession).then(() => {
                pc.createAnswer(sdpConstraints).then(des => {
                        pc.setLocalDescription(des).then(() => {
                                rtc._socket.send(JSON.stringify({
                                    "event_name": "send_answer",
                                    "data": {
                                        "socketId": sourceId,
                                        'type': 'answer',
                                        "sdp": des
                                    }
                                }));
                            }, err => {
                                console.error(err)
                            }
                        )
                    }, err => {
                        console.error(err)
                    }
                )
            }, err => {
                console.error(err)
            }
        );
    };

    rtc.createStream = function (opt, onSuccess, onFail) {
        var options;
        onSuccess = onSuccess || function () {
        };
        onFail = onFail || function () {
        };

        options = {
            video: !!opt.video,
            audio: !!opt.audio
        };
        if (getUserMedia) {
            rtc.numStreams++;
            getUserMedia.call(navigator, options, function (stream) {
                rtc.streams.push(stream);
                rtc.initializedStreams++;
                onSuccess(stream);
                if (rtc.initializedStreams === rtc.numStreams) {
                    rtc.fire('ready');
                }
            }, function (error) {
                alert("Could not connect stream.");
                onFail(error);
            });
        } else {
            alert('webRTC is not yet supported in this browser.');
        }
        // const videoLocal = document.getElementById('source');
        // var stream = videoLocal.captureStream();
        // var track = stream.getVideoTracks()[0];
        // track.enabled = true;
        // rtc.numStreams++;
        // rtc.streams.push(stream);
        // rtc.initializedStreams++;
        // onSuccess(stream);
        // if (rtc.initializedStreams === rtc.numStreams) {
        //     rtc.fire('ready');
        // }
    };

    rtc.addStreams = function () {
        if(rtc.mediaStream){
            for (var remoteId in rtc.peers) {
                console.log(remoteId + " added stream");
                rtc.peers[remoteId].addStream(rtc.mediaStream);
            }
        }
    };

    // options.bandwidth =
    var bandwidth = { audio: 50, video: 256, data: 30 * 1000 * 1000 }

    rtc.setBandwidth = function(sdp) {
        if (moz || !bandwidth /* || navigator.userAgent.match( /Android|iPhone|iPad|iPod|BlackBerry|IEMobile/i ) */) return sdp;

        // remove existing bandwidth lines
        sdp = sdp.replace( /b=AS([^\r\n]+\r\n)/g , '');

        if (bandwidth.audio) {
            sdp = sdp.replace( /a=mid:audio\r\n/g , 'a=mid:audio\r\nb=AS:' + bandwidth.audio + '\r\n');
        }

        if (bandwidth.video) {
            sdp = sdp.replace( /a=mid:video\r\n/g , 'a=mid:video\r\nb=AS:' + bandwidth.video + '\r\n');
        }

        if (bandwidth.data) {
            sdp = sdp.replace( /a=mid:data\r\n/g , 'a=mid:data\r\nb=AS:' + bandwidth.data + '\r\n');
        }

        return sdp;
    };

    rtc.publishStream = function (stream, element) {
        if (typeof (element) === "string") {
            element = document.getElementById(element);
        }
        rtc.mediaStream = stream;
        element.srcObject = stream;
        element.play()
    };

    rtc.unPublishStream = function () {
        if (typeof rtc.mediaStream !== undefined) {
            rtc.mediaStream.getTracks().forEach(track => {
                track.onended = null;
                track.stop();
            });
            rtc.mediaStream = undefined;
        }
    };

    rtc.createDataChannel = function (pcOrId, label) {
        if (!rtc.dataChannelSupport) {
            //TODO this should be an exception
            alert('webRTC data channel is not yet supported in this browser,' +
                ' or you must turn on experimental flags');
            return;
        }

        var id, pc;
        if (typeof (pcOrId) === 'string') {
            id = pcOrId;
            pc = rtc.peers[pcOrId];
        } else {
            pc = pcOrId;
            id = undefined;
            for (var key in rtc.peers) {
                if (rtc.peers[key] === pc) id = key;
            }
        }

        if (!id) throw new Error('attempt to createDataChannel with unknown id');

        if (!pc || !(pc instanceof PeerConnection)) throw new Error('attempt to createDataChannel without peerConnection');

        // need a label
        label = label || 'fileTransfer' || String(id);

        // chrome only supports reliable false atm.
        var options = {
            reliable: false
        };

        var channel;
        try {
            if (rtc.debug) console.log('createDataChannel ' + id);
            channel = pc.createDataChannel(label, options);
        } catch (error) {
            if (rtc.debug) console.log('seems that DataChannel is NOT actually supported!');
            throw error;
        }

        return rtc.addDataChannel(id, channel);
    };

    rtc.addDataChannel = function (id, channel) {

        channel.onopen = function () {
            if (rtc.debug) console.log('data stream open ' + id);
            rtc.fire('data stream open', channel);
        };

        channel.onclose = function (event) {
            delete rtc.dataChannels[id];
            delete rtc.peers[id];
            delete rtc.connections[id];
            if (rtc.debug) console.log('data stream close ' + id);
            rtc.fire('data stream close', channel);
        };

        channel.onmessage = function (message) {
            if (rtc.debug) console.log('data stream message ' + id);
            rtc.fire('data stream data', channel, message.data);
        };

        channel.onerror = function (err) {
            if (rtc.debug) console.log('data stream error ' + id + ': ' + err);
            rtc.fire('data stream error', channel, err);
        };

        // track dataChannel
        rtc.dataChannels[id] = channel;
        return channel;
    };

    rtc.addDataChannels = function () {
        if (!rtc.dataChannelSupport) return;

        for (var connection in rtc.peers)
            rtc.createDataChannel(connection);
    };

    rtc.on('ready', function () {
        console.log('rtc ready');
        rtc.createPeerConnections();
        rtc.addStreams();
        rtc.addDataChannels();
        rtc.sendOffers();
        rtc.offerSent = true;
    });

}).call(this);

function preferOpus(sdp) {
    var sdpLines = sdp.split('\r\n');
    var mLineIndex = null;
    // Search for m line.
    for (var i = 0; i < sdpLines.length; i++) {
        if (sdpLines[i].search('m=audio') !== -1) {
            mLineIndex = i;
            break;
        }
    }
    if (mLineIndex === null) return sdp;

    // If Opus is available, set it as the default in m line.
    for (var j = 0; j < sdpLines.length; j++) {
        if (sdpLines[j].search('opus/48000') !== -1) {
            var opusPayload = extractSdp(sdpLines[j], /:(\d+) opus\/48000/i);
            if (opusPayload) sdpLines[mLineIndex] = setDefaultCodec(sdpLines[mLineIndex], opusPayload);
            break;
        }
    }

    // Remove CN in m line and sdp.
    sdpLines = removeCN(sdpLines, mLineIndex);

    sdp = sdpLines.join('\r\n');
    return sdp;
}

function extractSdp(sdpLine, pattern) {
    var result = sdpLine.match(pattern);
    return (result && result.length == 2) ? result[1] : null;
}

function setDefaultCodec(mLine, payload) {
    var elements = mLine.split(' ');
    var newLine = [];
    var index = 0;
    for (var i = 0; i < elements.length; i++) {
        if (index === 3) // Format of media starts from the fourth.
            newLine[index++] = payload; // Put target payload to the first.
        if (elements[i] !== payload) newLine[index++] = elements[i];
    }
    return newLine.join(' ');
}

function removeCN(sdpLines, mLineIndex) {
    var mLineElements = sdpLines[mLineIndex].split(' ');
    // Scan from end for the convenience of removing an item.
    for (var i = sdpLines.length - 1; i >= 0; i--) {
        var payload = extractSdp(sdpLines[i], /a=rtpmap:(\d+) CN\/\d+/i);
        if (payload) {
            var cnPos = mLineElements.indexOf(payload);
            if (cnPos !== -1) {
                // Remove CN payload from m line.
                mLineElements.splice(cnPos, 1);
            }
            // Remove CN line in sdp
            sdpLines.splice(i, 1);
        }
    }

    sdpLines[mLineIndex] = mLineElements.join(' ');
    return sdpLines;
}

function mergeConstraints(cons1, cons2) {
    var merged = cons1;
    for (var name in cons2.mandatory) {
        merged.mandatory[name] = cons2.mandatory[name];
    }
    merged.optional.concat(cons2.optional);
    return merged;
}