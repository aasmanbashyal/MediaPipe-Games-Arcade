import { initHandTracker, detectHands, getPointers, drawSkeleton, drawPointers, GAME_WIDTH, GAME_HEIGHT } from '../../shared/hand-tracker.js';
import { ParticleSystem } from '../../shared/particles.js';
import { playSlice, playBomb, playSuccess, resumeAudio } from '../../shared/audio.js';
import { Background } from '../../shared/background.js';

// ---- CONFIG ----
const CONFIGS = {
    classic: { duration: 60, spawnRate: 0.8, maxFruits: 15, hasBombs: true, bombChance: 0.12 },
    zen: { duration: 90, spawnRate: 1.0, maxFruits: 10, hasBombs: false, bombChance: 0 },
};

const FRUITS = [
    { emoji: '🍉', color: '#4caf50', splatter: '#66bb6a', points: 100 },
    { emoji: '🍊', color: '#ff9800', splatter: '#ffb74d', points: 100 },
    { emoji: '🍋', color: '#fdd835', splatter: '#fff176', points: 100 },
    { emoji: '🍇', color: '#7b1fa2', splatter: '#ab47bc', points: 150 },
    { emoji: '🍓', color: '#e53935', splatter: '#ef5350', points: 120 },
    { emoji: '🥝', color: '#689f38', splatter: '#8bc34a', points: 100 },
    { emoji: '🍑', color: '#ff8a65', splatter: '#ffab91', points: 130 },
];

const SWIPE_SPEED_THRESHOLD = 8; // pixels/frame minimum to count as a swipe

// ---- STATE ----
let state = 'menu';
let config = null;
let fruits = [], score = 0, combo = 0, maxCombo = 0, sliced = 0;
let gameStartTime = 0, lastSpawnTime = 0;
let comboResetTimer = 0;
const particles = new ParticleSystem();
const bg = new Background(40, { color: '76, 175, 80' });
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

// Trail tracking for swipe detection
let prevPointers = [{ x: 0, y: 0, active: false }, { x: 0, y: 0, active: false }];
let trails = [[], []]; // Recent positions for trail drawing

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
    document.getElementById('screenTitle').innerText = 'FRUIT NINJA';
    document.getElementById('taglineText').style.display = 'block';
    statusText.style.display = 'block'; statusText.innerText = 'Choose a mode';
});

function startGame(cfg) {
    config = cfg; score = 0; combo = 0; maxCombo = 0; sliced = 0;
    fruits = []; particles.clear(); comboResetTimer = 0;
    gameStartTime = performance.now(); lastSpawnTime = 0;
    trails = [[], []];
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
    document.getElementById('finalSliced').innerText = sliced;
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
            spawnFruits(elapsed);
            updateFruits();
            updateTrails();
            checkSlices();
            drawFruits();
            drawTrails();
            particles.draw(ctx);
            drawPointers(ctx, canvas.width, canvas.height);

            if (combo > 0 && performance.now() - comboResetTimer > 2000) {
                combo = 0; comboBox.style.opacity = 0;
            }
        }
    } else if (state === 'menu') {
        bg.draw(ctx, canvas.width, canvas.height);
    }

    // Store previous pointer positions for velocity calculation
    const ptrs = getPointers();
    ptrs.forEach((p, i) => {
        prevPointers[i] = { x: p.x, y: p.y, active: p.active };
    });

    requestAnimationFrame(mainLoop);
}

// ---- FRUIT SPAWNING ----
function spawnFruits(elapsed) {
    if (elapsed - lastSpawnTime < config.spawnRate) return;
    if (fruits.length >= config.maxFruits) return;
    lastSpawnTime = elapsed;

    const w = canvas.width, h = canvas.height;
    const isBomb = config.hasBombs && Math.random() < config.bombChance;

    const x = w * 0.15 + Math.random() * w * 0.7;
    const vx = (Math.random() - 0.5) * 4;
    const vy = -(12 + Math.random() * 6); // Launch upward

    if (isBomb) {
        fruits.push({
            x, y: h + 40, vx, vy,
            r: 35,
            type: 'bomb',
            emoji: '💣',
            color: '#ff3333',
            splatter: '#333',
            rotation: Math.random() * Math.PI * 2,
            rotSpeed: (Math.random() - 0.5) * 0.15,
            alive: true,
        });
    } else {
        const fruit = FRUITS[Math.floor(Math.random() * FRUITS.length)];
        fruits.push({
            x, y: h + 40, vx, vy,
            r: 30 + Math.random() * 15,
            type: 'fruit',
            emoji: fruit.emoji,
            color: fruit.color,
            splatter: fruit.splatter,
            points: fruit.points,
            rotation: Math.random() * Math.PI * 2,
            rotSpeed: (Math.random() - 0.5) * 0.15,
            alive: true,
        });
    }
}

