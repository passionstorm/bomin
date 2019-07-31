/*
 *  Copyright (c) 2014 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */

/* More information about these options at jshint.com/docs/options */

/* globals  adapter, trace */
/* exported setCodecParam, iceCandidateType,
   maybeSetOpusOptions, maybePreferAudioReceiveCodec,
   maybePreferAudioSendCodec, maybeSetAudioReceiveBitRate,
   maybeSetAudioSendBitRate, maybePreferVideoReceiveCodec,
   maybePreferVideoSendCodec, maybeSetVideoReceiveBitRate,
   maybeSetVideoSendBitRate, maybeSetVideoSendInitialBitRate,
   maybeRemoveVideoFec, mergeConstraints, removeCodecParam*/

'use strict';


var SDPUtils = {};
SDPUtils.generateIdentifier = function() {
    return Math.random().toString(36).substr(2, 10);
};
SDPUtils.localCName = SDPUtils.generateIdentifier();
SDPUtils.splitLines = function(blob) {
    return blob.trim().split("\n").map(function(line) {
        return line.trim();
    });
};
SDPUtils.splitSections = function(blob) {
    var parts = blob.split("\nm=");
    return parts.map(function(part, index) {
        return (index > 0 ? "m=" + part : part).trim() + "\r\n";
    });
};
SDPUtils.getDescription = function(blob) {
    var sections = SDPUtils.splitSections(blob);
    return sections && sections[0];
};
SDPUtils.getMediaSections = function(blob) {
    var sections = SDPUtils.splitSections(blob);
    sections.shift();
    return sections;
};
SDPUtils.matchPrefix = function(blob, prefix) {
    return SDPUtils.splitLines(blob).filter(function(line) {
        return line.indexOf(prefix) === 0;
    });
};
SDPUtils.parseCandidate = function(line) {
    var parts;
    if (line.indexOf("a=candidate:") === 0) {
        parts = line.substring(12).split(" ");
    } else {
        parts = line.substring(10).split(" ");
    }
    var candidate = {foundation:parts[0], component:parseInt(parts[1], 10), protocol:parts[2].toLowerCase(), priority:parseInt(parts[3], 10), ip:parts[4], address:parts[4], port:parseInt(parts[5], 10), type:parts[7]};
    for (var i = 8; i < parts.length; i += 2) {
        switch(parts[i]) {
            case "raddr":
                candidate.relatedAddress = parts[i + 1];
                break;
            case "rport":
                candidate.relatedPort = parseInt(parts[i + 1], 10);
                break;
            case "tcptype":
                candidate.tcpType = parts[i + 1];
                break;
            case "ufrag":
                candidate.ufrag = parts[i + 1];
                candidate.usernameFragment = parts[i + 1];
                break;
            default:
                candidate[parts[i]] = parts[i + 1];
                break;
        }
    }
    return candidate;
};
SDPUtils.writeCandidate = function(candidate) {
    var sdp = [];
    sdp.push(candidate.foundation);
    sdp.push(candidate.component);
    sdp.push(candidate.protocol.toUpperCase());
    sdp.push(candidate.priority);
    sdp.push(candidate.address || candidate.ip);
    sdp.push(candidate.port);
    var type = candidate.type;
    sdp.push("typ");
    sdp.push(type);
    if (type !== "host" && candidate.relatedAddress && candidate.relatedPort) {
        sdp.push("raddr");
        sdp.push(candidate.relatedAddress);
        sdp.push("rport");
        sdp.push(candidate.relatedPort);
    }
    if (candidate.tcpType && candidate.protocol.toLowerCase() === "tcp") {
        sdp.push("tcptype");
        sdp.push(candidate.tcpType);
    }
    if (candidate.usernameFragment || candidate.ufrag) {
        sdp.push("ufrag");
        sdp.push(candidate.usernameFragment || candidate.ufrag);
    }
    return "candidate:" + sdp.join(" ");
};
SDPUtils.parseIceOptions = function(line) {
    return line.substr(14).split(" ");
};
SDPUtils.parseRtpMap = function(line) {
    var parts = line.substr(9).split(" ");
    var parsed = {payloadType:parseInt(parts.shift(), 10)};
    parts = parts[0].split("/");
    parsed.name = parts[0];
    parsed.clockRate = parseInt(parts[1], 10);
    parsed.channels = parts.length === 3 ? parseInt(parts[2], 10) : 1;
    parsed.numChannels = parsed.channels;
    return parsed;
};
SDPUtils.writeRtpMap = function(codec) {
    var pt = codec.payloadType;
    if (codec.preferredPayloadType !== undefined) {
        pt = codec.preferredPayloadType;
    }
    var channels = codec.channels || codec.numChannels || 1;
    return "a=rtpmap:" + pt + " " + codec.name + "/" + codec.clockRate + (channels !== 1 ? "/" + channels : "") + "\r\n";
};
SDPUtils.parseExtmap = function(line) {
    var parts = line.substr(9).split(" ");
    return {id:parseInt(parts[0], 10), direction:parts[0].indexOf("/") > 0 ? parts[0].split("/")[1] : "sendrecv", uri:parts[1]};
};
SDPUtils.writeExtmap = function(headerExtension) {
    return "a=extmap:" + (headerExtension.id || headerExtension.preferredId) + (headerExtension.direction && headerExtension.direction !== "sendrecv" ? "/" + headerExtension.direction : "") + " " + headerExtension.uri + "\r\n";
};
SDPUtils.parseFmtp = function(line) {
    var parsed = {};
    var kv;
    var parts = line.substr(line.indexOf(" ") + 1).split(";");
    for (var j = 0; j < parts.length; j++) {
        kv = parts[j].trim().split("=");
        parsed[kv[0].trim()] = kv[1];
    }
    return parsed;
};
SDPUtils.writeFmtp = function(codec) {
    var line = "";
    var pt = codec.payloadType;
    if (codec.preferredPayloadType !== undefined) {
        pt = codec.preferredPayloadType;
    }
    if (codec.parameters && Object.keys(codec.parameters).length) {
        var params = [];
        Object.keys(codec.parameters).forEach(function(param) {
            if (codec.parameters[param]) {
                params.push(param + "=" + codec.parameters[param]);
            } else {
                params.push(param);
            }
        });
        line += "a=fmtp:" + pt + " " + params.join(";") + "\r\n";
    }
    return line;
};
SDPUtils.parseRtcpFb = function(line) {
    var parts = line.substr(line.indexOf(" ") + 1).split(" ");
    return {type:parts.shift(), parameter:parts.join(" ")};
};
SDPUtils.writeRtcpFb = function(codec) {
    var lines = "";
    var pt = codec.payloadType;
    if (codec.preferredPayloadType !== undefined) {
        pt = codec.preferredPayloadType;
    }
    if (codec.rtcpFeedback && codec.rtcpFeedback.length) {
        codec.rtcpFeedback.forEach(function(fb) {
            lines += "a=rtcp-fb:" + pt + " " + fb.type + (fb.parameter && fb.parameter.length ? " " + fb.parameter : "") + "\r\n";
        });
    }
    return lines;
};
SDPUtils.parseSsrcMedia = function(line) {
    var sp = line.indexOf(" ");
    var parts = {ssrc:parseInt(line.substr(7, sp - 7), 10)};
    var colon = line.indexOf(":", sp);
    if (colon > -1) {
        parts.attribute = line.substr(sp + 1, colon - sp - 1);
        parts.value = line.substr(colon + 1);
    } else {
        parts.attribute = line.substr(sp + 1);
    }
    return parts;
};
SDPUtils.parseSsrcGroup = function(line) {
    var parts = line.substr(13).split(" ");
    return {semantics:parts.shift(), ssrcs:parts.map(function(ssrc) {
            return parseInt(ssrc, 10);
        })};
};
SDPUtils.getMid = function(mediaSection) {
    var mid = SDPUtils.matchPrefix(mediaSection, "a=mid:")[0];
    if (mid) {
        return mid.substr(6);
    }
};
SDPUtils.parseFingerprint = function(line) {
    var parts = line.substr(14).split(" ");
    return {algorithm:parts[0].toLowerCase(), value:parts[1]};
};
SDPUtils.getDtlsParameters = function(mediaSection, sessionpart) {
    var lines = SDPUtils.matchPrefix(mediaSection + sessionpart, "a=fingerprint:");
    return {role:"auto", fingerprints:lines.map(SDPUtils.parseFingerprint)};
};
SDPUtils.writeDtlsParameters = function(params, setupType) {
    var sdp = "a=setup:" + setupType + "\r\n";
    params.fingerprints.forEach(function(fp) {
        sdp += "a=fingerprint:" + fp.algorithm + " " + fp.value + "\r\n";
    });
    return sdp;
};
SDPUtils.getIceParameters = function(mediaSection, sessionpart) {
    var lines = SDPUtils.splitLines(mediaSection);
    lines = lines.concat(SDPUtils.splitLines(sessionpart));
    var iceParameters = {usernameFragment:lines.filter(function(line) {
            return line.indexOf("a=ice-ufrag:") === 0;
        })[0].substr(12), password:lines.filter(function(line) {
            return line.indexOf("a=ice-pwd:") === 0;
        })[0].substr(10)};
    return iceParameters;
};
SDPUtils.writeIceParameters = function(params) {
    return "a=ice-ufrag:" + params.usernameFragment + "\r\n" + "a=ice-pwd:" + params.password + "\r\n";
};
SDPUtils.parseRtpParameters = function(mediaSection) {
    var description = {codecs:[], headerExtensions:[], fecMechanisms:[], rtcp:[]};
    var lines = SDPUtils.splitLines(mediaSection);
    var mline = lines[0].split(" ");
    for (var i = 3; i < mline.length; i++) {
        var pt = mline[i];
        var rtpmapline = SDPUtils.matchPrefix(mediaSection, "a=rtpmap:" + pt + " ")[0];
        if (rtpmapline) {
            var codec = SDPUtils.parseRtpMap(rtpmapline);
            var fmtps = SDPUtils.matchPrefix(mediaSection, "a=fmtp:" + pt + " ");
            codec.parameters = fmtps.length ? SDPUtils.parseFmtp(fmtps[0]) : {};
            codec.rtcpFeedback = SDPUtils.matchPrefix(mediaSection, "a=rtcp-fb:" + pt + " ").map(SDPUtils.parseRtcpFb);
            description.codecs.push(codec);
            switch(codec.name.toUpperCase()) {
                case "RED":
                case "ULPFEC":
                    description.fecMechanisms.push(codec.name.toUpperCase());
                    break;
                default:
                    break;
            }
        }
    }
    SDPUtils.matchPrefix(mediaSection, "a=extmap:").forEach(function(line) {
        description.headerExtensions.push(SDPUtils.parseExtmap(line));
    });
    return description;
};
SDPUtils.writeRtpDescription = function(kind, caps) {
    var sdp = "";
    sdp += "m=" + kind + " ";
    sdp += caps.codecs.length > 0 ? "9" : "0";
    sdp += " UDP/TLS/RTP/SAVPF ";
    sdp += caps.codecs.map(function(codec) {
        if (codec.preferredPayloadType !== undefined) {
            return codec.preferredPayloadType;
        }
        return codec.payloadType;
    }).join(" ") + "\r\n";
    sdp += "c=IN IP4 0.0.0.0\r\n";
    sdp += "a=rtcp:9 IN IP4 0.0.0.0\r\n";
    caps.codecs.forEach(function(codec) {
        sdp += SDPUtils.writeRtpMap(codec);
        sdp += SDPUtils.writeFmtp(codec);
        sdp += SDPUtils.writeRtcpFb(codec);
    });
    var maxptime = 0;
    caps.codecs.forEach(function(codec) {
        if (codec.maxptime > maxptime) {
            maxptime = codec.maxptime;
        }
    });
    if (maxptime > 0) {
        sdp += "a=maxptime:" + maxptime + "\r\n";
    }
    sdp += "a=rtcp-mux\r\n";
    if (caps.headerExtensions) {
        caps.headerExtensions.forEach(function(extension) {
            sdp += SDPUtils.writeExtmap(extension);
        });
    }
    return sdp;
};
SDPUtils.parseRtpEncodingParameters = function(mediaSection) {
    var encodingParameters = [];
    var description = SDPUtils.parseRtpParameters(mediaSection);
    var hasRed = description.fecMechanisms.indexOf("RED") !== -1;
    var hasUlpfec = description.fecMechanisms.indexOf("ULPFEC") !== -1;
    var ssrcs = SDPUtils.matchPrefix(mediaSection, "a=ssrc:").map(function(line) {
        return SDPUtils.parseSsrcMedia(line);
    }).filter(function(parts) {
        return parts.attribute === "cname";
    });
    var primarySsrc = ssrcs.length > 0 && ssrcs[0].ssrc;
    var secondarySsrc;
    var flows = SDPUtils.matchPrefix(mediaSection, "a=ssrc-group:FID").map(function(line) {
        var parts = line.substr(17).split(" ");
        return parts.map(function(part) {
            return parseInt(part, 10);
        });
    });
    if (flows.length > 0 && flows[0].length > 1 && flows[0][0] === primarySsrc) {
        secondarySsrc = flows[0][1];
    }
    description.codecs.forEach(function(codec) {
        if (codec.name.toUpperCase() === "RTX" && codec.parameters.apt) {
            var encParam = {ssrc:primarySsrc, codecPayloadType:parseInt(codec.parameters.apt, 10)};
            if (primarySsrc && secondarySsrc) {
                encParam.rtx = {ssrc:secondarySsrc};
            }
            encodingParameters.push(encParam);
            if (hasRed) {
                encParam = JSON.parse(JSON.stringify(encParam));
                encParam.fec = {ssrc:primarySsrc, mechanism:hasUlpfec ? "red+ulpfec" : "red"};
                encodingParameters.push(encParam);
            }
        }
    });
    if (encodingParameters.length === 0 && primarySsrc) {
        encodingParameters.push({ssrc:primarySsrc});
    }
    var bandwidth = SDPUtils.matchPrefix(mediaSection, "b=");
    if (bandwidth.length) {
        if (bandwidth[0].indexOf("b=TIAS:") === 0) {
            bandwidth = parseInt(bandwidth[0].substr(7), 10);
        } else {
            if (bandwidth[0].indexOf("b=AS:") === 0) {
                bandwidth = parseInt(bandwidth[0].substr(5), 10) * 1000 * 0.95 - 50 * 40 * 8;
            } else {
                bandwidth = undefined;
            }
        }
        encodingParameters.forEach(function(params) {
            params.maxBitrate = bandwidth;
        });
    }
    return encodingParameters;
};
SDPUtils.parseRtcpParameters = function(mediaSection) {
    var rtcpParameters = {};
    var remoteSsrc = SDPUtils.matchPrefix(mediaSection, "a=ssrc:").map(function(line) {
        return SDPUtils.parseSsrcMedia(line);
    }).filter(function(obj) {
        return obj.attribute === "cname";
    })[0];
    if (remoteSsrc) {
        rtcpParameters.cname = remoteSsrc.value;
        rtcpParameters.ssrc = remoteSsrc.ssrc;
    }
    var rsize = SDPUtils.matchPrefix(mediaSection, "a=rtcp-rsize");
    rtcpParameters.reducedSize = rsize.length > 0;
    rtcpParameters.compound = rsize.length === 0;
    var mux = SDPUtils.matchPrefix(mediaSection, "a=rtcp-mux");
    rtcpParameters.mux = mux.length > 0;
    return rtcpParameters;
};
SDPUtils.parseMsid = function(mediaSection) {
    var parts;
    var spec = SDPUtils.matchPrefix(mediaSection, "a=msid:");
    if (spec.length === 1) {
        parts = spec[0].substr(7).split(" ");
        return {stream:parts[0], track:parts[1]};
    }
    var planB = SDPUtils.matchPrefix(mediaSection, "a=ssrc:").map(function(line) {
        return SDPUtils.parseSsrcMedia(line);
    }).filter(function(msidParts) {
        return msidParts.attribute === "msid";
    });
    if (planB.length > 0) {
        parts = planB[0].value.split(" ");
        return {stream:parts[0], track:parts[1]};
    }
};
SDPUtils.generateSessionId = function() {
    return Math.random().toString().substr(2, 21);
};
SDPUtils.writeSessionBoilerplate = function(sessId, sessVer, sessUser) {
    var sessionId;
    var version = sessVer !== undefined ? sessVer : 2;
    if (sessId) {
        sessionId = sessId;
    } else {
        sessionId = SDPUtils.generateSessionId();
    }
    var user = sessUser || "thisisadapterortc";
    return "v=0\r\n" + "o=" + user + " " + sessionId + " " + version + " IN IP4 127.0.0.1\r\n" + "s=-\r\n" + "t=0 0\r\n";
};
SDPUtils.writeMediaSection = function(transceiver, caps, type, stream) {
    var sdp = SDPUtils.writeRtpDescription(transceiver.kind, caps);
    sdp += SDPUtils.writeIceParameters(transceiver.iceGatherer.getLocalParameters());
    sdp += SDPUtils.writeDtlsParameters(transceiver.dtlsTransport.getLocalParameters(), type === "offer" ? "actpass" : "active");
    sdp += "a=mid:" + transceiver.mid + "\r\n";
    if (transceiver.direction) {
        sdp += "a=" + transceiver.direction + "\r\n";
    } else {
        if (transceiver.rtpSender && transceiver.rtpReceiver) {
            sdp += "a=sendrecv\r\n";
        } else {
            if (transceiver.rtpSender) {
                sdp += "a=sendonly\r\n";
            } else {
                if (transceiver.rtpReceiver) {
                    sdp += "a=recvonly\r\n";
                } else {
                    sdp += "a=inactive\r\n";
                }
            }
        }
    }
    if (transceiver.rtpSender) {
        var msid = "msid:" + stream.id + " " + transceiver.rtpSender.track.id + "\r\n";
        sdp += "a=" + msid;
        sdp += "a=ssrc:" + transceiver.sendEncodingParameters[0].ssrc + " " + msid;
        if (transceiver.sendEncodingParameters[0].rtx) {
            sdp += "a=ssrc:" + transceiver.sendEncodingParameters[0].rtx.ssrc + " " + msid;
            sdp += "a=ssrc-group:FID " + transceiver.sendEncodingParameters[0].ssrc + " " + transceiver.sendEncodingParameters[0].rtx.ssrc + "\r\n";
        }
    }
    sdp += "a=ssrc:" + transceiver.sendEncodingParameters[0].ssrc + " cname:" + SDPUtils.localCName + "\r\n";
    if (transceiver.rtpSender && transceiver.sendEncodingParameters[0].rtx) {
        sdp += "a=ssrc:" + transceiver.sendEncodingParameters[0].rtx.ssrc + " cname:" + SDPUtils.localCName + "\r\n";
    }
    return sdp;
};
SDPUtils.getDirection = function(mediaSection, sessionpart) {
    var lines = SDPUtils.splitLines(mediaSection);
    for (var i = 0; i < lines.length; i++) {
        switch(lines[i]) {
            case "a=sendrecv":
            case "a=sendonly":
            case "a=recvonly":
            case "a=inactive":
                return lines[i].substr(2);
            default:
        }
    }
    if (sessionpart) {
        return SDPUtils.getDirection(sessionpart);
    }
    return "sendrecv";
};
SDPUtils.getKind = function(mediaSection) {
    var lines = SDPUtils.splitLines(mediaSection);
    var mline = lines[0].split(" ");
    return mline[0].substr(2);
};
SDPUtils.isRejected = function(mediaSection) {
    return mediaSection.split(" ", 2)[1] === "0";
};
SDPUtils.parseMLine = function(mediaSection) {
    var lines = SDPUtils.splitLines(mediaSection);
    var parts = lines[0].substr(2).split(" ");
    return {kind:parts[0], port:parseInt(parts[1], 10), protocol:parts[2], fmt:parts.slice(3).join(" ")};
};
SDPUtils.parseOLine = function(mediaSection) {
    var line = SDPUtils.matchPrefix(mediaSection, "o=")[0];
    var parts = line.substr(2).split(" ");
    return {username:parts[0], sessionId:parts[1], sessionVersion:parseInt(parts[2], 10), netType:parts[3], addressType:parts[4], address:parts[5]};
};
SDPUtils.isValidSDP = function(blob) {
    if (typeof blob !== "string" || blob.length === 0) {
        return false;
    }
    var lines = SDPUtils.splitLines(blob);
    for (var i = 0; i < lines.length; i++) {
        if (lines[i].length < 2 || lines[i].charAt(1) !== "=") {
            return false;
        }
    }
    return true;
};


