/* eslint-env browser */


window.createSession = isPublisher => {

    let pc = new RTCPeerConnection({
        iceServers: [
            {
                urls: 'stun:stun.l.google.com:19302'
            }
        ]
    })
    pc.transceivers = [];
    pc.oniceconnectionstatechange = e => log(pc.iceConnectionState)
    pc.onicecandidate = event => {
        if (event.candidate === null) {
            $.ajax({
                url: '/sdp',
                method: "POST",
                data: JSON.stringify(pc.localDescription),
                dataType: "text",
            }).done(function (sd) {
                pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(atob(sd))))
            });
        }
    }

    if (isPublisher) {
        navigator.mediaDevices.getUserMedia({video: true, audio: false})
            .then(stream => {
                pc.addStream(document.getElementById('video1').srcObject = stream)
                pc.createOffer().then(d =>  pc.setLocalDescription(d)).catch(log)
            }).catch(log)
    } else {
        pc.addTransceiver('video', {'direction': 'recvonly'})
        pc.createOffer().then(d => pc.setLocalDescription(d)).catch(log)

        pc.ontrack = function (event) {
            try{
                var el = document.getElementById('video1')
                el.srcObject = event.streams[0]
                el.play()
            }catch (e) {
                log(e.message)
            }
        }
    }

    window.startSession = () => {
        let sd = document.getElementById('remoteSessionDescription').value
        if (sd === '') {
            return alert('Session Description must not be empty')
        }

        try {
            // pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(atob(sd))))
        } catch (e) {
            alert(e)
        }
    }

    let btns = document.getElementsByClassName('createSessionButton')
    for (let i = 0; i < btns.length; i++) {
        btns[i].style = 'display: none'
    }
}
