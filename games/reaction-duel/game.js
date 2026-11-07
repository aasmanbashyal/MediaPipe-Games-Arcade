import { GameClock } from '../../shared/gameplay-clock.js';
import { createGameControls } from '../../shared/game-controls.js';
import { initHandTracker, detectHands, getPointers, drawSkeleton, drawPointers, GAME_WIDTH, GAME_HEIGHT } from '../../shared/hand-tracker.js';
import { ParticleSystem } from '../../shared/particles.js';
import { playPop, playSuccess, playMiss, playTick, resumeAudio } from '../../shared/audio.js';
import { Background } from '../../shared/background.js';

// ---- CONFIG ----
const TOTAL_ROUNDS = 5;
const TARGET_RADIUS = 60;
const TARGET_COLORS = ['#ffeb3b', '#00e5ff', '#ff6ec7', '#7b61ff', '#4caf50'];

// ---- STATE ----
let gameMode = 'solo';
let state = 'menu';
const clock = new GameClock();
let frameSeconds = 1 / 60;
let currentRound = 0;
let p1Wins = 0, p2Wins = 0;
let target = null;
let waitStart = 0;
let waitDuration = 0;
let roundResult = null;
let resultPauseStart = 0;
let reactionTimes = [];
const particles = new ParticleSystem();
const bg = new Background(40, { color: '255, 235, 59' });
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
const roundInfo = document.getElementById('roundInfo');
const p1WinsEl = document.getElementById('p1Wins');
const p2WinsEl = document.getElementById('p2Wins');
const centerMsg = document.getElementById('centerMsg');
const reactionTimeEl = document.getElementById('reactionTime');
const winnerText = document.getElementById('winnerText');
const statsBlock = document.getElementById('statsBlock');