function mergeConstraints(cons1, cons2) {
    if (!cons1 || !cons2) {
        return cons1 || cons2;
    }
    var merged = cons1;
    for (var key in cons2) {
        merged[key] = cons2[key];
    }
    return merged;
}

function iceCandidateType(candidateStr) {
    return candidateStr.split(' ')[7];
}

function maybeSetOpusOptions(sdp, params) {
    // Set Opus in Stereo, if stereo is true, unset it, if stereo is false, and
    // do nothing if otherwise.
    if (params.opusStereo === 'true') {
        sdp = setCodecParam(sdp, 'opus/48000', 'stereo', '1');
    } else if (params.opusStereo === 'false') {
        sdp = removeCodecParam(sdp, 'opus/48000', 'stereo');
    }

    // Set Opus FEC, if opusfec is true, unset it, if opusfec is false, and
    // do nothing if otherwise.
    if (params.opusFec === 'true') {
        sdp = setCodecParam(sdp, 'opus/48000', 'useinbandfec', '1');
    } else if (params.opusFec === 'false') {
        sdp = removeCodecParam(sdp, 'opus/48000', 'useinbandfec');
    }

    // Set Opus DTX, if opusdtx is true, unset it, if opusdtx is false, and
    // do nothing if otherwise.
    if (params.opusDtx === 'true') {
        sdp = setCodecParam(sdp, 'opus/48000', 'usedtx', '1');
    } else if (params.opusDtx === 'false') {
        sdp = removeCodecParam(sdp, 'opus/48000', 'usedtx');
    }

    // Set Opus maxplaybackrate, if requested.
    if (params.opusMaxPbr) {
        sdp = setCodecParam(
            sdp, 'opus/48000', 'maxplaybackrate', params.opusMaxPbr);
    }
    return sdp;
}

