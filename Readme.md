<div align="center">
  <img src="https://raw.githubusercontent.com/google/mediapipe/master/docs/images/mobile/gesture_recognition_android_gpu.gif" alt="MediaPipe Gesture Recognition" width="100%" style="border-radius: 12px; margin-bottom: 20px; object-fit: cover; max-height: 250px;">

  # 🎮 MediaGames Arcade
  **Fun Web Games Powered by AI Hand Tracking!**

  [![License: MIT](https://img.shields.io/badge/License-MIT-purple.svg)](https://opensource.org/licenses/MIT)
  [![Made with MediaPipe](https://img.shields.io/badge/Powered_by-MediaPipe-blue)](https://ai.google.dev/edge/mediapipe/solutions/vision/gesture_recognizer)

  <p align="center">
    A collection of browser games built for fun and for my nephew to play. You can control the games using only your webcam and your hands — no controllers needed!
  </p>

  ### [🚀 Play the Live Demo Here!](https://mediagames-ten.vercel.app/)
</div>

---

## ✨ Features
- **Browser-Based**: Runs entirely in your browser without needing to install anything.
- **Controller-Free**: Uses your webcam and Google MediaPipe to track your hand movements and gestures.
- **Fun Interface**: Colorful design with cool neon effects.
- **Several Games**: Includes rhythm, reflex, and casual games to try out.

---

## 🕹️ Games Included

| Game | Type | Description |
|------|------|-------------|
| 🎵 **Starri Motion** | Rhythm | Catch directional arrows (↑, ↓, ←, →) with your hands to the beat of the music! |
| 🏒 **Air Hockey** | Sports | Control paddles with your hands. Play against an AI opponent or a friend. |
| 🫧 **Bubble Pop** | Casual | Pop floating bubbles for points before the time runs out. |
| ⚡ **Reaction Duel** | Reflex | Race to touch targets as soon as they appear! Test your reflexes. |
| 🍉 **Fruit Ninja** | Action | Swipe your hands through the air to slice flying fruits and avoid bombs. |
| 🤲 **Shadow Puppets** | Puzzle | Match your hand gestures (👍, ✌️, ✊, ✋) to the targets on screen. |

---

## 🛠️ Tech Stack

- **Hand Tracking AI**: [MediaPipe GestureRecognizer API](https://ai.google.dev/edge/mediapipe/solutions/vision/gesture_recognizer) (Tracks 21 hand landmarks and common gestures)
- **Rendering**: HTML5 Canvas 2D
- **Audio Output**: Web Audio API and standard `<audio>` tags for background music.
- **Styling**: Vanilla CSS.

---

## 🚀 Quick Start (Local Development)

You need to run a local web server to play the games locally because the project uses native ES modules (`type="module"`).

### Option 1: Python
If you have Python installed, open the terminal in the project folder and run:
```bash
python -m http.server 8000
```
Then visit `http://localhost:8000` in your browser.

### Option 2: Live Server (VS Code)
If you are using Visual Studio Code, install the **Live Server** extension. Right-click on `index.html` and click **"Open with Live Server"**.

### Option 3: Node.js
If you have Node.js installed:
```bash
npx -y serve .
```

---

## ☁️ Deployment

You can deploy your own version easily using Vercel.

1. Install the Vercel CLI:
   ```bash
   npm i -g vercel
   ```
2. Navigate to your project folder:
   ```bash
   vercel
   ```
3. Follow the CLI prompts to deploy.

> **Note:** Accessing the webcam requires a secure connection (HTTPS). Vercel handles this automatically, but if you host it elsewhere, make sure it has an SSL certificate.

---

## 🎵 Customizing Music (`Starri Motion`)

You can easily add your own music:
1. Place standard `.mp3`, `.ogg`, or `.wav` audio files into the `assets/music/` directory.
2. Edit `assets/music/tracks.json` to register the new tracks:
   ```json
   {
     "tracks": [
       { "name": "My Song", "file": "my-song.mp3" }
     ]
   }
   ```

---

## 📄 License

This project is licensed under the MIT License. Feel free to use and modify it!