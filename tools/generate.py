#!/usr/bin/env python3
"""Make synthetic takes for one speaker with Kokoro (Apache-2.0, runs on your machine).

  python tools/generate.py audition narrator      one line in each candidate voice -> ./audition/
  python tools/generate.py make narrator am_onyx  every line for that speaker -> ./generated/<speaker>/<id>.wav

Setup (once):
  python -m venv .venv && .venv/bin/pip install kokoro-onnx soundfile
  download kokoro-v1.0.onnx and voices-v1.0.bin (kokoro-onnx model-files-v1.0 release) into a folder,
  and point KOKORO_DIR at it (default ./kokoro).

Files are named <line id>.wav. In the booth, Import takes loads them, then Keep,
Match volume and the speaker's filter work like any recorded take. Synthetic
voices still belong in your credits: name the model and its license.
"""
import json, os, pathlib, sys
import soundfile as sf
from kokoro_onnx import Kokoro

ROOT = pathlib.Path(__file__).resolve().parent.parent
KOKORO = pathlib.Path(os.environ.get("KOKORO_DIR", ROOT / "kokoro"))
CANDIDATES = ["am_onyx", "am_fenrir", "am_michael", "am_adam", "bm_george", "bm_lewis", "af_heart", "af_bella"]

def script():
    src = (ROOT / "script.js").read_text()
    return [l for l in json.loads(src[src.index("=") + 1:].rstrip().rstrip(";")) if not l.get("retired")]

def main():
    if len(sys.argv) < 3 or sys.argv[1] not in ("audition", "make"):
        sys.exit(__doc__)
    speaker = sys.argv[2]
    lines = [l for l in script() if l["speaker"] == speaker]
    if not lines:
        sys.exit(f"no lines for speaker '{speaker}' in script.js")
    k = Kokoro(str(KOKORO / "kokoro-v1.0.onnx"), str(KOKORO / "voices-v1.0.bin"))
    say = lambda l: l.get("spoken") or l["text"]
    if sys.argv[1] == "audition":
        out = ROOT / "audition"; out.mkdir(exist_ok=True)
        line = max(lines, key=lambda l: len(say(l)))
        for v in CANDIDATES:
            s, sr = k.create(say(line), voice=v, speed=0.95, lang="en-us")
            sf.write(out / f"{speaker}_{v}.wav", s, sr); print("wrote", out / f"{speaker}_{v}.wav")
    else:
        voice = sys.argv[3]
        out = ROOT / "generated" / speaker; out.mkdir(parents=True, exist_ok=True)
        for l in lines:
            s, sr = k.create(say(l), voice=voice, speed=0.95, lang="en-us")
            sf.write(out / f"{l['id']}.wav", s, sr); print("wrote", l["id"], f"{len(s)/sr:.1f}s")

main()
