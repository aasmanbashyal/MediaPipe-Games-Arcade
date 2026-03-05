import { initHandTracker, detectHands, getPointers, getGestures, drawSkeleton, drawPointers, GAME_WIDTH, GAME_HEIGHT } from '../../shared/hand-tracker.js';
import { ParticleSystem } from '../../shared/particles.js';
import { playPop, playMiss, playSuccess, playTick, resumeAudio } from '../../shared/audio.js';
import { Background } from '../../shared/background.js';

// ---- GESTURE DEFINITIONS ----
const GESTURES = {
    easy: [
        { name: 'Thumbs_Up', emoji: '👍', label: 'THUMBS UP' },
        { name: 'Open_Palm', emoji: '✋', label: 'OPEN PALM' },
        { name: 'Victory', emoji: '✌️', label: 'PEACE' },
        { name: 'Closed_Fist', emoji: '✊', label: 'FIST' },
    ],
    hard: [
        { name: 'Thumbs_Up', emoji: '👍', label: 'THUMBS UP' },
        { name: 'Thumbs_Down', emoji: '👎', label: 'THUMBS DOWN' },
        { name: 'Open_Palm', emoji: '✋', label: 'OPEN PALM' },
        { name: 'Victory', emoji: '✌️', label: 'PEACE' },
        { name: 'Closed_Fist', emoji: '✊', label: 'FIST' },
        { name: 'Pointing_Up', emoji: '☝️', label: 'POINT UP' },
        { name: 'ILoveYou', emoji: '🤟', label: 'I LOVE YOU' },
    ],
};

const CONFIGS = {
    easy: { timePerGesture: 5000, rounds: 10, gestures: 'easy' },
    hard: { timePerGesture: 3000, rounds: 12, gestures: 'hard' },
};

// ---- STATE ----
let state = 'menu';
let config = null;
let currentRound = 0, totalRounds = 0;
let score = 0, streak = 0, maxStreak = 0, matched = 0;
let targetGesture = null;
let roundStartTime = 0;
let roundResolved = false;
let feedbackTimeout = null;
let pauseUntil = 0;
const particles = new ParticleSystem();
const bg = new Background(40, { color: '255, 170, 0' });
const bgAudio = new Audio();
bgAudio.loop = true;
bgAudio.volume = 0.3;
let availableTracks = [];

async function loadTrackList() {
    try {
        const resp = await fetch('../../assets/music/tracks.json?v=' + Date.now());
        const data = await resp.json();
        availableTracks = data.tracks || [];
    } catch (e) { availableTracks = []; }
}
function startMusic() {
    if (availableTracks.length === 0) return;
    const track = availableTracks[Math.floor(Math.random() * availableTracks.length)];
    const url = '../../assets/music/' + track.file;
    bgAudio.src = url;
    bgAudio.currentTime = 0;
    bgAudio.play().catch(() => { });
}
function stopMusic() { bgAudio.pause(); bgAudio.currentTime = 0; }
loadTrackList();

// ---- DOM ----
const videoElement = document.getElementById('webcamView');
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const miniCanvas = document.getElementById('miniCanvas');
const miniCtx = miniCanvas.getContext('2d');

const uiOverlay = document.getElementById('uiOverlay');
const diffSelect = document.getElementById('diffSelect');
const resultsPanel = document.getElementById('resultsPanel');
const statusText = document.getElementById('statusText');
const hudOverlay = document.getElementById('hudOverlay');
const scoreDisplay = document.getElementById('scoreDisplay');
const comboBox = document.getElementById('comboBox');
const comboDisplay = document.getElementById('comboDisplay');
const roundDisplay = document.getElementById('roundDisplay');
const timerFill = document.getElementById('timerFill');
const gestureTarget = document.getElementById('gestureTarget');
const matchFeedback = document.getElementById('matchFeedback');

// ---- INIT ----
statusText.innerText = "Loading AI...";
diffSelect.style.display = 'none';

initHandTracker(videoElement, (vw, vh) => {
    canvas.width = GAME_WIDTH; canvas.height = GAME_HEIGHT;
    miniCanvas.width = vw; miniCanvas.height = vh;
    statusText.innerText = "Choose difficulty";
    diffSelect.style.display = 'flex';
    requestAnimationFrame(mainLoop);
}, err => { statusText.innerText = "Failed — " + err.message; });

// ---- EVENTS ----
document.querySelectorAll('.diff-card').forEach(btn => {
    btn.addEventListener('click', () => {
        resumeAudio();
        const diff = btn.dataset.diff;
        if (CONFIGS[diff]) startGame(CONFIGS[diff]);
    });
});

document.getElementById('playAgainBtn')?.addEventListener('click', () => {
    stopMusic();
    state = 'menu'; resultsPanel.style.display = 'none'; diffSelect.style.display = 'flex';
    uiOverlay.style.display = 'flex'; hudOverlay.style.display = 'none';
    document.getElementById('screenTitle').innerText = 'SHADOW PUPPETS';
    document.getElementById('taglineText').style.display = 'block';
    statusText.style.display = 'block'; statusText.innerText = 'Choose difficulty';
});

