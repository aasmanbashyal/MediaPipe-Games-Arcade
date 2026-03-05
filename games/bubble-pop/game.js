import { initHandTracker, detectHands, getPointers, drawSkeleton, drawPointers, GAME_WIDTH, GAME_HEIGHT } from '../../shared/hand-tracker.js';
import { ParticleSystem } from '../../shared/particles.js';
import { playPop, playSuccess, resumeAudio } from '../../shared/audio.js';
import { Background } from '../../shared/background.js';

// ---- DIFFICULTY CONFIG ----
const CONFIGS = {
    chill: { duration: 60, spawnRate: 1.2, maxBubbles: 12, minR: 35, maxR: 65, speed: 0.6 },
    frenzy: { duration: 45, spawnRate: 0.5, maxBubbles: 25, minR: 25, maxR: 50, speed: 1.2 },
};

const BUBBLE_COLORS = [
    { fill: 'rgba(123, 97, 255, 0.25)', stroke: '#7b61ff', glow: 'rgba(123, 97, 255, 0.4)' },
    { fill: 'rgba(0, 229, 255, 0.25)', stroke: '#00e5ff', glow: 'rgba(0, 229, 255, 0.4)' },
    { fill: 'rgba(255, 110, 199, 0.25)', stroke: '#ff6ec7', glow: 'rgba(255, 110, 199, 0.4)' },
    { fill: 'rgba(255, 235, 59, 0.25)', stroke: '#ffeb3b', glow: 'rgba(255, 235, 59, 0.4)' },
    { fill: 'rgba(76, 175, 80, 0.25)', stroke: '#4caf50', glow: 'rgba(76, 175, 80, 0.4)' },
];

// ---- STATE ----
let state = 'menu';
let config = null;
let bubbles = [], score = 0, combo = 0, maxCombo = 0, popped = 0;
let gameStartTime = 0, lastSpawnTime = 0;
let comboResetTimer = 0;
const particles = new ParticleSystem();
const bg = new Background(40);
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
const timerDisplay = document.getElementById('timerDisplay');

// ---- INIT ----
statusText.innerText = "Loading AI...";
diffSelect.style.display = 'none';

initHandTracker(videoElement, (vw, vh) => {
    canvas.width = GAME_WIDTH; canvas.height = GAME_HEIGHT;
    miniCanvas.width = vw; miniCanvas.height = vh;
    statusText.innerText = "Choose a mode";
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
    document.getElementById('screenTitle').innerText = 'BUBBLE POP';
    document.getElementById('taglineText').style.display = 'block';
    statusText.style.display = 'block'; statusText.innerText = 'Choose a mode';
});

function startGame(cfg) {
    config = cfg; score = 0; combo = 0; maxCombo = 0; popped = 0;
    bubbles = []; particles.clear(); comboResetTimer = 0;
    gameStartTime = performance.now(); lastSpawnTime = 0;
    updateHUD();
    uiOverlay.style.display = 'none'; hudOverlay.style.display = 'block';
    state = 'playing';
    startMusic();
}

function endGame() {
    state = 'results'; hudOverlay.style.display = 'none'; uiOverlay.style.display = 'flex';
    document.getElementById('screenTitle').innerText = 'TIME UP!';
    document.getElementById('taglineText').style.display = 'none';
    diffSelect.style.display = 'none'; statusText.style.display = 'none'; resultsPanel.style.display = 'block';
    document.getElementById('finalScore').innerText = score.toLocaleString();
    document.getElementById('finalPopped').innerText = popped;
    document.getElementById('finalCombo').innerText = maxCombo;
    stopMusic(); playSuccess();
}

// ---- MAIN LOOP ----
function mainLoop() {
    detectHands();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    miniCtx.clearRect(0, 0, miniCanvas.width, miniCanvas.height);
    drawSkeleton(miniCtx, miniCanvas.width, miniCanvas.height);

    if (state === 'playing') {
        const elapsed = (performance.now() - gameStartTime) / 1000;
        const remaining = Math.max(0, config.duration - elapsed);
        timerDisplay.innerText = Math.ceil(remaining);

        if (remaining <= 0) { endGame(); } else {
            bg.draw(ctx, canvas.width, canvas.height);
            spawnBubbles(elapsed);
            updateBubbles();
            checkPops();
            drawBubbles();
            particles.draw(ctx);
            drawPointers(ctx, canvas.width, canvas.height);

            if (combo > 0 && performance.now() - comboResetTimer > 1500) {
                combo = 0; comboBox.style.opacity = 0;
            }
        }
    } else if (state === 'menu') {
        bg.draw(ctx, canvas.width, canvas.height);
    }

    requestAnimationFrame(mainLoop);
}

