import { initHandTracker, detectHands, getPointers, drawSkeleton, drawPointers, GAME_WIDTH, GAME_HEIGHT } from '../../shared/hand-tracker.js';
import { ParticleSystem } from '../../shared/particles.js';
import { playHit, playGoal, playTick, resumeAudio } from '../../shared/audio.js';

// ---- CONSTANTS ----
const WIN_SCORE = 7;
const PUCK_RADIUS = 18;
const PADDLE_RADIUS = 35;
const PUCK_FRICTION = 0.995;
const PUCK_MAX_SPEED = 18;
const AI_SPEED = 6;

// ---- STATE ----
let gameMode = null; // '1p' or '2p'
let state = 'menu'; // menu, countdown, playing, goal, results
let p1Score = 0, p2Score = 0;
let countdownVal = 3, countdownStart = 0;

// Puck
let puck = { x: 0, y: 0, vx: 0, vy: 0, r: PUCK_RADIUS };

// Paddles (pixel positions)
let paddle1 = { x: 0, y: 0, px: 0, py: 0, r: PADDLE_RADIUS };
let paddle2 = { x: 0, y: 0, px: 0, py: 0, r: PADDLE_RADIUS };

// AI
let aiTargetY = 0;

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
    gameMode = mode; p1Score = 0; p2Score = 0;
    updateScoreDisplay();
    resetPuck();
    uiOverlay.style.display = 'none';
    hudOverlay.style.display = 'block';
    state = 'countdown'; countdownVal = 3; countdownStart = performance.now();
    centerInfo.innerText = '3';
    startMusic();
}

function resetPuck() {
    const w = canvas.width, h = canvas.height;
    puck.x = w / 2; puck.y = h / 2; puck.vx = 0; puck.vy = 0;
    paddle1.x = w * 0.15; paddle1.y = h / 2; paddle1.px = paddle1.x; paddle1.py = paddle1.y;
    paddle2.x = w * 0.85; paddle2.y = h / 2; paddle2.px = paddle2.x; paddle2.py = paddle2.y;
    aiTargetY = h / 2;
}

function updateScoreDisplay() {
    p1ScoreEl.innerText = p1Score;
    p2ScoreEl.innerText = p2Score;
}

// ---- MAIN LOOP ----
function mainLoop() {
    detectHands();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    miniCtx.clearRect(0, 0, miniCanvas.width, miniCanvas.height);
    drawSkeleton(miniCtx, miniCanvas.width, miniCanvas.height);

    switch (state) {
        case 'menu': break;
        case 'countdown': drawTable(); updateCountdown(); break;
        case 'playing': updatePaddles(); updatePuck(); drawTable(); drawPuck(); drawPaddles(); particles.draw(ctx); break;
        case 'goal': drawTable(); drawPuck(); drawPaddles(); particles.draw(ctx); updateGoalPause(); break;
    }
    requestAnimationFrame(mainLoop);
}

// ---- COUNTDOWN ----
function updateCountdown() {
    const elapsed = (performance.now() - countdownStart) / 1000;
    const newVal = 3 - Math.floor(elapsed);
    if (newVal !== countdownVal && newVal > 0) { countdownVal = newVal; centerInfo.innerText = String(countdownVal); playTick(); }
    if (newVal <= 0) {
        centerInfo.innerText = '';
        state = 'playing';
        // Give puck a random push
        const angle = (Math.random() - 0.5) * Math.PI * 0.6 + (Math.random() > 0.5 ? 0 : Math.PI);
        puck.vx = Math.cos(angle) * 5; puck.vy = Math.sin(angle) * 5;
    }
}