function startGame(cfg) {
    config = cfg; score = 0; streak = 0; maxStreak = 0; matched = 0;
    currentRound = 0; totalRounds = cfg.rounds;
    particles.clear();
    updateHUD();
    uiOverlay.style.display = 'none'; hudOverlay.style.display = 'block';
    state = 'playing';
    startMusic();
    nextRound();
}

function nextRound() {
    currentRound++;
    if (currentRound > totalRounds) { endGame(); return; }

    roundDisplay.innerText = `${currentRound} / ${totalRounds}`;
    roundResolved = false;

    // Pick a random gesture
    const gestures = GESTURES[config.gestures];
    let newGesture;
    do {
        newGesture = gestures[Math.floor(Math.random() * gestures.length)];
    } while (targetGesture && newGesture.name === targetGesture.name && gestures.length > 1);

    targetGesture = newGesture;
    gestureTarget.innerText = targetGesture.emoji;
    roundStartTime = performance.now();
    timerFill.style.width = '100%';
    playTick();
}

function endGame() {
    state = 'results'; hudOverlay.style.display = 'none'; uiOverlay.style.display = 'flex';
    gestureTarget.innerText = '';
    document.getElementById('screenTitle').innerText = 'GAME OVER';
    document.getElementById('taglineText').style.display = 'none';
    diffSelect.style.display = 'none'; statusText.style.display = 'none'; resultsPanel.style.display = 'block';
    document.getElementById('finalScore').innerText = score.toLocaleString();
    document.getElementById('finalMatched').innerText = `${matched} / ${totalRounds}`;
    document.getElementById('finalStreak').innerText = maxStreak;
    stopMusic(); playSuccess();
}

// ---- MAIN LOOP ----
function mainLoop() {
    detectHands();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    miniCtx.clearRect(0, 0, miniCanvas.width, miniCanvas.height);
    drawSkeleton(miniCtx, miniCanvas.width, miniCanvas.height);

    if (state === 'playing') {
        bg.draw(ctx, canvas.width, canvas.height);
        drawGestureHint();
        drawPointers(ctx, canvas.width, canvas.height);
        particles.draw(ctx);

        const now = performance.now();

        // Pause between rounds
        if (now < pauseUntil) {
            // Still in pause — just render, don't check
        } else if (!roundResolved) {
            const elapsed = now - roundStartTime;
            const remaining = Math.max(0, config.timePerGesture - elapsed);
            timerFill.style.width = (remaining / config.timePerGesture * 100) + '%';

            if (remaining <= 0) {
                // Time's up — miss
                roundResolved = true;
                streak = 0;
                comboBox.style.opacity = 0;
                showFeedback('TIME OUT', 'timeout');
                playMiss();
                pauseUntil = now + 1200;
                setTimeout(() => nextRound(), 1200);
            } else {
                checkGestureMatch();
            }
        }
    } else if (state === 'menu') {
        bg.draw(ctx, canvas.width, canvas.height);
    }

    requestAnimationFrame(mainLoop);
}

function checkGestureMatch() {
    const gestures = getGestures();
    // Check if either hand matches the target gesture
    for (let i = 0; i < gestures.length; i++) {
        if (gestures[i] === targetGesture.name) {
            // Match!
            roundResolved = true;
            matched++;
            streak++;
            if (streak > maxStreak) maxStreak = streak;

            const elapsed = performance.now() - roundStartTime;
            const timeBonus = Math.max(0, Math.floor((1 - elapsed / config.timePerGesture) * 500));
            const points = (200 + timeBonus) * Math.min(streak, 10);
            score += points;

            comboBox.style.opacity = 1;
            comboBox.style.transform = 'scale(1.3)';
            setTimeout(() => { comboBox.style.transform = 'scale(1)'; }, 120);

            updateHUD();
            showFeedback('MATCHED!', 'correct');
            playPop(800 + streak * 50);

            // Particle burst at center
            const w = canvas.width, h = canvas.height;
            particles.explode(w / 2, h / 2, '#ffaa00', 25);

            pauseUntil = performance.now() + 1000;
            setTimeout(() => nextRound(), 1000);
            return;
        }
    }
}

function updateHUD() {
    scoreDisplay.innerText = score.toLocaleString();
    comboDisplay.innerText = streak;
}

function showFeedback(text, className) {
    if (feedbackTimeout) clearTimeout(feedbackTimeout);
    matchFeedback.className = ''; matchFeedback.innerText = text; void matchFeedback.offsetWidth;
    matchFeedback.classList.add('show', className);
    feedbackTimeout = setTimeout(() => { matchFeedback.className = ''; }, 800);
}

// ---- DRAWING ----
function drawGestureHint() {
    if (!targetGesture || state !== 'playing') return;
    const w = canvas.width, h = canvas.height;

    // Large translucent label beneath the emoji
    ctx.save();
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = '#ffaa00';
    ctx.font = '900 48px Outfit';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(targetGesture.label, w / 2, h * 0.7);
    ctx.restore();

    // Pulsing ring around center
    const time = performance.now() / 1000;
    const pulse = 1 + Math.sin(time * 3) * 0.05;
    const r = 120 * pulse;

    ctx.save();
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 170, 0, 0.15)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.lineWidth = 20;
    ctx.globalAlpha = 0.2;
    ctx.strokeStyle = 'rgba(255, 170, 0, 0.3)';
    ctx.stroke();
    ctx.restore();
}
