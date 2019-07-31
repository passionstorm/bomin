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
            // log(pc.localDescription.sdp);
            var x = pc.localDescription;
            x.sdp = x.sdp.replace('BUNDLE', 'BUNDLE 0').replace('a=mid:video', 'a=mid:0');
            log(x.sdp)
            // log(pc.localDescription);
            // $.ajax({
            //     url: '/sdp',
            //     method: "POST",
            //     data: JSON.stringify(pc.localDescription),
            //     dataType: "text",
            // }).done(function (sd) {
            //
            //     pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(atob(sd))))
            // });
        }
    }

    if (isPublisher) {
        navigator.mediaDevices.getUserMedia({video: true, audio: false})
            .then(stream => {
                pc.addStream(document.getElementById('video1').srcObject = stream)
                pc.createOffer()
                    .then(d => {
                        pc.setLocalDescription(d).then(() => {
                            var sections = splitSections(d.sdp);
                            console.log(sections)
                        })
                    })
                    .catch(log)
            }).catch(log)
    } else {
        pc.addTransceiver('video', {'direction': 'recvonly'})
        pc.createOffer()
            .then(d => {
                var sections = SDPUtils.splitSections(d.sdp);
                sections.forEach(function(mediaSection, sdpMLineIndex) {
                    var caps = SDPUtils.parseRtpParameters(mediaSection);
                    pc.transceivers[sdpMLineIndex].localCapabilities = caps;
                });
                console.log( pc.transceivers);

                pc.setLocalDescription(d)
                    .then(() => {
                        var sections = SDPUtils.splitSections(d.sdp);
                        console.log(sections)
                    })
            })
            .catch(log)

        pc.ontrack = function (event) {
            var el = document.getElementById('video1')
            el.srcObject = event.streams[0]
            el.autoplay = true
            el.controls = true
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
