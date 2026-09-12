#!/usr/bin/env bash
set -euo pipefail
models=/opt/meddesk/shared/speech-models
mkdir -p "$models"
fetch_model() {
    local name="$1" url="$2" checksum="$3"
    if ! test -f "$models/$name"; then
        curl --fail --location --silent --show-error --connect-timeout 10 --max-time 180 --retry 2 "$url" -o "$models/$name.part"
        printf '%s  %s\n' "$checksum" "$models/$name.part" | sha256sum --check
        mv "$models/$name.part" "$models/$name"
    fi
    printf '%s  %s\n' "$checksum" "$models/$name" | sha256sum --check
    chmod 644 "$models/$name"
}
fetch_model ggml-small-q5_1.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-small-q5_1.bin ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb
fetch_model ggml-silero-v5.1.2.bin https://huggingface.co/ggml-org/whisper-vad/resolve/9ffd54a1e1ee413ddf265af9913beaf518d1639b/ggml-silero-v5.1.2.bin 29940d98d42b91fbd05ce489f3ecf7c72f0a42f027e4875919a28fb4c04ea2cf
chmod 755 "$models"
