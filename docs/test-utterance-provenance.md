# Synthetic input provenance

Generated locally on2026-09-30 with the preinstalled FFmpeg/libflite `slt` voice; no paid speech service, downloaded recording, impersonation, or user voice cloning. Original sentences are declared verbatim in `src/test-evidence.ts`.

Each WAV uses mono PCM16LE at24000Hz and two seconds of trailing silence for provider voice-activity detection. Generation used FFmpeg's `flite=text=...:voice=slt` source, `apad=pad_dur=2`, `-ar 24000 -ac 1 -c:a pcm_s16le`. Samples are streamed by a browser AudioBufferSource through the existing resampling capture worklet, at normal playback speed. Each test button plays one sample, waits for it to finish, and sends no text-to-tool shortcut.

The client never guarantees that the provider will recognize these samples or perform the intended tool action. Actual results must be inspected and reported. Synthetic input does not establish human microphone quality or all real-world interruption behavior.
