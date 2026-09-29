# voice-booth

A voice booth for browser games and apps, built to be run with an AI collaborator. You give it the lines your app says. It gives you a page to record them, and a small runtime that plays a recording when its line shows and leaves the text alone when there isn't one. The app never waits on a voice.

It was designed and written by Claude (Anthropic's AI model) while building a game called Recyclers Anonymous, directed and tested by Don at EverySynthetic, who recorded the first lines with it. This repo is the general tool, with the game's words taken out.

## What's in it

- **`booth.html`**: the booth. One speaker at a time. Record, listen, keep or redo. Pick the mic, cut steady noise (fans), and get a warning when a take is too hot (clipped) or too quiet. Louder and Match volume even takes out. Import audio files named by line id. Download kept takes, a `takes.js`, and a credits list. Each speaker has a "voiced by" field and a "they said yes" box, so consent is on record.
- **`voice.js`**: the runtime. `VOICE.say([...lines])` plays takes in order; `VOICE.scan(element)` plays every line on screen. A line with no take, or with words changed since it was recorded, stays text. `?guide=1` has the browser read lines that have no take, so you can hear the timing.
- **Filters**: a speaker can be run through a treatment when it plays (`VOICE.FX`): deeper, ring-modulated, telephone-band. The take is stored plain, so you tune the sound without re-recording.
- **`tools/build_script.js`**: turns `lines.json` into `script.js`. Ids are pinned to their words. Change a line and it gets a new id; the old one is retired so a take is never played on words it wasn't recorded on. `reworded.json` keeps an id on purpose when an actor changed a line and you took it.
- **`tools/generate.py`**: makes synthetic takes with [Kokoro](https://github.com/thewh1teagle/kokoro-onnx) (the model is Apache-2.0 and runs on your machine) so a generated voice goes through the same booth, filter and credits as a human one. Nothing here bundles a model.

## Quick start

```
node tools/build_script.js        # lines.json -> script.js
python3 -m http.server 8000       # any static server; use the same address for the booth and your app
```

Open `http://localhost:8000/booth.html`, record, and keep. Then open `http://localhost:8000/example/demo.html` and click a scene: lines with a kept take play in your voice. Takes live in that browser's IndexedDB, so the booth and the app must share an address. To ship them, click Download kept takes and Download takes.js, put the audio where `takes.js` says, and credit everyone in `CREDITS.md`.

To use it in your own app: load `script.js`, `takes.js` and `voice.js`, then call `VOICE.say(["the exact text of a line"])` or `VOICE.scan(element)`. Set `VOICE.isMuted = () => yourMuteFlag` if you have a mute.

## Tests

```
node test/build_script.test.js
chromium --headless=new --allow-file-access-from-files --virtual-time-budget=200000 --dump-dom test/test.html
```

The second prints `RESULT: PASS`. Use the long time budget: the filter test renders audio offline.

## Limits, honestly

- Recording needs a mic and a browser that allows it (`localhost` counts). Real mic capture works in Chrome; other browsers are untested.
- The filters are tuned by ear on one game's voices. Expect to adjust them.
- Line matching is by exact words. If your app builds lines with names or numbers in the middle, they can't be matched to a recording. List them and record the fixed parts, or give the app a way to say the variable part in text.
- Nothing here makes a voice for you unless you run the generator. Read the license of any model you use, and get anyone's yes in writing before their voice ships.

## License

MIT. See `LICENSE`.
