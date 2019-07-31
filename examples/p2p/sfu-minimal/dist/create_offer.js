var log = msg => {
    document.getElementById('logs').innerHTML += msg + '<br>'
}

document.addEventListener('gesturestart', function (e) {
    e.preventDefault();
});

var PeerConnection = (window.RTCPeerConnection || window.webkitRTCPeerConnection || window.webkitPeerConnection00 || window.webkitRTCPeerConnection);
var URL = (window.URL || window.webkitURL);
var getUserMedia = navigator.webkitGetUserMedia;
var nativeRTCIceCandidate = window.RTCIceCandidate;
var nativeRTCSessionDescription = window.RTCSessionDescription; // order is very important: "RTCSessionDescription" defined in Nighly but useless

$(document).ready(function () {
    const audioInput = $('input#audio')
    const restartInput = $('input#restart')
    const vadInput = $('input#vad')
    const videoInput = $('input#video')

    const numAudioTracksInput = $('div#numAudioTracks input');
    const numAudioTracksDisplay = $('span#numAudioTracksDisplay');
    const outputTextarea = $('textarea#output');

    audioInput.on('change', createOffer)
    videoInput.on('change', createOffer)
    restartInput.on('change', createOffer)
    vadInput.on('change', createOffer)
    numAudioTracksInput.on('change', e => numAudioTracksDisplay.innerText = e.target.value);

    async function createOffer() {
        outputTextarea.css('height', '400px');

        outputTextarea.value = '';
        const peerConnection = window.peerConnection = new PeerConnection({
            iceServers: [
                {
                    'urls': [
                        'stun:stun.l.google.com:19302',
                        'stun:stun1.l.google.com:19302',
                        'stun:stun2.l.google.com:19302',
                        'stun:stun.l.google.com:19302?transport=udp',
                    ]
                }
            ]
        });

        const numRequestedAudioTracks = parseInt(numAudioTracksInput.value);

        for (let i = 0; i < numRequestedAudioTracks; i++) {
            const acx = new AudioContext();
            const dst = acx.createMediaStreamDestination();

            // Fill up the peer connection with numRequestedAudioTracks number of tracks.
            const track = dst.stream.getTracks()[0];
            peerConnection.addTrack(track, dst.stream);
        }

        const offerOptions = {
            // New spec states offerToReceiveAudio/Video are of type long (due to
            // having to tell how many "m" lines to generate).
            // http://w3c.github.io/webrtc-pc/#idl-def-RTCOfferAnswerOptions.
            offerToReceiveAudio: (audioInput.is(':checked')) ? 1 : 0,
            offerToReceiveVideo: (videoInput.is(':checked')) ? 1 : 0,
            iceRestart: restartInput.is(':checked'),
            voiceActivityDetection: vadInput.is(':checked'),
            sdpSemantics: 'unified-plan'
        };
        peerConnection.addTransceiver('video', {'direction': 'recvonly'})
        // log(offerOptions.offerToReceiveVideo);

        try {
            const offer = await peerConnection.createOffer(offerOptions);
            offer.sdp = offer.sdp.replace('BUNDLE video', 'BUNDLE 0')
            offer.sdp = offer.sdp.replace('a=mid:video', 'a=mid:0')
            await peerConnection.setLocalDescription(offer);
            outputTextarea.text(offer.sdp)
        } catch (e) {
            outputTextarea.text(`Failed to create offer: ${e}`)
        }
    }
})
