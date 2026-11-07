import { GameClock } from '../../shared/gameplay-clock.js';
import { createGameControls } from '../../shared/game-controls.js';
import { initHandTracker, detectHands, getPointers, drawSkeleton, drawPointers, GAME_WIDTH, GAME_HEIGHT } from '../../shared/hand-tracker.js';
import { ParticleSystem } from '../../shared/particles.js';
import { playPop, playMiss, playSuccess, playTick, resumeAudio, MusicManager } from '../../shared/audio.js';
import { Background } from '../../shared/background.js';

// ---- DIRECTION DEFINITIONS ----
const DIRECTIONS = {
    up: { dx: 0, dy: -1, symbol: '↑', angle: -Math.PI / 2 },
    down: { dx: 0, dy: 1, symbol: '↓', angle: Math.PI / 2 },
    left: { dx: -1, dy: 0, symbol: '←', angle: Math.PI },
    right: { dx: 1, dy: 0, symbol: '→', angle: 0 },
};
const DIR_KEYS = ['up', 'down', 'left', 'right'];

const LEVELS = {
    easy: { name: 'Easy', directions: DIR_KEYS, noteInterval: 1.5, arrowSpeed: 2.0, targetRadius: 130, hitWindow: 0.45, duration: 30, doubleChance: 0, targetOffset: 110 },
    medium: { name: 'Medium', directions: DIR_KEYS, noteInterval: 0.9, arrowSpeed: 1.5, targetRadius: 110, hitWindow: 0.35, duration: 40, doubleChance: 0.15, targetOffset: 120 },
    hard: { name: 'Hard', directions: DIR_KEYS, noteInterval: 0.55, arrowSpeed: 1.0, targetRadius: 90, hitWindow: 0.25, duration: 50, doubleChance: 0.3, targetOffset: 130 },
};

const PLAY_ZONE = { cx: 0.5, cy: 0.48, w: 0.35, h: 0.45 };
const ARROW_COLORS = { up: '#00e5ff', down: '#ff6ec7', left: '#7b61ff', right: '#ffeb3b' };

const STATE = { MENU: 'menu', CALIBRATING: 'calibrating', COUNTDOWN: 'countdown', PLAYING: 'playing', RESULTS: 'results' };

// ---- GAME VARIABLES ----
let gameState = STATE.MENU;
const clock = new GameClock();
let sessionGeneration = 0;
let currentLevel = null, selectedLevelId = null;
let beatmap = [], activeNoteStartIndex = 0, gameStartTime = 0;
let calibrationProgress = 0, calibrationStartTime = 0;
const CALIBRATION_NEEDED = 2.0;
let countdownValue = 3, countdownStartTime = 0;
let score = 0, combo = 0, maxCombo = 0, perfectCount = 0, greatCount = 0, goodCount = 0, missCount = 0;
let feedbackTimeout = null;
const particles = new ParticleSystem();
const bg = new Background(50, { speed: 0.4 });
const music = new MusicManager();

// Track list
let availableTracks = [];
let selectedTrackIdx = -1; // -1 = use fallback timer

// ---- DOM ----
const videoElement = document.getElementById('webcamView');
const canvasElement = document.getElementById('gameCanvas');
const canvasCtx = canvasElement.getContext('2d');
const miniCanvas = document.getElementById('miniCanvas');
const miniCtx = miniCanvas.getContext('2d');

const uiOverlay = document.getElementById('uiOverlay');
const screenTitle = document.getElementById('screenTitle');
const taglineText = document.getElementById('taglineText');
const levelSelect = document.getElementById('levelSelect');
const resultsPanel = document.getElementById('resultsPanel');
const statusText = document.getElementById('statusText');

const hudOverlay = document.getElementById('hudOverlay');
const progressBar = document.getElementById('progressBar');
const scoreDisplay = document.getElementById('scoreDisplay');
const comboBox = document.getElementById('comboBox');
const comboDisplay = document.getElementById('comboDisplay');
const hitFeedback = document.getElementById('hitFeedback');