// ---- PADDLE UPDATES ----
function updatePaddles() {
    const w = canvas.width, h = canvas.height;
    const ptrs = getPointers();
    const halfW = w / 2;

    // Mirror X coordinates: canvas has CSS scaleX(-1), so screen-right = canvas-left
    // Raw pointer x: 0=video-left, 1=video-right
    // Mirrored: screen-left = canvas-right, screen-right = canvas-left
    const active = ptrs.filter(p => p.active).map(p => ({
        x: (1 - p.x) * w,   // Flip X to match mirrored canvas
        y: p.y * h
    }));

    if (gameMode === '2p') {
        // After mirroring: lower x = left on screen = P1 side, higher x = right on screen = P2 side
        if (active.length >= 2) {
            active.sort((a, b) => a.x - b.x);
            movePaddle(paddle1, active[0].x, active[0].y, 0, halfW, h);
            movePaddle(paddle2, active[1].x, active[1].y, halfW, w, h);
        } else if (active.length === 1) {
            const px = active[0].x;
            if (px < halfW) movePaddle(paddle1, active[0].x, active[0].y, 0, halfW, h);
            else movePaddle(paddle2, active[0].x, active[0].y, halfW, w, h);
        }
    } else {
        // 1P mode — player controls P1 (left side of canvas = left on screen), AI controls P2
        if (active.length > 0) {
            // Use the hand closest to P1's side
            const sorted = active.sort((a, b) => a.x - b.x);
            movePaddle(paddle1, sorted[0].x, sorted[0].y, 0, halfW, h);
        }
        updateAI(w, h);
    }
}

function movePaddle(paddle, tx, ty, minX, maxX, h) {
    paddle.px = paddle.x; paddle.py = paddle.y;
    paddle.x = Math.max(minX + paddle.r, Math.min(maxX - paddle.r, tx));
    paddle.y = Math.max(paddle.r, Math.min(h - paddle.r, ty));
}

function updateAI(w, h) {
    const halfW = w / 2;
    // AI follows puck with some lag
    if (puck.vx > 0) {
        // Puck coming towards AI side
        aiTargetY += (puck.y - aiTargetY) * 0.08;
    } else {
        aiTargetY += (h / 2 - aiTargetY) * 0.03;
    }
    const targetX = halfW + (halfW - paddle2.r) * 0.5;
    if (puck.x > halfW && puck.vx > 0) {
        // Intercept
        const px = puck.x + puck.vx * 8;
        paddle2.px = paddle2.x; paddle2.py = paddle2.y;
        paddle2.x += (Math.min(w - paddle2.r, Math.max(halfW + paddle2.r, px)) - paddle2.x) * 0.12;
    } else {
        paddle2.px = paddle2.x; paddle2.py = paddle2.y;
        paddle2.x += (targetX - paddle2.x) * 0.04;
    }
    paddle2.y += (aiTargetY - paddle2.y) * 0.1;
    paddle2.y = Math.max(paddle2.r, Math.min(h - paddle2.r, paddle2.y));
}

// ---- PUCK PHYSICS ----
function updatePuck() {
    const w = canvas.width, h = canvas.height;

    puck.x += puck.vx; puck.y += puck.vy;
    puck.vx *= PUCK_FRICTION; puck.vy *= PUCK_FRICTION;

    // Clamp speed
    const speed = Math.sqrt(puck.vx * puck.vx + puck.vy * puck.vy);
    if (speed > PUCK_MAX_SPEED) { puck.vx = (puck.vx / speed) * PUCK_MAX_SPEED; puck.vy = (puck.vy / speed) * PUCK_MAX_SPEED; }

    // Wall bounce (top/bottom)
    if (puck.y - puck.r < 0) { puck.y = puck.r; puck.vy = Math.abs(puck.vy); playHit(400); }
    if (puck.y + puck.r > h) { puck.y = h - puck.r; puck.vy = -Math.abs(puck.vy); playHit(400); }

    // Goals
    const goalHeight = h * 0.35;
    const goalTop = (h - goalHeight) / 2;
    const goalBottom = goalTop + goalHeight;

    if (puck.x - puck.r < 0) {
        if (puck.y > goalTop && puck.y < goalBottom) { scoreGoal(2); return; }
        puck.x = puck.r; puck.vx = Math.abs(puck.vx); playHit(400);
    }
    if (puck.x + puck.r > w) {
        if (puck.y > goalTop && puck.y < goalBottom) { scoreGoal(1); return; }
        puck.x = w - puck.r; puck.vx = -Math.abs(puck.vx); playHit(400);
    }

    // Paddle collisions
    checkPaddleCollision(paddle1);
    checkPaddleCollision(paddle2);
}