function maybeSetAudioSendBitRate(sdp, params) {
    if (!params.audioSendBitrate) {
        return sdp;
    }
    trace('Prefer audio send bitrate: ' + params.audioSendBitrate);
    return preferBitRate(sdp, params.audioSendBitrate, 'audio');
}

function maybeSetAudioReceiveBitRate(sdp, params) {
    if (!params.audioRecvBitrate) {
        return sdp;
    }
    trace('Prefer audio receive bitrate: ' + params.audioRecvBitrate);
    return preferBitRate(sdp, params.audioRecvBitrate, 'audio');
}

function maybeSetVideoSendBitRate(sdp, params) {
    if (!params.videoSendBitrate) {
        return sdp;
    }
    trace('Prefer video send bitrate: ' + params.videoSendBitrate);
    return preferBitRate(sdp, params.videoSendBitrate, 'video');
}

function maybeSetVideoReceiveBitRate(sdp, params) {
    if (!params.videoRecvBitrate) {
        return sdp;
    }
    trace('Prefer video receive bitrate: ' + params.videoRecvBitrate);
    return preferBitRate(sdp, params.videoRecvBitrate, 'video');
}

// Add a b=AS:bitrate line to the m=mediaType section.
function preferBitRate(sdp, bitrate, mediaType) {
    var sdpLines = sdp.split('\r\n');

    // Find m line for the given mediaType.
    var mLineIndex = findLine(sdpLines, 'm=', mediaType);
    if (mLineIndex === null) {
        trace('Failed to add bandwidth line to sdp, as no m-line found');
        return sdp;
    }

    // Find next m-line if any.
    var nextMLineIndex = findLineInRange(sdpLines, mLineIndex + 1, -1, 'm=');
    if (nextMLineIndex === null) {
        nextMLineIndex = sdpLines.length;
    }

    // Find c-line corresponding to the m-line.
    var cLineIndex = findLineInRange(sdpLines, mLineIndex + 1,
        nextMLineIndex, 'c=');
    if (cLineIndex === null) {
        trace('Failed to add bandwidth line to sdp, as no c-line found');
        return sdp;
    }

    // Check if bandwidth line already exists between c-line and next m-line.
    var bLineIndex = findLineInRange(sdpLines, cLineIndex + 1,
        nextMLineIndex, 'b=AS');
    if (bLineIndex) {
        sdpLines.splice(bLineIndex, 1);
    }

    // Create the b (bandwidth) sdp line.
    var bwLine = 'b=AS:' + bitrate;
    // As per RFC 4566, the b line should follow after c-line.
    sdpLines.splice(cLineIndex + 1, 0, bwLine);
    sdp = sdpLines.join('\r\n');
    return sdp;
}

