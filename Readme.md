# MediaGames Arcade

Six browser games built for my nephew, with camera hand tracking or local mouse
and touch controls. [Play the arcade](https://mediagames-ten.vercel.app/).

| Game | How to play |
| --- | --- |
| Starri Motion | Catch directional notes with your hands or pointer. Hold still in the calibration zone before starting. |
| Air Hockey | Move a paddle against the computer, or play with two hands or two touch points. |
| Bubble Pop | Touch bubbles before the round ends. |
| Reaction Duel | Reach targets quickly and compare reaction times. |
| Fruit Ninja | Swipe through fruit and avoid bombs. |
| Shadow Puppets | Hold the requested hand gesture. Pointer practice provides buttons and number keys 1–7. |

## Controls

Choose **Use camera** or **Mouse or touch** when entering a game, then choose a
mode or difficulty. A mouse controls one pointer; touch supports two simultaneous
contacts. Camera mode supports up to two hands, including two players using the
same hand. Keep both hands visible and separated.

**Pause** or **Esc** freezes the round. The pause menu can resume, restart, return
to the arcade, or turn off the camera and switch to pointer controls. Games pause
when the tab becomes hidden or tracking fails. Camera errors offer a retry and
pointer fallback. Navigation stops the camera; returning through browser history
asks you to select controls again.

The interface supports portrait and landscape layouts, keyboard focus, and
reduced-motion preferences. Landscape gives more room for the 16:9 playfield.

## Run locally

The app remains plain HTML, CSS, and native JavaScript modules with no build step.
Development and tests use Bun 1.3.10 and Node.js 24.

```sh
bun install --frozen-lockfile
bun run dev
```

Open `http://127.0.0.1:4174`. Any static server also works, for example
`uv run python -m http.server 8000`. Deploy the repository as a static site with
no build command. Camera access requires HTTPS or localhost.

## Local AI with LiteRT

Camera mode runs the official MediaPipe palm detector, hand-landmark detector,
gesture embedder, and canned gesture classifier through **LiteRT.js 2.6.0** on
its WebAssembly CPU backend. A worker processes one frame at a time while the
main thread renders the games. Transferred image snapshots keep all four graphs
on the same frame; late results are ignored after input changes.

The pinned `float16/1` model bundle downloads about 8.4 MB on first camera use,
plus the LiteRT runtime. Runtime code comes from jsDelivr and models from Google
Cloud Storage. Frames stay on the device. Pointer mode does not load an AI
runtime or request camera permission, and works when external services fail.

This path requires WebAssembly, workers, OffscreenCanvas, and ImageBitmap. Current
Chromium was tested. Unsupported browsers can use pointer controls. CPU inference
speed varies by device; there is no measured claim of faster inference than the
previous MediaPipe Tasks implementation. Worker inference keeps that CPU work
off the rendering thread. Physical webcam sessions and mobile hardware still
need broader testing.

The classifier declares a dynamic batch signature even though its stored shape
is batch one. `shared/tflite-batch.js` specializes only those batch dimensions
before LiteRT compilation. It rejects other dynamic dimensions and does not
change model weights. See [third-party references](THIRD_PARTY_NOTICES.md).

## Tests

```sh
bunx playwright install chromium
bun run test
```

Unit tests cover pause clocks, frame-rate independence, hockey collision/goal
rules, swept fruit collisions, gesture targets, rhythm misses, calibration,
coordinate conversion, hand-model geometry, and model shape specialization.
Desktop and phone browser tests exercise all six games, start/pause/restart,
camera denial, late initialization, focus loss, and history recovery. These
checks block external services or mock the camera model so CI is deterministic.
GitHub Actions runs them for pull requests and main.

An optional real inference check downloads the pinned runtime/model and official
reference images, detects two hands, validates finite landmark coordinates, and
recognizes a closed fist. A second check feeds a real video track through the
game's worker pipeline and verifies that switching controls stops the stream:

```sh
bun run test:vision
```

This test requires network access and is separate from ordinary CI. The fixture
checks do not replace real-camera playtesting.

## Music

Add `.mp3`, `.ogg`, or `.wav` files to `assets/music/` and register them in
`assets/music/tracks.json`:

```json
{
  "tracks": [
    { "name": "My song", "file": "my-song.mp3", "bpm": 120, "duration": 45 }
  ]
}
```

Starri continues its game clock if optional music is missing or the browser
blocks playback.