function checkPaddleCollision(paddle) {
    const dx = puck.x - paddle.x, dy = puck.y - paddle.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const minDist = puck.r + paddle.r;

    if (dist < minDist && dist > 0) {
        const nx = dx / dist, ny = dy / dist;
        // Push puck out
        puck.x = paddle.x + nx * minDist;
        puck.y = paddle.y + ny * minDist;

        // Paddle velocity
        const pvx = paddle.x - paddle.px;
        const pvy = paddle.y - paddle.py;

        // Reflect and add paddle momentum
        const relVx = puck.vx - pvx, relVy = puck.vy - pvy;
        const dot = relVx * nx + relVy * ny;
        puck.vx = puck.vx - 2 * dot * nx + pvx * 0.8;
        puck.vy = puck.vy - 2 * dot * ny + pvy * 0.8;

        // Minimum bounce speed
        const bounceSpeed = Math.sqrt(puck.vx * puck.vx + puck.vy * puck.vy);
        if (bounceSpeed < 3) { puck.vx *= 3 / bounceSpeed; puck.vy *= 3 / bounceSpeed; }

        particles.sparkle(puck.x, puck.y, '#00e5ff', 10);
        playHit(800);
    }
}

function scoreGoal(scorer) {
    if (scorer === 1) p1Score++; else p2Score++;
    updateScoreDisplay();
    playGoal();
    particles.explode(puck.x, puck.y, scorer === 1 ? '#ff6ec7' : '#00e5ff', 30);

    if (p1Score >= WIN_SCORE || p2Score >= WIN_SCORE) {
        stopMusic();
        state = 'menu';
        hudOverlay.style.display = 'none'; uiOverlay.style.display = 'flex';
        document.getElementById('screenTitle').innerText = 'GAME OVER';
        document.querySelector('.tagline').style.display = 'none';
        modeSelect.style.display = 'none'; statusText.style.display = 'none';
        resultsPanel.style.display = 'block';
        winnerText.innerText = p1Score >= WIN_SCORE ? 'PLAYER 1 WINS!' : (gameMode === '1p' ? 'AI WINS!' : 'PLAYER 2 WINS!');
        return;
    }

    state = 'goal'; goalTimer = performance.now();
    centerInfo.innerText = 'GOAL!';
}

function updateGoalPause() {
    if (performance.now() - goalTimer > 1500) {
        resetPuck();
        state = 'countdown'; countdownVal = 3; countdownStart = performance.now(); centerInfo.innerText = '3';
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
    ctx.strokeStyle = 'rgba(123, 97, 255, 0.2)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.stroke();
    ctx.setLineDash([]);

    // Center circle
    ctx.beginPath(); ctx.arc(w / 2, h / 2, 60, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(123, 97, 255, 0.15)'; ctx.lineWidth = 2; ctx.stroke();

    // Goals
    const goalHeight = h * 0.35;
    const goalTop = (h - goalHeight) / 2;
    ctx.fillStyle = 'rgba(255, 110, 199, 0.08)';
    ctx.fillRect(0, goalTop, 8, goalHeight);
    ctx.fillStyle = 'rgba(0, 229, 255, 0.08)';
    ctx.fillRect(w - 8, goalTop, 8, goalHeight);

    // Goal border
    ctx.strokeStyle = 'rgba(255, 110, 199, 0.4)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(8, goalTop); ctx.lineTo(0, goalTop); ctx.lineTo(0, goalTop + goalHeight); ctx.lineTo(8, goalTop + goalHeight); ctx.stroke();
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.4)';
    ctx.beginPath(); ctx.moveTo(w - 8, goalTop); ctx.lineTo(w, goalTop); ctx.lineTo(w, goalTop + goalHeight); ctx.lineTo(w - 8, goalTop + goalHeight); ctx.stroke();

    // Border glow
    ctx.strokeStyle = 'rgba(123, 97, 255, 0.1)'; ctx.lineWidth = 2;
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
