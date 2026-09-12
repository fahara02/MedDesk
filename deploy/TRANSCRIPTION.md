# Hosted dictation

Run `bash deploy/setup-transcription.sh` on the deployment host before the first
`docker compose -f deploy/compose.nginx.yml up -d --wait app`.
It installs checksum-pinned model files in `/opt/meddesk/shared/speech-models`.
The Compose file pins the runtime image by digest. It adds a separate internal
service, two CPU cores, a 1.5 GiB RAM ceiling and 96 MiB temporary filesystem.
No ASR port is published. Only the authenticated Node API accepts browser audio.

The implementation uses the upstream [whisper.cpp server](https://github.com/ggml-org/whisper.cpp/blob/master/examples/server/README.md)
with multipart audio, fixed language, transcription rather than translation,
and voice activity detection. The pinned runtime's source sets `no_context=true`
and `print_realtime=false`. Container logging is disabled, the root filesystem
and models are read-only, and temporary conversion files live in RAM. Test
requests left that directory empty. Model files come from the upstream
[model distribution](https://huggingface.co/ggerganov/whisper.cpp) and
[VAD distribution](https://huggingface.co/ggml-org/whisper-vad).

The browser's primary Start dictation button records using the selected input;
Stop dictation sends audio for conversion to editable text. A visible microphone
level distinguishes input problems from recognition failures. Explicit insertion
is still required. Sample comparison upload is separate and never automatic.

Do not call this clinically validated. The first synthetic English test returned
recognizable text with one repeated sentence. Synthetic Bengali failed and
returned an unrelated script, now rejected by the application. Selected-language
script and repetition checks catch that failure; they are not accuracy proof.
The owner's microphone and natural speech still need verification.

Online ASR was tried with the existing account but returned
`403 AllocationQuota.FreeTierOnly`. No account billing setting was changed.
