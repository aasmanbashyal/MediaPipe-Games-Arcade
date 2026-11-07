import { initHandTracker, detectHands, getPointers, drawSkeleton, drawPointers, GAME_WIDTH, GAME_HEIGHT } from '../../shared/hand-tracker.js';
import { ParticleSystem } from '../../shared/particles.js';
import { playHit, playGoal, playTick, resumeAudio } from '../../shared/audio.js';
import { GameClock, FixedStep } from '../../shared/gameplay-clock.js';
import { createGameControls } from '../../shared/game-controls.js';
import { createHockeyRound, resetHockeyRound, stepHockey } from '../../shared/hockey-physics.js';

// ---- CONSTANTS ----
const WIN_SCORE = 7;

// ---- STATE ----
let gameMode = null; // '1p' or '2p'
let state = 'menu'; // menu, countdown, playing, goal, results
let p1Score = 0, p2Score = 0;
let countdownVal = 3, countdownStart = 0;

const round = createHockeyRound(GAME_WIDTH, GAME_HEIGHT);
const puck = round.puck;
const [paddle1, paddle2] = round.paddles;
const clock = new GameClock();
const simulation = new FixedStep();

const particles = new ParticleSystem();
let goalTimer = 0;
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
const modeSelect = document.getElementById('modeSelect');
const resultsPanel = document.getElementById('resultsPanel');
const statusText = document.getElementById('statusText');
const hudOverlay = document.getElementById('hudOverlay');
const p1ScoreEl = document.getElementById('p1Score');
const p2ScoreEl = document.getElementById('p2Score');
const centerInfo = document.getElementById('centerInfo');
const winnerText = document.getElementById('winnerText');

const controls = createGameControls({
    getState: () => state,
    onPause: () => { clock.pause(); bgAudio.pause(); },
    onResume: () => { clock.resume(); if (bgAudio.src) bgAudio.play().catch(() => {}); },
    onRestart: () => { clock.resume(); startGame(gameMode || '1p'); },
});

// ---- INIT ----
statusText.innerText = "Loading AI...";
modeSelect.style.display = 'none';

initHandTracker(videoElement, (vw, vh) => {
    canvas.width = GAME_WIDTH; canvas.height = GAME_HEIGHT;
    miniCanvas.width = vw; miniCanvas.height = vh;
    statusText.innerText = "Choose a mode";
    modeSelect.style.display = 'flex';
    requestAnimationFrame(mainLoop);
}, err => { statusText.innerText = "Failed — " + err.message; });

// ---- EVENTS ----
document.getElementById('btn1P').addEventListener('click', () => { resumeAudio(); startGame('1p'); });
document.getElementById('btn2P').addEventListener('click', () => { resumeAudio(); startGame('2p'); });
document.getElementById('playAgainBtn')?.addEventListener('click', () => {
    stopMusic();
    state = 'menu'; resultsPanel.style.display = 'none'; modeSelect.style.display = 'flex';
    uiOverlay.style.display = 'flex'; hudOverlay.style.display = 'none';
    document.getElementById('screenTitle').innerText = 'AIR HOCKEY';
    document.querySelector('.tagline').style.display = 'block';
    statusText.style.display = 'block'; statusText.innerText = 'Choose a mode';
});

function startGame(mode) {
    clock.resume(); clock.resetFrame(); simulation.reset(); particles.clear();
    gameMode = mode; p1Score = 0; p2Score = 0;
    updateScoreDisplay();
    resetPuck();
    uiOverlay.style.display = 'none';
    hudOverlay.style.display = 'block';
    state = 'countdown'; countdownVal = 3; countdownStart = clock.now();
    centerInfo.innerText = '3';
    startMusic();
}

function resetPuck() {
    resetHockeyRound(round); simulation.reset();
}

function updateScoreDisplay() {
    p1ScoreEl.innerText = p1Score;
    p2ScoreEl.innerText = p2Score;
}

// ---- MAIN LOOP ----
function mainLoop() {
    document.body.dataset.gameState = state; controls.update();
    const seconds = clock.frame();
    if (clock.paused) { requestAnimationFrame(mainLoop); return; }
    detectHands();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    miniCtx.clearRect(0, 0, miniCanvas.width, miniCanvas.height);
    drawSkeleton(miniCtx, miniCanvas.width, miniCanvas.height);

    switch (state) {
        case 'menu': break;
        case 'countdown': drawTable(); updateCountdown(); break;
        case 'playing':
            simulation.advance(seconds, step => {
                const result = stepHockey(round, getPointers(), gameMode, step);
                if (result.hit) { playHit(700); particles.sparkle(puck.x, puck.y, '#00e5ff', 10); }
                if (result.scorer) { scoreGoal(result.scorer); return false; }
            });
            drawTable(); drawPuck(); drawPaddles(); particles.draw(ctx); break;
        case 'goal': drawTable(); drawPuck(); drawPaddles(); particles.draw(ctx); updateGoalPause(); break;
    }
    requestAnimationFrame(mainLoop);
}

