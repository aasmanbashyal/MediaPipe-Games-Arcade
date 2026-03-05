# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running Locally

A local server is required because the project uses ES modules (`type="module"`). Opening `index.html` directly as a file won't work.

```bash
# Python (simplest)
python -m http.server 8000

# Node.js
npx -y serve .
```

Open `http://localhost:8000`. No build step — pure HTML/CSS/JS.

## Architecture

**MediaGames** is a static, no-build hand-tracking arcade. All games share a fixed virtual canvas of `960x540` (exported as `GAME_WIDTH`/`GAME_HEIGHT` from `shared/hand-tracker.js`), independent of webcam resolution.

### Shared Modules (`shared/`)

- **`hand-tracker.js`** — Core module. Wraps MediaPipe GestureRecognizer (loaded from CDN). Exports:
  - `initHandTracker(video, onReady, onError)` — initializes webcam + GestureRecognizer
  - `detectHands()` — call once per animation frame to update internal pointer state
  - `getPointers()` — returns array of 2 pointer objects `{ x, y, active, grace, landmarks, gesture }`
  - `drawPointers(ctx, w, h)` / `drawSkeleton(ctx, w, h)` — rendering helpers
  - Pointer[0] = user's left hand, Pointer[1] = user's right hand (MediaPipe reports camera-mirrored handedness)
  - Uses One Euro Filter for smooth, jitter-free tracking; grace frames prevent hand-loss flickering

- **`game-init.js`** — `setupGame(opts)` helper that wires webcam + canvas sizing + the render loop. Games that don't need special setup can use this; others (like Air Hockey) initialize directly.

- **`audio.js`** — Synthesized SFX via Web Audio API (`playPop`, `playHit`, `playGoal`, `playSlice`, `playBomb`, `playMiss`, `playSuccess`, `playTick`, `resumeAudio`). Also exports `MusicManager` class for file-based music via `<audio>` element.

- **`particles.js`** — `ParticleSystem` class with object pooling (pre-allocated pool of 500). Methods: `explode(x, y, color, count)`, `sparkle(x, y, color)`, `update()`, `draw(ctx)`.

- **`background.js`** — Starfield background renderer (shared across games).

- **`game-base.css`** — Common game styles (layout, overlays, mini canvas positioning).

### Game Structure

Each game lives in `games/<name>/` with `index.html`, `style.css`, and `game.js`. Games import directly from `../../shared/`. All game state machines use a `state` variable cycling through phases like `menu → countdown → playing → results`.

### Canvas Layout

Each game HTML has:
- `#webcamView` — hidden `<video>` element fed to MediaPipe
- `#gameCanvas` — main rendering canvas (mirrored with `transform: scaleX(-1)` so left/right match user's perspective)
- `#miniCanvas` — small overlay showing hand skeleton

### Music

Tracks are registered in `public/music/tracks.json` with `{ name, file, bpm, duration }`. Games fetch this manifest at startup and pick a random track. Supported formats: `.mp3`, `.ogg`, `.wav`.

## Deployment

Static site — deploy to Vercel with no build config needed:

```bash
vercel --prod
```

Webcam access requires HTTPS (Vercel provides this automatically).