// Add an a=fmtp: x-google-min-bitrate=kbps line, if videoSendInitialBitrate
// is specified. We'll also add a x-google-min-bitrate value, since the max
// must be >= the min.
function maybeSetVideoSendInitialBitRate(sdp, params) {
    var initialBitrate = parseInt(params.videoSendInitialBitrate);
    if (!initialBitrate) {
        return sdp;
    }

    // Validate the initial bitrate value.
    var maxBitrate = parseInt(initialBitrate);
    var bitrate = parseInt(params.videoSendBitrate);
    if (bitrate) {
        if (initialBitrate > bitrate) {
            trace('Clamping initial bitrate to max bitrate of ' + bitrate + ' kbps.');
            initialBitrate = bitrate;
            params.videoSendInitialBitrate = initialBitrate;
        }
        maxBitrate = bitrate;
    }

    var sdpLines = sdp.split('\r\n');

    // Search for m line.
    var mLineIndex = findLine(sdpLines, 'm=', 'video');
    if (mLineIndex === null) {
        trace('Failed to find video m-line');
        return sdp;
    }
    // Figure out the first codec payload type on the m=video SDP line.
    var videoMLine = sdpLines[mLineIndex];
    var pattern = new RegExp('m=video\\s\\d+\\s[A-Z/]+\\s');
    var sendPayloadType = videoMLine.split(pattern)[1].split(' ')[0];
    var fmtpLine = sdpLines[findLine(sdpLines, 'a=rtpmap', sendPayloadType)];
    var codecName = fmtpLine.split('a=rtpmap:' +
        sendPayloadType)[1].split('/')[0];

    // Use codec from params if specified via URL param, otherwise use from SDP.
    var codec = params.videoSendCodec || codecName;
    sdp = setCodecParam(sdp, codec, 'x-google-min-bitrate',
        params.videoSendInitialBitrate.toString());
    sdp = setCodecParam(sdp, codec, 'x-google-max-bitrate',
        maxBitrate.toString());

    return sdp;
}

