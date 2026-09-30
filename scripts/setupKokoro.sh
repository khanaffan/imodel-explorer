#!/usr/bin/env bash
# One-time setup of Kokoro neural TTS (~350 MB) used by `npm run docs:video`. Needs uv (brew install uv).
set -euo pipefail
dir="${IG_KOKORO_DIR:-$HOME/.cache/imodel-explorer/kokoro}"
release="https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1"
mkdir -p "$dir"
cd "$dir"
[ -x .venv/bin/python ] || uv venv -q -p 3.13 .venv
uv pip install -q -p .venv/bin/python kokoro-onnx soundfile
for f in kokoro-v1.0.onnx voices-v1.0.bin; do
  [ -s "$f" ] || { curl -fL --progress-bar -o "$f.part" "$release/$f" && mv "$f.part" "$f"; }
done
echo "Kokoro ready in $dir"