// ---- COUNTDOWN ----
function updateCountdown() {
    const elapsed = (clock.now() - countdownStart) / 1000;
    const newVal = 3 - Math.floor(elapsed);
    if (newVal !== countdownVal && newVal > 0) { countdownVal = newVal; centerInfo.innerText = String(countdownVal); playTick(); }
    if (newVal <= 0) {
        centerInfo.innerText = '';
        state = 'playing';
        // Give puck a random push
        const angle = (Math.random() - 0.5) * Math.PI * 0.6 + (Math.random() > 0.5 ? 0 : Math.PI);
        puck.vx = Math.cos(angle) * 300; puck.vy = Math.sin(angle) * 300;
    }
}

function scoreGoal(scorer) {
    if (scorer === 1) p1Score++; else p2Score++;
    updateScoreDisplay();
    playGoal();
    particles.explode(puck.x, puck.y, scorer === 1 ? '#ff6ec7' : '#00e5ff', 30);

    if (p1Score >= WIN_SCORE || p2Score >= WIN_SCORE) {
        stopMusic();
        state = 'results';
        hudOverlay.style.display = 'none'; uiOverlay.style.display = 'flex';
        document.getElementById('screenTitle').innerText = 'GAME OVER';
        document.querySelector('.tagline').style.display = 'none';
        modeSelect.style.display = 'none'; statusText.style.display = 'none';
        resultsPanel.style.display = 'block';
        winnerText.innerText = p1Score >= WIN_SCORE ? 'PLAYER 1 WINS!' : (gameMode === '1p' ? 'AI WINS!' : 'PLAYER 2 WINS!');
        return;
    }

    state = 'goal'; goalTimer = clock.now();
    centerInfo.innerText = 'GOAL!';
}

function updateGoalPause() {
    if (clock.now() - goalTimer > 1500) {
        resetPuck();
        state = 'countdown'; countdownVal = 3; countdownStart = clock.now(); centerInfo.innerText = '3';
    }
}

// ---- DRAWING ----
function drawTable() {
    const w = canvas.width, h = canvas.height;

    // Background
    const bg = ctx.createLinearGradient(0, 0, w, 0);
    bg.addColorStop(0, '#0a0522'); bg.addColorStop(0.5, '#0f0832'); bg.addColorStop(1, '#0a0522');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);

    // Center line
    ctx.setLineDash([12, 12]);
    ctx.strokeStyle = 'rgba(164, 181, 230, 0.42)'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.stroke();
    ctx.setLineDash([]);

    // Center circle
    ctx.beginPath(); ctx.arc(w / 2, h / 2, 60, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(164, 181, 230, 0.4)'; ctx.lineWidth = 2.5; ctx.stroke();

    // Goals
    const goalHeight = h * 0.35;
    const goalTop = (h - goalHeight) / 2;
    ctx.fillStyle = 'rgba(0, 229, 255, 0.22)';
    ctx.fillRect(0, goalTop, 14, goalHeight);
    ctx.fillStyle = 'rgba(255, 110, 199, 0.22)';
    ctx.fillRect(w - 14, goalTop, 14, goalHeight);

    // Goal border
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.85)'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(14, goalTop); ctx.lineTo(2, goalTop); ctx.lineTo(2, goalTop + goalHeight); ctx.lineTo(14, goalTop + goalHeight); ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 110, 199, 0.85)';
    ctx.beginPath(); ctx.moveTo(w - 14, goalTop); ctx.lineTo(w - 2, goalTop); ctx.lineTo(w - 2, goalTop + goalHeight); ctx.lineTo(w - 14, goalTop + goalHeight); ctx.stroke();

    // Border glow
    ctx.strokeStyle = 'rgba(164, 181, 230, 0.35)'; ctx.lineWidth = 3;
    ctx.strokeRect(4, 4, w - 8, h - 8);

}

function drawPuck() {
    ctx.save();
    // Glow
    ctx.beginPath(); ctx.arc(puck.x, puck.y, puck.r + 8, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)'; ctx.fill();
    ctx.beginPath(); ctx.arc(puck.x, puck.y, puck.r + 16, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.02)'; ctx.fill();

    // Body
    ctx.beginPath(); ctx.arc(puck.x, puck.y, puck.r, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(puck.x - 4, puck.y - 4, 2, puck.x, puck.y, puck.r);
    g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#aaaacc');
    ctx.fillStyle = g; ctx.fill();
    ctx.restore();
}

function drawPaddles() {
    drawPaddle(paddle1, '#ff6ec7');
    drawPaddle(paddle2, '#00e5ff');
}

function drawPaddle(p, color) {
    ctx.save();
    // Fake outer glow
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 10, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.globalAlpha = 0.15; ctx.fill();

    // Outer ring
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.globalAlpha = 0.6; ctx.stroke();
    // Fake stroke glow
    ctx.lineWidth = 10; ctx.globalAlpha = 0.2; ctx.stroke();

    // Inner fill
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r - 4, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.globalAlpha = 0.15; ctx.fill();
    // Core
    ctx.beginPath(); ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff'; ctx.globalAlpha = 0.8; ctx.fill();
    ctx.restore();
}
