/* eslint-env browser */


window.createSession = isPublisher => {
    var localStream;
    let pc = new RTCPeerConnection({
        iceServers: [
            {
                urls: 'stun:stun.l.google.com:19302'
            }
        ]
    })

    pc.transceivers = [];
    pc.oniceconnectionstatechange = e => {
        log(pc.iceConnectionState)
        if (pc.iceConnectionState === "failed" ||
            pc.iceConnectionState === "disconnected" ||
            pc.iceConnectionState === "closed") {
            localStream.getTracks().forEach(track => track.stop());
            let btns = document.getElementsByClassName('createSessionButton')
            for (let i = 0; i < btns.length; i++) {
                btns[i].style = 'display: block'
            }
        }

    }
    pc.onicecandidate = event => {
        if (event.candidate === null) {
            $.ajax({
                url: isPublisher ? '/create' : 'join',
                method: "POST",
                data: JSON.stringify(pc.localDescription),
                dataType: "text",
            }).done(function (sd) {
                pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(atob(sd))))
            });
        }
    }

    if (isPublisher) {
        // navigator.mediaDevices.getUserMedia({video: true, audio: false})
        //     .then(stream => {
        //         localStream = stream;
        //         stream.getTracks().forEach(track => pc.addTrack(track, stream));
        //         document.getElementById('video1').srcObject = stream;
        //         pc.createOffer().then(d => pc.setLocalDescription(d)).catch(log)
        //     }).catch(log)

        const videoLocal = document.getElementById('video1');
        videoLocal.src = "demo.mp4";
        if (/iPad|iPhone|iPod/.test(navigator.userAgent)){
            videoLocal.autoplay = true;
        }
        videoLocal.onloadeddata = function () {
            console.log('video loaded');
            var stream = videoLocal.captureStream(0);
            localStream = stream;
            stream.getTracks().forEach(track => pc.addTrack(track, stream));
            document.getElementById('video1').srcObject = stream;
            pc.createOffer().then(d => pc.setLocalDescription(d)).catch(log)
        }

    } else {
        pc.addTransceiver('video', {'direction': 'recvonly'})
        // pc.addTransceiver('audio', {'direction': 'recvonly'})
        pc.createOffer().then(d => pc.setLocalDescription(d)).catch(log)
        var gotFirstMediaStream = false;
        pc.ontrack = function (event) {
            log('ontrack')
            try {
                var el = document.getElementById('video1');
                var sc = document.getElementById('screen');
                event.stream = event.streams[0];
                if (!gotFirstMediaStream) {
                    gotFirstMediaStream = true;
                    el.srcObject = event.stream;
                    el.play();
                }
                // "screen-stream" is attached in 2nd order
                else {
                    sc.srcObject = event.stream;
                    sc.play();
                }
            } catch (e) {
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