function removePayloadTypeFromMline(mLine, payloadType) {
    mLine = mLine.split(' ');
    for (var i = 0; i < mLine.length; ++i) {
        if (mLine[i] === payloadType.toString()) {
            mLine.splice(i, 1);
        }
    }
    return mLine.join(' ');
}

function removeCodecByName(sdpLines, codec) {
    var index = findLine(sdpLines, 'a=rtpmap', codec);
    if (index === null) {
        return sdpLines;
    }
    var payloadType = getCodecPayloadTypeFromLine(sdpLines[index]);
    sdpLines.splice(index, 1);

    // Search for the video m= line and remove the codec.
    var mLineIndex = findLine(sdpLines, 'm=', 'video');
    if (mLineIndex === null) {
        return sdpLines;
    }
    sdpLines[mLineIndex] = removePayloadTypeFromMline(sdpLines[mLineIndex],
        payloadType);
    return sdpLines;
}

function removeCodecByPayloadType(sdpLines, payloadType) {
    var index = findLine(sdpLines, 'a=rtpmap', payloadType.toString());
    if (index === null) {
        return sdpLines;
    }
    sdpLines.splice(index, 1);

    // Search for the video m= line and remove the codec.
    var mLineIndex = findLine(sdpLines, 'm=', 'video');
    if (mLineIndex === null) {
        return sdpLines;
    }
    sdpLines[mLineIndex] = removePayloadTypeFromMline(sdpLines[mLineIndex],
        payloadType);
    return sdpLines;
}

