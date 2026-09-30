# Renders narration clips with Kokoro (https://github.com/thewh1teagle/kokoro-onnx) for
# scripts/tutorialVideo.mjs. Reads [{"text": ..., "out": ".../x.wav"}, ...] as JSON on stdin.
# Usage: python tts_kokoro.py <model.onnx> <voices.bin> <voice> <speed>
import json
import sys

import soundfile
from kokoro_onnx import Kokoro

model, voices, voice, speed = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4])
kokoro = Kokoro(model, voices)
for clip in json.load(sys.stdin):
    samples, rate = kokoro.create(clip["text"], voice=voice, speed=speed, lang="en-us")
    soundfile.write(clip["out"], samples, rate)
