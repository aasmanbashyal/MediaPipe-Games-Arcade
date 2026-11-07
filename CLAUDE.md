# Working on MediaGames

This is a static HTML/CSS/ES-module arcade. Keep the no-build deployment.
Use `bun install --frozen-lockfile`, `bun run dev`, and `bun run test` for local
development. Tests also need Node.js 24 and `bunx playwright install chromium`.
The optional `bun run test:vision` downloads real models and reference images.

## Architecture

- Every game lives in `games/<name>/` with `index.html`, `style.css`, and `game.js`.
- `shared/hand-tracker.js` owns input selection, webcam cleanup, pointer controls,
  smoothing, two-hand assignment, and gesture practice. `detectHands()` schedules
  asynchronous inference; games read the latest pointers through `getPointers()`.
  Pointer `sampleTime` is the capture timestamp, not the rendering timestamp.
- `shared/gesture-model.js` manages LiteRT worker inference. Keep CDN versions and
  model URLs pinned. `hand-model-math.js` implements palm/landmark/gesture geometry;
  `tflite-batch.js` specializes dynamic batch-one signatures for LiteRT.
- `shared/game-controls.js` provides pause, restart, input recovery, and navigation.
  Each game connects it to `GameClock` in `shared/gameplay-clock.js`. Deadlines use
  active game time, never raw wall time. Hockey uses fixed simulation steps.
- `shared/hockey-physics.js` contains deterministic collision and scoring rules.
- `shared/audio.js` provides synthesized effects and `MusicManager`. Handle rejected
  playback promises. Music is optional and must not stop round progression.
- `shared/game-base.css` holds responsive menus, input controls, scores, and dialogs.
  Game-specific CSS loads afterward, so check selector specificity on small screens.
- `shared/particles.js` and `shared/background.js` draw shared visual effects.

## Coordinates and lifecycle

The virtual canvas is 960 × 540, independent of camera resolution. CSS mirrors the
canvas once. Camera landmarks remain in raw image coordinates; screen pointers
are mapped through `pointerToGame`. Do not mirror again in game logic. Text drawn
inside a mirrored canvas needs its own counter-transform.

Check both mouse and touch when changing input. Camera initialization is explicit
and lazy; local pointer play must survive CDN failure. Close models and stop all
media tracks on input changes and departure. Guard late async completions so they
cannot reactivate an abandoned camera session. Returning from the browser cache
must restore a usable control chooser before resuming the round.

## Validation and deployment

Run relevant unit and browser tests after behavior changes. For inference changes,
also run the optional real-model check and compare plausible landmarks/gestures.
Verify portrait and landscape layouts when moving game controls. Document any
hardware or browser behavior that remains untested.

Deploy as a static site without a build command. HTTPS is required for webcams
outside localhost. Tracks belong in `assets/music/`, with metadata in
`assets/music/tracks.json`.