function maybeRemoveVideoFec(sdp, params) {
    if (params.videoFec !== 'false') {
        return sdp;
    }

    var sdpLines = sdp.split('\r\n');

    var index = findLine(sdpLines, 'a=rtpmap', 'red');
    if (index === null) {
        return sdp;
    }
    var redPayloadType = getCodecPayloadTypeFromLine(sdpLines[index]);
    sdpLines = removeCodecByPayloadType(sdpLines, redPayloadType);

    sdpLines = removeCodecByName(sdpLines, 'ulpfec');

    // Remove fmtp lines associated with red codec.
    index = findLine(sdpLines, 'a=fmtp', redPayloadType.toString());
    if (index === null) {
        return sdp;
    }
    var fmtpLine = parseFmtpLine(sdpLines[index]);
    var rtxPayloadType = fmtpLine.pt;
    if (rtxPayloadType === null) {
        return sdp;
    }
    sdpLines.splice(index, 1);

    sdpLines = removeCodecByPayloadType(sdpLines, rtxPayloadType);
    return sdpLines.join('\r\n');
}

// Promotes |audioSendCodec| to be the first in the m=audio line, if set.
function maybePreferAudioSendCodec(sdp, params) {
    return maybePreferCodec(sdp, 'audio', 'send', params.audioSendCodec);
}

