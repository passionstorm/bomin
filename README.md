# bomin
Simple and efficient live server:
- Installation and use is very simple;
- Pure Golang writing, high performance, cross-platform;
- Support common transmission protocols, file formats, and encoding formats;

#### Supported transport protocols
- [x] RTMP
- [x] AMF
- [x] HLS
- [x] HTTP-FLV

#### Supported container formats
- [x] FLV
- [x] TS

#### Supported encoding formats
- [x] H264
- [x] AAC
- [x] MP3

## Installation
Directly download the compiled [binary file] (https://github.com/passionstorm/bomin/releases) and execute it on the command line.

#### Compiling from source
1. Download the source `git clone https://github.com/passionstorm/bomin.git`
2. Go to the livego directory and execute `go build`

## Use
2. Start the service: execute the `livego` binary to start the livego service;
3. Upstream Push: Push the video stream to `rtmp://localhost:1935/live/movie` via the `RTMP` protocol, for example using `ffmpeg -re -i demo.flv -c copy -f flv rtmp:/ /localhost:1935/live/movie` push;
4. Downstream playback: The following three playback protocols are supported. The playback address is as follows:
    - `RTMP`:`rtmp://localhost:1935/live/movie`
    - `FLV`:`http://127.0.0.1:7001/live/movie.flv`
    - `HLS`:`http://127.0.0.1:7002/live/movie.m3u8`