// ---- BUBBLE SPAWNING ----
function spawnBubbles(elapsed) {
    if (elapsed - lastSpawnTime < config.spawnRate) return;
    if (bubbles.length >= config.maxBubbles) return;
    lastSpawnTime = elapsed;

    const w = canvas.width, h = canvas.height;
    const r = config.minR + Math.random() * (config.maxR - config.minR);
    const x = r + Math.random() * (w - r * 2);
    const colorIdx = Math.floor(Math.random() * BUBBLE_COLORS.length);
    const isGolden = Math.random() < 0.08;

    bubbles.push({
        x, y: h + r, r,
        vx: (Math.random() - 0.5) * 0.8,
        vy: -(config.speed + Math.random() * config.speed * 0.5),
        wobblePhase: Math.random() * Math.PI * 2,
        wobbleSpeed: 0.02 + Math.random() * 0.02,
        color: isGolden ? { fill: 'rgba(255,215,0,0.3)', stroke: '#ffd700', glow: 'rgba(255,215,0,0.5)' } : BUBBLE_COLORS[colorIdx],
        golden: isGolden,
        spawnTime: performance.now(),
        alive: true,
    });
}

function updateBubbles() {
    for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i];
        b.x += b.vx + Math.sin(b.wobblePhase) * 0.5;
        b.y += b.vy;
        b.wobblePhase += b.wobbleSpeed;
        if (b.y + b.r < -20) { bubbles.splice(i, 1); }
    }
}

// ---- POP DETECTION ----
function checkPops() {
    const w = canvas.width, h = canvas.height;
    const pointers = getPointers();
    const active = pointers.filter(p => p.active).map(p => ({ x: p.x * w, y: p.y * h }));
    if (active.length === 0) return;

    for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i];
        if (!b.alive) continue;

        for (const ptr of active) {
            const dx = ptr.x - b.x, dy = ptr.y - b.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < b.r + 20) {
                b.alive = false;
                bubbles.splice(i, 1);
                popped++;
                combo++;
                comboResetTimer = performance.now();
                if (combo > maxCombo) maxCombo = combo;

                let points = b.golden ? 500 : 100;
                points *= Math.min(combo, 20);
                score += points;
                updateHUD();

                comboBox.style.opacity = 1;
                comboBox.style.transform = 'scale(1.3)';
                setTimeout(() => { comboBox.style.transform = 'scale(1)'; }, 120);

                particles.explode(b.x, b.y, b.color.stroke, b.golden ? 30 : 15);
                playPop(400 + combo * 30);
                break;
            }
        }
    }
}

function updateHUD() {
    scoreDisplay.innerText = score.toLocaleString();
    comboDisplay.innerText = combo;
}

// ---- DRAWING ----
function drawBubbles() {
    const time = performance.now() / 1000;
    bubbles.forEach(b => {
        const pulse = 1 + Math.sin(time * 3 + b.wobblePhase) * 0.03;
        const r = b.r * pulse;

        ctx.save();

        // Fake glow logic
        ctx.beginPath();
        ctx.arc(b.x, b.y, r * 1.2, 0, Math.PI * 2);
        ctx.fillStyle = b.color.glow;
        ctx.globalAlpha = 0.3;
        ctx.fill();

        ctx.globalAlpha = 1.0;

        ctx.beginPath();
        ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
        ctx.fillStyle = b.color.fill;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
        ctx.strokeStyle = b.color.stroke;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.6;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(b.x - r * 0.25, b.y - r * 0.25, r * 0.35, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.globalAlpha = 0.8;
        ctx.fill();

        if (b.golden) {
            ctx.globalAlpha = 0.7 + Math.sin(time * 5) * 0.3;
            ctx.fillStyle = '#ffd700';
            ctx.font = `${r * 0.7}px Outfit`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('★', b.x, b.y);
        }

        ctx.restore();
    });
}