// Promotes |audioRecvCodec| to be the first in the m=audio line, if set.
function maybePreferAudioReceiveCodec(sdp, params) {
    return maybePreferCodec(sdp, 'audio', 'receive', params.audioRecvCodec);
}

// Promotes |videoSendCodec| to be the first in the m=audio line, if set.
function maybePreferVideoSendCodec(sdp, params) {
    return maybePreferCodec(sdp, 'video', 'send', params.videoSendCodec);
}

// Promotes |videoRecvCodec| to be the first in the m=audio line, if set.
function maybePreferVideoReceiveCodec(sdp, params) {
    return maybePreferCodec(sdp, 'video', 'receive', params.videoRecvCodec);
}

// Sets |codec| as the default |type| codec if it's present.
// The format of |codec| is 'NAME/RATE', e.g. 'opus/48000'.
function maybePreferCodec(sdp, type, dir, codec) {
    var str = type + ' ' + dir + ' codec';
    if (!codec) {
        trace('No preference on ' + str + '.');
        return sdp;
    }

    trace('Prefer ' + str + ': ' + codec);

    var sdpLines = sdp.split('\r\n');

    // Search for m line.
    var mLineIndex = findLine(sdpLines, 'm=', type);
    if (mLineIndex === null) {
        return sdp;
    }

    // If the codec is available, set it as the default in m line.
    var payload = null;
    // Iterate through rtpmap enumerations to find all matching codec entries
    for (var i = sdpLines.length-1; i >= 0 ; --i) {
        // Finds first match in rtpmap
        var index = findLineInRange(sdpLines, i, 0, 'a=rtpmap', codec, 'desc');
        if (index !== null) {
            // Skip all of the entries between i and index match
            i = index;
            payload = getCodecPayloadTypeFromLine(sdpLines[index]);
            if (payload) {
                // Move codec to top
                sdpLines[mLineIndex] = setDefaultCodec(sdpLines[mLineIndex], payload);
            }
        } else {
            // No match means we can break the loop
            break;
        }
    }

    sdp = sdpLines.join('\r\n');
    return sdp;
}

// Set fmtp param to specific codec in SDP. If param does not exists, add it.
function setCodecParam(sdp, codec, param, value) {
    var sdpLines = sdp.split('\r\n');

    var fmtpLineIndex = findFmtpLine(sdpLines, codec);

    var fmtpObj = {};
    if (fmtpLineIndex === null) {
        var index = findLine(sdpLines, 'a=rtpmap', codec);
        if (index === null) {
            return sdp;
        }
        var payload = getCodecPayloadTypeFromLine(sdpLines[index]);
        fmtpObj.pt = payload.toString();
        fmtpObj.params = {};
        fmtpObj.params[param] = value;
        sdpLines.splice(index + 1, 0, writeFmtpLine(fmtpObj));
    } else {
        fmtpObj = parseFmtpLine(sdpLines[fmtpLineIndex]);
        fmtpObj.params[param] = value;
        sdpLines[fmtpLineIndex] = writeFmtpLine(fmtpObj);
    }

    sdp = sdpLines.join('\r\n');
    return sdp;
}

