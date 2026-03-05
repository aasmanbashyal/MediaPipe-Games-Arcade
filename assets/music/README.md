# 🎵 Music Assets

Place your music files (`.mp3`, `.ogg`, `.wav`) in this directory.

## How to Add Tracks

1. Drop your audio file into this folder (e.g., `my-song.mp3`)
2. Edit `tracks.json` to register it:

```json
{
  "tracks": [
    { "name": "My Song", "file": "my-song.mp3", "bpm": 120, "duration": 45 }
  ]
}
```

3. The track will appear in the Starri Motion game's track selector.

## Supported Formats

- `.mp3` — Best compatibility
- `.ogg` — Smaller file size, good quality
- `.wav` — Uncompressed, larger files

## Notes

- Keep files under 10MB for fast loading
- BPM is optional but helps with beat-synced arrow generation
- Duration (in seconds) helps the game know when the song ends