const calibrationOverlay = document.getElementById('calibrationOverlay');
const calibrationTitle = document.getElementById('calibrationTitle');
const calibrationHint = document.getElementById('calibrationHint');
const calibrationRingCanvas = document.getElementById('calibrationRing');
const calibrationRingCtx = calibrationRingCanvas.getContext('2d');
const countdownDisplay = document.getElementById('countdownDisplay');

// ---- LOAD TRACKS ----
async function loadTrackList() {
    try {
        const resp = await fetch('../../assets/music/tracks.json?v=' + Date.now());
        const data = await resp.json();
        availableTracks = data.tracks || [];
    } catch {
        availableTracks = [];
    }
}

const controls = createGameControls({
    getState: () => gameState,
    onPause: () => { clock.pause(); music.pause(); },
    onResume: () => { clock.resume(); if (gameState === STATE.PLAYING) music.play().catch(() => {}); },
    onRestart: () => { clock.resume(); music.stop(); sessionGeneration++; enterCalibration(); },
});

// ---- INIT ----
statusText.innerText = "Loading AI...";
levelSelect.style.display = 'none';
uiOverlay.style.display = 'flex';
hudOverlay.style.display = 'none';
calibrationOverlay.style.display = 'none';

loadTrackList();

initHandTracker(videoElement, (vw, vh) => {
    canvasElement.width = GAME_WIDTH; canvasElement.height = GAME_HEIGHT;
    miniCanvas.width = vw; miniCanvas.height = vh;
    statusText.innerText = "Choose your level";
    levelSelect.style.display = 'flex';
    requestAnimationFrame(mainLoop);
}, err => { statusText.innerText = "Failed — " + err.message; });

// ---- EVENT LISTENERS ----
document.querySelectorAll('.level-card').forEach(card => {
    card.addEventListener('click', () => {
        resumeAudio();
        const id = card.dataset.level;
        if (LEVELS[id]) { selectedLevelId = id; currentLevel = LEVELS[id]; enterCalibration(); }
    });
});

document.getElementById('playAgainBtn')?.addEventListener('click', () => {
    gameState = STATE.MENU;
    resultsPanel.style.display = 'none';
    levelSelect.style.display = 'flex';
    screenTitle.innerText = 'STARRI MOTION';
    taglineText.style.display = 'block';
    statusText.innerText = 'Choose your level';
    statusText.style.display = 'block';
    uiOverlay.style.display = 'flex';
});

// ---- CALIBRATION ----
function enterCalibration() {
    clock.resetFrame();
    gameState = STATE.CALIBRATING; calibrationProgress = 0; calibrationStartTime = 0;
    uiOverlay.style.display = 'none'; calibrationOverlay.style.display = 'flex';
    hudOverlay.style.display = 'none'; countdownDisplay.style.display = 'none';
    calibrationTitle.innerText = 'GET READY';
    calibrationHint.innerText = document.body.dataset.inputMode === 'pointer'
        ? 'Hold your pointer in the circle for 2 seconds. On touchscreens, press and hold.'
        : 'Hold either hand in the circle for 2 seconds.';
    calibrationHint.style.display = 'block';
    calibrationRingCanvas.style.display = 'block';
    positionCalibrationRing();
}

function positionCalibrationRing() {
    const rect = canvasElement.getBoundingClientRect();
    // The visual target and hit area share screen geometry, including the
    // letterboxed playfield and its mirror. Keep the target usable on phones.
    const geometry = {
        x: rect.left + (1 - PLAY_ZONE.cx) * rect.width,
        y: rect.top + PLAY_ZONE.cy * rect.height,
        size: Math.min(200, Math.max(120, rect.height * 0.7)),
        rect,
    };
    calibrationOverlay.style.setProperty('--calibration-x', geometry.x + 'px');
    calibrationOverlay.style.setProperty('--calibration-y', geometry.y + 'px');
    calibrationOverlay.style.setProperty('--calibration-size', geometry.size + 'px');
    return geometry;
}