const controls = createGameControls({
    getState: () => state,
    onPause: () => { clock.pause(); bgAudio.pause(); },
    onResume: () => { clock.resume(); if (bgAudio.src) bgAudio.play().catch(() => {}); },
    onRestart: () => { clock.resume(); startGame(gameMode); },
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
document.getElementById('btnSolo').addEventListener('click', () => { resumeAudio(); startGame('solo'); });
document.getElementById('btnDuel').addEventListener('click', () => { resumeAudio(); startGame('duel'); });
document.getElementById('playAgainBtn')?.addEventListener('click', () => {
    stopMusic();
    state = 'menu'; resultsPanel.style.display = 'none'; modeSelect.style.display = 'flex';
    uiOverlay.style.display = 'flex'; hudOverlay.style.display = 'none';
    document.getElementById('screenTitle').innerText = 'REACTION DUEL';
    document.getElementById('taglineText').style.display = 'block';
    statusText.style.display = 'block'; statusText.innerText = 'Choose a mode';
});

function startGame(mode) {
    clock.resume(); clock.resetFrame();
    gameMode = mode; currentRound = 0; p1Wins = 0; p2Wins = 0; reactionTimes = [];
    updateWinsDisplay();
    uiOverlay.style.display = 'none'; hudOverlay.style.display = 'block';
    centerMsg.innerText = ''; reactionTimeEl.innerText = '';
    if (mode === 'solo') { p2WinsEl.style.display = 'none'; } else { p2WinsEl.style.display = 'block'; }
    startMusic();
    startRound();
}

function startRound() {
    currentRound++;
    if (currentRound > TOTAL_ROUNDS) { endGame(); return; }
    roundInfo.innerText = `ROUND ${currentRound} / ${TOTAL_ROUNDS}`;
    centerMsg.innerText = 'WAIT...';
    reactionTimeEl.innerText = '';
    target = null; roundResult = null;
    state = 'waiting';
    waitStart = clock.now();
    waitDuration = 1500 + Math.random() * 3000;
}

function showTarget() {
    const w = canvas.width, h = canvas.height;
    const margin = 120;
    target = {
        x: margin + Math.random() * (w - margin * 2),
        y: margin + Math.random() * (h - margin * 2),
        r: TARGET_RADIUS,
        color: TARGET_COLORS[Math.floor(Math.random() * TARGET_COLORS.length)],
        shownAt: clock.now(),
    };
    centerMsg.innerText = 'GO!';
    state = 'target_shown';
    playTick();
}

function checkTouched() {
    if (!target) return;
    const w = canvas.width, h = canvas.height;
    const pointers = getPointers();

    for (let i = 0; i < pointers.length; i++) {
        const p = pointers[i];
        if (!p.active) continue;
        const px = p.x * w, py = p.y * h;
        const dx = px - target.x, dy = py - target.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < target.r + 25) {
            const reactionMs = clock.now() - target.shownAt;
            const winner = gameMode === 'duel' ? (i === 0 ? 1 : 2) : 1;
            if (winner === 1) p1Wins++; else p2Wins++;
            updateWinsDisplay();
            reactionTimes.push(reactionMs);

            roundResult = { winner, time: reactionMs };
            particles.explode(target.x, target.y, target.color, 25);
            playPop(900);

            const ms = Math.round(reactionMs);
            if (gameMode === 'solo') {
                centerMsg.innerText = ms < 300 ? 'LIGHTNING!' : ms < 500 ? 'FAST!' : 'OK';
                reactionTimeEl.innerText = ms + ' ms';
            } else {
                centerMsg.innerText = `P${winner} WINS!`;
                reactionTimeEl.innerText = ms + ' ms';
            }

            state = 'result_pause';
            resultPauseStart = clock.now();
            target = null;
            return;
        }
    }
}

function updateWinsDisplay() {
    p1WinsEl.innerText = p1Wins;
    p2WinsEl.innerText = p2Wins;
}

function endGame() {
    state = 'results';
    hudOverlay.style.display = 'none'; uiOverlay.style.display = 'flex';
    document.getElementById('screenTitle').innerText = 'GAME OVER';
    document.getElementById('taglineText').style.display = 'none';
    modeSelect.style.display = 'none'; statusText.style.display = 'none'; resultsPanel.style.display = 'block';

    if (gameMode === 'solo') {
        const avg = reactionTimes.length > 0 ? Math.round(reactionTimes.reduce((a, b) => a + b, 0) / reactionTimes.length) : 0;
        const best = reactionTimes.length > 0 ? Math.round(Math.min(...reactionTimes)) : 0;
        winnerText.innerText = reactionTimes.length === 0 ? 'TRY AGAIN!' : avg < 350 ? 'INCREDIBLE!' : avg < 500 ? 'GREAT REFLEXES!' : 'KEEP PRACTICING!';
        statsBlock.innerHTML = `
            <div class="result-row"><span class="result-label">Avg Reaction</span><span class="result-value">${reactionTimes.length ? avg + ' ms' : 'No hits'}</span></div>
            <div class="result-row"><span class="result-label">Best Time</span><span class="result-value">${reactionTimes.length ? best + ' ms' : 'No hits'}</span></div>
            <div class="result-row"><span class="result-label">Rounds Won</span><span class="result-value">${p1Wins} / ${TOTAL_ROUNDS}</span></div>
        `;
    } else {
        winnerText.innerText = p1Wins > p2Wins ? 'PLAYER 1 WINS!' : p2Wins > p1Wins ? 'PLAYER 2 WINS!' : 'DRAW!';
        statsBlock.innerHTML = `
            <div class="result-row"><span class="result-label">P1 Wins</span><span class="result-value">${p1Wins}</span></div>
            <div class="result-row"><span class="result-label">P2 Wins</span><span class="result-value">${p2Wins}</span></div>
        `;
    }
    stopMusic(); playSuccess();
}

// ---- MAIN LOOP ----
function mainLoop() {
    document.body.dataset.gameState = state; controls.update();
    frameSeconds = clock.frame();
    if (clock.paused) { requestAnimationFrame(mainLoop); return; }
    detectHands();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    miniCtx.clearRect(0, 0, miniCanvas.width, miniCanvas.height);
    drawSkeleton(miniCtx, miniCanvas.width, miniCanvas.height);

    switch (state) {
        case 'menu':
            bg.draw(ctx, canvas.width, canvas.height);
            break;
        case 'waiting':
            bg.draw(ctx, canvas.width, canvas.height);
            drawDuelDivider();
            drawPointers(ctx, canvas.width, canvas.height);
            if (clock.now() - waitStart >= waitDuration) showTarget();
            break;
        case 'target_shown':
            bg.draw(ctx, canvas.width, canvas.height);
            drawDuelDivider();
            drawTarget();
            drawPointers(ctx, canvas.width, canvas.height);
            checkTouched();
            particles.draw(ctx);
            if (clock.now() - target?.shownAt > 5000) {
                centerMsg.innerText = 'TOO SLOW!';
                reactionTimeEl.innerText = '';
                playMiss();
                state = 'result_pause'; resultPauseStart = clock.now(); target = null;
            }
            break;
        case 'result_pause':
            bg.draw(ctx, canvas.width, canvas.height);
            drawPointers(ctx, canvas.width, canvas.height);
            particles.draw(ctx);
            if (clock.now() - resultPauseStart > 2000) startRound();
            break;
    }
    requestAnimationFrame(mainLoop);
}

function drawDuelDivider() {
    if (gameMode === 'duel' && (state === 'waiting' || state === 'target_shown')) {
        const w = canvas.width, h = canvas.height;
        ctx.save(); ctx.setLineDash([12, 12]);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.stroke();
        ctx.setLineDash([]); ctx.restore();
    }
}

function drawTarget() {
    if (!target) return;
    const time = clock.now() / 1000;
    const pulse = 1 + Math.sin(time * 6) * 0.06;
    const r = target.r * pulse;

    ctx.save();

    // Fake outer glow
    ctx.beginPath(); ctx.arc(target.x, target.y, r + 25, 0, Math.PI * 2);
    ctx.fillStyle = target.color; ctx.globalAlpha = 0.05;
    ctx.fill();

    ctx.beginPath(); ctx.arc(target.x, target.y, r + 15, 0, Math.PI * 2);
    ctx.fillStyle = target.color; ctx.globalAlpha = 0.08;
    ctx.fill();

    ctx.beginPath(); ctx.arc(target.x, target.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = target.color; ctx.lineWidth = 4; ctx.globalAlpha = 0.8;
    ctx.stroke();

    // Fake stroke glow
    ctx.beginPath(); ctx.arc(target.x, target.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = target.color; ctx.lineWidth = 15; ctx.globalAlpha = 0.2;
    ctx.stroke();

    ctx.beginPath(); ctx.arc(target.x, target.y, r * 0.5, 0, Math.PI * 2);
    ctx.strokeStyle = target.color; ctx.lineWidth = 2; ctx.globalAlpha = 0.4; ctx.stroke();

    // Fake inner center glow
    ctx.beginPath(); ctx.arc(target.x, target.y, 14, 0, Math.PI * 2);
    ctx.fillStyle = target.color; ctx.globalAlpha = 0.3; ctx.fill();

    ctx.beginPath(); ctx.arc(target.x, target.y, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.globalAlpha = 1;
    ctx.fill();

    ctx.globalAlpha = 0.3; ctx.strokeStyle = target.color; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(target.x - r - 10, target.y); ctx.lineTo(target.x + r + 10, target.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(target.x, target.y - r - 10); ctx.lineTo(target.x, target.y + r + 10); ctx.stroke();

    ctx.restore();
}
