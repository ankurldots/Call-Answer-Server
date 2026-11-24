# Phase 1 open facts

Fill this in from the frame logs (`FRAME_LOG_DIR`, one `<callSid>.jsonl` per call; the last line is the call summary).

| # | Question | How to measure | Result |
|---|----------|----------------|--------|
| 1 | Does Exotel send the Basic header to the resolve URL (`https://user:pass@host/exotel/resolve`)? | Server log `resolve` line: `authHeaderPresent` | |
| 2 | Does Exotel send the Basic header on the WebSocket handshake? | Log `handshake.refused` with `basic_auth_failed`, or a successful call in `AUTH_MODE=basic` | |
| 3 | Inbound `media` chunk size at 8000 / 16000 / 24000 Hz | Summary: `inboundChunkMin/Max/MostFrequent` | |
| 4 | Is the `sample-rate` query parameter honoured? | `start.media_format.sample_rate` in the first `start` line | |
| 5 | Content of `start.custom_parameters` and `account_sid` | `call.start` log line | |
| 6 | Are outbound chunks below 3200 bytes accepted? | Run with `ALLOW_SMALL_CHUNKS=true`, `ECHO_CHUNK_BYTES=640`; listen to the echo | |
| 7 | Round trip time between our `mark` and its return | `echo.mark_returned` `roundTripMs` | |
| 8 | Does `clear` stop playback immediately? How much audio was queued? | Press `#` during playback; `echo.clear_sent` `queuedBytes` | |
| 9 | Does the outbound tone (`*`) play without caller voice? | Press `*` | |
| 10 | Stop reason values in `stop` events | Summary `stopReason` | |
| 11 | Does the stream close when the next applet runs? | Close code and `stopReason` in the summary | |