function updateFruits() {
    const h = canvas.height;
    for (let i = fruits.length - 1; i >= 0; i--) {
        const f = fruits[i];
        f.x += f.vx;
        f.y += f.vy;
        f.vy += 0.35; // gravity
        f.rotation += f.rotSpeed;
        // Remove if fallen off screen
        if (f.y > h + 80) { fruits.splice(i, 1); }
    }
}

// ---- SWIPE / SLICE DETECTION ----
function updateTrails() {
    const ptrs = getPointers();
    const w = canvas.width, h = canvas.height;
    ptrs.forEach((p, i) => {
        if (p.active) {
            trails[i].push({ x: p.x * w, y: p.y * h, t: performance.now() });
            // Keep last 15 positions
            if (trails[i].length > 15) trails[i].shift();
        } else {
            trails[i] = [];
        }
    });
}

function getSwipeSpeed(pointerIdx) {
    const w = canvas.width, h = canvas.height;
    const ptrs = getPointers();
    const cur = ptrs[pointerIdx];
    const prev = prevPointers[pointerIdx];
    if (!cur.active || !prev.active) return 0;
    const dx = (cur.x - prev.x) * w;
    const dy = (cur.y - prev.y) * h;
    return Math.sqrt(dx * dx + dy * dy);
}

function checkSlices() {
    const w = canvas.width, h = canvas.height;
    const ptrs = getPointers();

    for (let pi = 0; pi < ptrs.length; pi++) {
        const p = ptrs[pi];
        if (!p.active) continue;
        const px = p.x * w, py = p.y * h;
        const speed = getSwipeSpeed(pi);

        if (speed < SWIPE_SPEED_THRESHOLD) continue; // Not swiping fast enough

        for (let i = fruits.length - 1; i >= 0; i--) {
            const f = fruits[i];
            if (!f.alive) continue;
            const dx = px - f.x, dy = py - f.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < f.r + 25) {
                f.alive = false;
                fruits.splice(i, 1);

                if (f.type === 'bomb') {
                    // Bomb hit — penalty!
                    score = Math.max(0, score - 500);
                    combo = 0; comboBox.style.opacity = 0;
                    particles.explode(f.x, f.y, '#ff3333', 30);
                    playBomb();
                    // Red flash
                    document.body.classList.add('flash-red');
                    setTimeout(() => document.body.classList.remove('flash-red'), 300);
                } else {
                    // Fruit sliced!
                    sliced++;
                    combo++;
                    comboResetTimer = performance.now();
                    if (combo > maxCombo) maxCombo = combo;

                    let points = f.points || 100;
                    points *= Math.min(combo, 20);
                    score += points;

                    comboBox.style.opacity = 1;
                    comboBox.style.transform = 'scale(1.3)';
                    setTimeout(() => { comboBox.style.transform = 'scale(1)'; }, 120);

                    // Splatter particles
                    particles.explode(f.x, f.y, f.splatter, 20);
                    playSlice(800 + combo * 50);
                }
                updateHUD();
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
function drawFruits() {
    fruits.forEach(f => {
        ctx.save();
        ctx.translate(f.x, f.y);
        ctx.rotate(f.rotation);

        // Glow
        if (f.type === 'bomb') {
            ctx.globalAlpha = 0.3;
            ctx.beginPath();
            ctx.arc(0, 0, f.r + 20, 0, Math.PI * 2);
            ctx.fillStyle = f.color;
            ctx.fill();
        }

        ctx.globalAlpha = 0.15;
        ctx.beginPath();
        ctx.arc(0, 0, f.r + 10, 0, Math.PI * 2);
        ctx.fillStyle = f.color;
        ctx.fill();

        // Circle body
        ctx.globalAlpha = 0.3;
        ctx.beginPath();
        ctx.arc(0, 0, f.r, 0, Math.PI * 2);
        ctx.fillStyle = f.color;
        ctx.fill();

        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.arc(0, 0, f.r, 0, Math.PI * 2);
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.globalAlpha = 1;
        ctx.font = `${f.r * 1.1}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(f.emoji, 0, 2);

        ctx.restore();
    });
}

function drawTrails() {
    const colors = ['#ff6ec7', '#00e5ff'];
    trails.forEach((trail, idx) => {
        if (trail.length < 2) return;
        const now = performance.now();
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        for (let i = 1; i < trail.length; i++) {
            const age = (now - trail[i].t) / 300; // Fade over 300ms
            if (age > 1) continue;
            const alpha = (1 - age) * 0.6;
            const width = (1 - age) * 6 + 1;

            ctx.beginPath();
            ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
            ctx.lineTo(trail[i].x, trail[i].y);
            ctx.strokeStyle = colors[idx] || colors[0];
            ctx.lineWidth = width * 2;
            ctx.globalAlpha = alpha * 0.3; // Fake glow
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
            ctx.lineTo(trail[i].x, trail[i].y);
            ctx.strokeStyle = colors[idx] || colors[0];
            ctx.lineWidth = width;
            ctx.globalAlpha = alpha;
            ctx.stroke();
        }
        ctx.restore();
    });
}