// Remove fmtp param if it exists.
function removeCodecParam(sdp, codec, param) {
    var sdpLines = sdp.split('\r\n');

    var fmtpLineIndex = findFmtpLine(sdpLines, codec);
    if (fmtpLineIndex === null) {
        return sdp;
    }

    var map = parseFmtpLine(sdpLines[fmtpLineIndex]);
    delete map.params[param];

    var newLine = writeFmtpLine(map);
    if (newLine === null) {
        sdpLines.splice(fmtpLineIndex, 1);
    } else {
        sdpLines[fmtpLineIndex] = newLine;
    }

    sdp = sdpLines.join('\r\n');
    return sdp;
}

// Split an fmtp line into an object including 'pt' and 'params'.
function parseFmtpLine(fmtpLine) {
    var fmtpObj = {};
    var spacePos = fmtpLine.indexOf(' ');
    var keyValues = fmtpLine.substring(spacePos + 1).split(';');

    var pattern = new RegExp('a=fmtp:(\\d+)');
    var result = fmtpLine.match(pattern);
    if (result && result.length === 2) {
        fmtpObj.pt = result[1];
    } else {
        return null;
    }

    var params = {};
    for (var i = 0; i < keyValues.length; ++i) {
        var pair = keyValues[i].split('=');
        if (pair.length === 2) {
            params[pair[0]] = pair[1];
        }
    }
    fmtpObj.params = params;

    return fmtpObj;
}

// Generate an fmtp line from an object including 'pt' and 'params'.
function writeFmtpLine(fmtpObj) {
    if (!fmtpObj.hasOwnProperty('pt') || !fmtpObj.hasOwnProperty('params')) {
        return null;
    }
    var pt = fmtpObj.pt;
    var params = fmtpObj.params;
    var keyValues = [];
    var i = 0;
    for (var key in params) {
        keyValues[i] = key + '=' + params[key];
        ++i;
    }
    if (i === 0) {
        return null;
    }
    return 'a=fmtp:' + pt.toString() + ' ' + keyValues.join(';');
}

// Find fmtp attribute for |codec| in |sdpLines|.
function findFmtpLine(sdpLines, codec) {
    // Find payload of codec.
    var payload = getCodecPayloadType(sdpLines, codec);
    // Find the payload in fmtp line.
    return payload ? findLine(sdpLines, 'a=fmtp:' + payload.toString()) : null;
}

// Find the line in sdpLines that starts with |prefix|, and, if specified,
// contains |substr| (case-insensitive search).
function findLine(sdpLines, prefix, substr) {
    return findLineInRange(sdpLines, 0, -1, prefix, substr);
}

// Find the line in sdpLines[startLine...endLine - 1] that starts with |prefix|
// and, if specified, contains |substr| (case-insensitive search).
function findLineInRange(
    sdpLines,
    startLine,
    endLine,
    prefix,
    substr,
    direction
) {
    if (direction === undefined) {
        direction = 'asc';
    }

    direction = direction || 'asc';

    if (direction === 'asc') {
        // Search beginning to end
        var realEndLine = endLine !== -1 ? endLine : sdpLines.length;
        for (var i = startLine; i < realEndLine; ++i) {
            if (sdpLines[i].indexOf(prefix) === 0) {
                if (!substr ||
                    sdpLines[i].toLowerCase().indexOf(substr.toLowerCase()) !== -1) {
                    return i;
                }
            }
        }
    } else {
        // Search end to beginning
        var realStartLine = startLine !== -1 ? startLine : sdpLines.length-1;
        for (var j = realStartLine; j >= 0; --j) {
            if (sdpLines[j].indexOf(prefix) === 0) {
                if (!substr ||
                    sdpLines[j].toLowerCase().indexOf(substr.toLowerCase()) !== -1) {
                    return j;
                }
            }
        }
    }
    return null;
}

// Gets the codec payload type from sdp lines.
function getCodecPayloadType(sdpLines, codec) {
    var index = findLine(sdpLines, 'a=rtpmap', codec);
    return index ? getCodecPayloadTypeFromLine(sdpLines[index]) : null;
}

// Gets the codec payload type from an a=rtpmap:X line.
function getCodecPayloadTypeFromLine(sdpLine) {
    var pattern = new RegExp('a=rtpmap:(\\d+) [a-zA-Z0-9-]+\\/\\d+');
    var result = sdpLine.match(pattern);
    return (result && result.length === 2) ? result[1] : null;
}

// Returns a new m= line with the specified codec as the first one.
function setDefaultCodec(mLine, payload) {
    var elements = mLine.split(' ');

    // Just copy the first three parameters; codec order starts on fourth.
    var newLine = elements.slice(0, 3);

    // Put target payload first and copy in the rest.
    newLine.push(payload);
    for (var i = 3; i < elements.length; i++) {
        if (elements[i] !== payload) {
            newLine.push(elements[i]);
        }
    }
    return newLine.join(' ');
}