function updateCalibration() {
    const target = positionCalibrationRing();
    const detectRadius = target.size * 0.4; // Matches the 80px radius in the 200px ring canvas.
    const pointers = getPointers();
    let handInZone = false;
    for (const p of pointers) {
        if (!p.active) continue;
        const dx = target.rect.left + (1 - p.x) * target.rect.width - target.x;
        const dy = target.rect.top + p.y * target.rect.height - target.y;
        if (Math.sqrt(dx * dx + dy * dy) < detectRadius) { handInZone = true; break; }
    }
    if (handInZone) {
        if (calibrationStartTime === 0) calibrationStartTime = clock.now();
        calibrationProgress = Math.min(1, (clock.now() - calibrationStartTime) / (CALIBRATION_NEEDED * 1000));
        if (calibrationProgress >= 1) { enterCountdown(); return; }
    } else {
        calibrationProgress = 0; calibrationStartTime = 0;
    }
    drawCalibrationRing(calibrationProgress, handInZone);
}

function drawCalibrationRing(progress, active) {
    const c = calibrationRingCanvas, ctx = calibrationRingCtx;
    const size = c.width, center = size / 2, radius = 80;
    ctx.clearRect(0, 0, size, size);
    ctx.beginPath(); ctx.arc(center, center, radius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 6; ctx.stroke();
    if (progress > 0) {
        ctx.beginPath(); ctx.arc(center, center, radius, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
        ctx.strokeStyle = active ? '#00e5ff' : '#7b61ff'; ctx.lineWidth = 6; ctx.stroke();
        ctx.globalAlpha = 0.3; ctx.lineWidth = 12; ctx.stroke(); ctx.globalAlpha = 1.0;
    }
    ctx.beginPath(); ctx.arc(center, center, 12, 0, Math.PI * 2);
    ctx.fillStyle = active ? 'rgba(0,229,255,0.6)' : 'rgba(255,255,255,0.2)'; ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '900 24px Outfit'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(Math.round(progress * 100) + '%', center, center);
}

// ---- COUNTDOWN ----
function enterCountdown() {
    gameState = STATE.COUNTDOWN; countdownValue = 3; countdownStartTime = clock.now();
    calibrationHint.style.display = 'none'; calibrationRingCanvas.style.display = 'none';
    calibrationTitle.innerText = ''; countdownDisplay.style.display = 'block'; countdownDisplay.innerText = '3';
}

function updateCountdown() {
    positionCalibrationRing();
    const elapsed = (clock.now() - countdownStartTime) / 1000;
    const newVal = 3 - Math.floor(elapsed);
    if (newVal !== countdownValue && newVal > 0) {
        countdownValue = newVal; countdownDisplay.innerText = String(countdownValue);
        countdownDisplay.style.animation = 'none'; void countdownDisplay.offsetWidth;
        countdownDisplay.style.animation = 'countdownPulse 0.8s ease-out';
        playTick();
    }
    if (newVal <= 0) { countdownDisplay.innerText = 'GO!'; if (elapsed > 3.6) startGameSession(); }
}

// ---- BEATMAP ----
function generateBeatmap(levelId) {
    const config = LEVELS[levelId]; const map = []; const dirs = config.directions;
    let t = 2.0, lastDir = '';
    while (t < config.duration) {
        let dir = dirs[Math.floor(Math.random() * dirs.length)];
        if (dir === lastDir && dirs.length > 1) dir = dirs[Math.floor(Math.random() * dirs.length)];
        lastDir = dir;
        map.push({ time: t, dir, hit: false, missed: false });
        if (config.doubleChance > 0 && Math.random() < config.doubleChance) {
            let dir2 = dir; while (dir2 === dir) dir2 = dirs[Math.floor(Math.random() * dirs.length)];
            map.push({ time: t, dir: dir2, hit: false, missed: false });
        }
        t += config.noteInterval + (Math.random() - 0.5) * config.noteInterval * 0.35;
    }
    return map;
}

// ---- GAME SESSION ----
async function startGameSession() {
    const generation = ++sessionGeneration;
    gameState = STATE.PLAYING; beatmap = generateBeatmap(selectedLevelId); activeNoteStartIndex = 0;
    score = 0; combo = 0; maxCombo = 0; perfectCount = 0; greatCount = 0; goodCount = 0; missCount = 0;
    particles.clear(); updateHUD(); gameStartTime = clock.now();
    calibrationOverlay.style.display = 'none'; uiOverlay.style.display = 'none'; hudOverlay.style.display = 'block';

    // Try loading a music track
    if (availableTracks.length > 0) {
        selectedTrackIdx = 0;
        const track = availableTracks[selectedTrackIdx];
        try {
            await music.loadTrack('../../assets/music/' + track.file);
            if (generation !== sessionGeneration || gameState !== STATE.PLAYING) return;
            music.currentTime = 0;
            if (!clock.paused) await music.play();
        } catch {
            // Music is optional; the active game clock continues without it.
        }
    }
}

function endGameSession() {
    sessionGeneration++;
    gameState = STATE.RESULTS; hudOverlay.style.display = 'none'; uiOverlay.style.display = 'flex';
    screenTitle.innerText = 'STAGE CLEARED'; taglineText.style.display = 'none';
    levelSelect.style.display = 'none'; statusText.style.display = 'none'; resultsPanel.style.display = 'block';
    document.getElementById('finalScore').innerText = score.toLocaleString();
    document.getElementById('finalMaxCombo').innerText = maxCombo;
    document.getElementById('finalPerfects').innerText = perfectCount;
    const totalNotes = beatmap.length;
    const hitRate = totalNotes > 0 ? (perfectCount + greatCount + goodCount) / totalNotes : 0;
    let rating = 'D';
    if (hitRate >= 0.95 && perfectCount / totalNotes >= 0.7) rating = 'S';
    else if (hitRate >= 0.9) rating = 'A'; else if (hitRate >= 0.75) rating = 'B'; else if (hitRate >= 0.5) rating = 'C';
    document.getElementById('finalRating').innerText = rating;
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    music.stop(); playSuccess();
}

function getCurrentGameTime() {
    return (clock.now() - gameStartTime) / 1000;
}

// ---- HIT DETECTION ----
function getPlayZonePixels() {
    return {
        cx: PLAY_ZONE.cx * canvasElement.width, cy: PLAY_ZONE.cy * canvasElement.height,
        w: PLAY_ZONE.w * canvasElement.width, h: PLAY_ZONE.h * canvasElement.height
    };
}

function getTargetPosition(dir) {
    const pz = getPlayZonePixels(); const offset = currentLevel ? currentLevel.targetOffset : 110;
    const d = DIRECTIONS[dir];
    return { x: pz.cx + d.dx * offset, y: pz.cy + d.dy * offset };
}

function processHitDetection(currentTime) {
    if (!currentLevel) return;
    const w = canvasElement.width, h = canvasElement.height;
    const hitRadius = currentLevel.targetRadius, hitWindow = currentLevel.hitWindow;
    const ptrs = getPointers().filter(p => p.active).map(p => ({ x: p.x * w, y: p.y * h }));
    const pz = getPlayZonePixels();

    for (let i = activeNoteStartIndex; i < beatmap.length; i++) {
        const note = beatmap[i]; if (note.hit || note.missed) continue;
        const timeDiff = note.time - currentTime;
        if (timeDiff > hitWindow) break;
        if (timeDiff < -hitWindow) { note.missed = true; missCount++; resetCombo(); showHitFeedback('MISS', 'miss'); playMiss(); continue; }
        const target = getTargetPosition(note.dir);
        for (const ptr of ptrs) {
            const dx = ptr.x - target.x, dy = ptr.y - target.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const d = DIRECTIONS[note.dir];
            const handRelX = ptr.x - pz.cx, handRelY = ptr.y - pz.cy;
            let dirOk = true;
            if (d.dx !== 0) dirOk = (d.dx > 0 && handRelX > 0) || (d.dx < 0 && handRelX < 0);
            if (d.dy !== 0) dirOk = dirOk && ((d.dy > 0 && handRelY > 0) || (d.dy < 0 && handRelY < 0));
            if (distance <= hitRadius && dirOk) {
                note.hit = true;
                const abs = Math.abs(timeDiff);
                let pts = 50, txt = 'GOOD', cls = 'good';
                if (abs < hitWindow * 0.3) { pts = 300; txt = 'PERFECT'; cls = 'perfect'; perfectCount++; }
                else if (abs < hitWindow * 0.65) { pts = 150; txt = 'GREAT'; cls = 'great'; greatCount++; }
                else goodCount++;
                incrementCombo(pts); showHitFeedback(txt, cls);
                const color = ARROW_COLORS[note.dir] || '#fff';
                particles.explode(target.x, target.y, color);
                playPop(600 + pts);
                break;
            }
        }
    }
}

// ---- SCORING ----
function incrementCombo(points) {
    combo++; if (combo > maxCombo) maxCombo = combo;
    score += points * Math.min(combo, 50); updateHUD();
    comboBox.style.opacity = 1; comboBox.style.transform = 'scale(1.3)';
    setTimeout(() => { comboBox.style.transform = 'scale(1)'; }, 120);
}
function resetCombo() {
    if (combo > 0) {
        combo = 0; comboBox.style.opacity = 0; updateHUD();
        document.body.classList.add('flash-red'); setTimeout(() => document.body.classList.remove('flash-red'), 200);
    }
}
function updateHUD() { scoreDisplay.innerText = score.toLocaleString(); comboDisplay.innerText = combo; }
function showHitFeedback(text, className) {
    if (feedbackTimeout) clearTimeout(feedbackTimeout);
    hitFeedback.className = ''; hitFeedback.innerText = text; void hitFeedback.offsetWidth;
    hitFeedback.classList.add('show', className);
    feedbackTimeout = setTimeout(() => { hitFeedback.className = ''; }, 700);
}
function updateProgress(currentTime) {
    const duration = currentLevel ? currentLevel.duration : 30;
    progressBar.style.width = Math.min((currentTime / duration) * 100, 100) + '%';
}

// ---- MAIN LOOP ----
function mainLoop() {
    document.body.dataset.gameState = gameState; controls.update();
    clock.frame();
    if (clock.paused) { requestAnimationFrame(mainLoop); return; }
    detectHands();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    miniCtx.clearRect(0, 0, miniCanvas.width, miniCanvas.height);
    drawSkeleton(miniCtx, miniCanvas.width, miniCanvas.height);

    switch (gameState) {
        case STATE.MENU: case STATE.RESULTS:
            drawDynamicBackground(clock.now() / 1000); break;
        case STATE.CALIBRATING:
            drawDynamicBackground(clock.now() / 1000); drawPlayZoneOutline();
            drawPointers(canvasCtx, canvasElement.width, canvasElement.height); updateCalibration(); break;
        case STATE.COUNTDOWN:
            drawDynamicBackground(clock.now() / 1000); drawPlayZoneOutline();
            drawPointers(canvasCtx, canvasElement.width, canvasElement.height); updateCountdown(); break;
        case STATE.PLAYING: renderGameFrame(); break;
    }
    requestAnimationFrame(mainLoop);
}

function renderGameFrame() {
    const currentTime = getCurrentGameTime();
    if (activeNoteStartIndex >= beatmap.length && particles.count === 0) {
        if (currentTime > (beatmap[beatmap.length - 1]?.time || 0) + 2.0) { endGameSession(); return; }
    }
    drawDynamicBackground(currentTime);
    drawPlayZoneOutline(); drawTargetZones(); advanceNotePointer(currentTime); drawArrows(currentTime);
    processHitDetection(currentTime); particles.draw(canvasCtx);
    drawPointers(canvasCtx, canvasElement.width, canvasElement.height); updateProgress(currentTime);
}

// ---- RENDERING ----
function drawPlayZoneOutline() {
    const pz = getPlayZonePixels(); const ctx = canvasCtx;
    ctx.save(); ctx.strokeStyle = 'rgba(123,97,255,0.15)'; ctx.lineWidth = 2; ctx.setLineDash([8, 8]);
    ctx.strokeRect(pz.cx - pz.w / 2, pz.cy - pz.h / 2, pz.w, pz.h); ctx.setLineDash([]);
    const cs = 15; ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pz.cx - cs, pz.cy); ctx.lineTo(pz.cx + cs, pz.cy);
    ctx.moveTo(pz.cx, pz.cy - cs); ctx.lineTo(pz.cx, pz.cy + cs); ctx.stroke(); ctx.restore();
}

function drawTargetZones() {
    if (!currentLevel) return; const ctx = canvasCtx; const time = clock.now() / 1000;
    currentLevel.directions.forEach(dir => {
        const target = getTargetPosition(dir); const color = ARROW_COLORS[dir];
        const r = 35 + Math.sin(time * 2) * 3;
        ctx.save(); ctx.beginPath(); ctx.arc(target.x, target.y, r, 0, Math.PI * 2);
        ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.globalAlpha = 0.25; ctx.stroke();
        ctx.lineWidth = 8; ctx.globalAlpha = 0.1; ctx.stroke(); // Fake glow
        ctx.globalAlpha = 0.3; ctx.fillStyle = color; ctx.font = '900 22px Outfit'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(DIRECTIONS[dir].symbol, target.x, target.y); ctx.restore();
    });
}

function advanceNotePointer(ct) {
    while (activeNoteStartIndex < beatmap.length && (beatmap[activeNoteStartIndex].hit || beatmap[activeNoteStartIndex].missed))
        activeNoteStartIndex++;
}

function drawArrows(ct) {
    if (!currentLevel) return; const pz = getPlayZonePixels();
    for (let i = activeNoteStartIndex; i < beatmap.length; i++) {
        const note = beatmap[i]; if (note.hit || note.missed) continue;
        const td = note.time - ct; if (td > currentLevel.arrowSpeed) break; if (td < -currentLevel.hitWindow) continue;
        const progress = Math.max(0, Math.min(1, 1 - td / currentLevel.arrowSpeed));
        const d = DIRECTIONS[note.dir]; const target = getTargetPosition(note.dir);
        const ax = pz.cx + (target.x - pz.cx) * progress, ay = pz.cy + (target.y - pz.cy) * progress;
        const color = ARROW_COLORS[note.dir]; const size = 20 + progress * 18;
        drawArrowNote(ax, ay, size, d.angle, color, progress);
        if (progress > 0.3) drawShrinkingRing(target.x, target.y, progress, color);
    }
}

function drawArrowNote(x, y, size, angle, color, progress) {
    const ctx = canvasCtx; ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
    ctx.globalAlpha = 0.4 + progress * 0.6;
    ctx.beginPath(); ctx.moveTo(size, 0); ctx.lineTo(-size * 0.6, -size * 0.6);
    ctx.lineTo(-size * 0.3, 0); ctx.lineTo(-size * 0.6, size * 0.6); ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
    ctx.beginPath(); ctx.moveTo(size * 0.5, 0); ctx.lineTo(-size * 0.2, -size * 0.3);
    ctx.lineTo(-size * 0.05, 0); ctx.lineTo(-size * 0.2, size * 0.3); ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fill(); ctx.restore();
}

function drawShrinkingRing(x, y, progress, color) {
    const ctx = canvasCtx; const r = 60 - 30 * progress;
    ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.globalAlpha = 0.3 + progress * 0.5;
    ctx.stroke(); ctx.lineWidth = 8; ctx.globalAlpha = 0.1; ctx.stroke(); ctx.restore();
}

// ---- BACKGROUND ----
function drawDynamicBackground(time) {
    const w = canvasElement.width, h = canvasElement.height;
    bg.draw(canvasCtx, w, h);

    // Pulsing center glow
    const pulseAlpha = 0.06 + Math.sin(time * 2) * 0.03;
    const glow = canvasCtx.createRadialGradient(w / 2, h * 0.48, 0, w / 2, h * 0.48, w * 0.3);
    glow.addColorStop(0, `rgba(123,97,255,${pulseAlpha})`);
    glow.addColorStop(0.6, `rgba(255,110,199,${pulseAlpha * 0.4})`);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    canvasCtx.fillStyle = glow; canvasCtx.fillRect(0, 0, w, h);
}
