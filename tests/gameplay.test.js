import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { GameClock, FixedStep, segmentTouchesCircle } from '../shared/gameplay-clock.js';
import { createHockeyRound, resetHockeyRound, stepHockey, collidePaddle, pointerTargets } from '../shared/hockey-physics.js';
import { MANUAL_GESTURES } from '../shared/input-utils.js';

test('active clock freezes round deadlines and discards paused frame time', () => {
    let now = 0;
    const clock = new GameClock(() => now);
    now = 100; assert.equal(clock.frame(), 0.1);
    clock.pause(); now = 60100;
    assert.equal(clock.now(), 100); assert.equal(clock.frame(), 0);
    clock.resume(); now += 20;
    assert.equal(clock.now(), 120); assert.equal(clock.frame(), 0.02);
});

test('fixed-step hockey produces the same motion and AI at 30, 60 and 120 Hz', () => {
    const run = hz => {
        const round = createHockeyRound();
        Object.assign(round.puck, { x: 480, y: 100, vx: -150, vy: 40 });
        const stepper = new FixedStep();
        for (let i = 0; i < hz * 2; i++) stepper.advance(1 / hz, dt => stepHockey(round, [], '1p', dt));
        return round;
    };
    assert.deepEqual(run(30), run(60));
    assert.deepEqual(run(60), run(120));
});

test('a stalled frame has bounded simulation work and a goal stops catch-up', () => {
    const stepper = new FixedStep(); let updates = 0;
    stepper.advance(30, () => { updates++; });
    assert.equal(updates, 12);
    updates = 0;
    stepper.advance(0.1, () => { updates++; return false; });
    assert.equal(updates, 1); assert.equal(stepper.remainder, 0);
});

test('hockey uses one mirror and assigns visible left to P1', () => {
    const raw = [{ x: 0.8, y: 0.2, active: true }, { x: 0.2, y: 0.8, active: true }];
    assert.deepEqual(pointerTargets(raw, 1000, 500, '2p'), [{ x: 800, y: 100 }, { x: 200, y: 400 }]);
    assert.deepEqual(pointerTargets([raw[1]], 1000, 500, '2p'), [null, { x: 200, y: 400 }]);
    assert.deepEqual(pointerTargets([{ active: false }], 1000, 500, '1p'), [null, null]);
    const round = createHockeyRound();
    assert.ok(round.paddles[0].x > round.width / 2);
});

test('only a puck that fits the goal opening scores for the opposing side', () => {
    for (const [x, vx, scorer] of [[18, -300, 1], [942, 300, 2]]) {
        const round = createHockeyRound();
        Object.assign(round.puck, { x, y: 270, vx, vy: 0 });
        assert.equal(stepHockey(round, [], '2p', 1 / 120).scorer, scorer);
    }
    const round = createHockeyRound();
    Object.assign(round.puck, { x: 18, y: 180, vx: -300, vy: 0 });
    assert.equal(stepHockey(round, [], '2p', 1 / 120).scorer, 0);
    assert.ok(round.puck.vx > 0);
});

test('paddle collisions remain finite at exact overlap and preserve separating motion', () => {
    const paddle = { x: 100, y: 100, r: 35, vx: 0, vy: 0 };
    const puck = { x: 100, y: 100, r: 18, vx: 0, vy: 0 };
    collidePaddle(puck, paddle);
    assert.ok(Object.values(puck).every(Number.isFinite));
    assert.equal(Math.hypot(puck.x - paddle.x, puck.y - paddle.y), 53);
    Object.assign(puck, { x: 140, y: 100, vx: 100, vy: 0 });
    assert.equal(collidePaddle(puck, paddle), false);
    assert.equal(puck.vx, 100);
    Object.assign(puck, { x: 140, y: 100, vx: -100, vy: 0 });
    assert.equal(collidePaddle(puck, paddle), true);
    assert.ok(puck.vx >= 180);
});

test('round reset clears puck and paddle momentum without replacing render objects', () => {
    const round = createHockeyRound(); const original = round.puck;
    Object.assign(round.puck, { x: 12, vx: 500, vy: 30 }); round.paddles[0].vx = 200;
    resetHockeyRound(round);
    assert.equal(round.puck, original);
    assert.deepEqual([round.puck.x, round.puck.y, round.puck.vx, round.puck.vy], [480, 270, 0, 0]);
    assert.equal(round.paddles[0].vx, 0);
});

test('fast swipe segments hit crossed fruit even when endpoints miss', () => {
    const fruit = { x: 100, y: 100, r: 30 };
    assert.equal(segmentTouchesCircle({ x: 0, y: 100 }, { x: 200, y: 100 }, fruit), true);
    assert.equal(segmentTouchesCircle({ x: 0, y: 200 }, { x: 200, y: 200 }, fruit), false);
    assert.equal(segmentTouchesCircle({ x: 100, y: 100 }, { x: 100, y: 100 }, fruit), true);
});

// Run the real browser entry modules with inert DOM/audio/camera boundaries.
// This keeps regressions tied to the actual state transitions, not copied logic.
function loadGame(name, options = {}) {
    let now = 0; let pointers = []; let gestures = []; let controlCallbacks;
    const elements = new Map();
    const drawing = new Proxy({}, { get: (_target, prop) => prop === 'createLinearGradient' || prop === 'createRadialGradient'
        ? () => ({ addColorStop() {} }) : () => {} });
    const element = id => {
        if (!elements.has(id)) elements.set(id, {
            style: { setProperty() {} }, dataset: {}, classList: { add() {}, remove() {} }, width: 960, height: 540,
            getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 540 }),
            addEventListener() {}, getContext: () => drawing, innerText: '', innerHTML: '',
        });
        return elements.get(id);
    };
    class AudioStub { constructor() { this.src = ''; } play() { return Promise.resolve(); } pause() {} }
    class MusicStub {
        constructor() { this.currentTime = 0; this.duration = 0; }
        loadTrack() { return Promise.resolve(); }
        play() { return options.rejectMusic ? Promise.reject(new Error('Playback blocked')) : Promise.resolve(); }
        stop() {} pause() {}
    }
    const noop = () => {};
    const context = vm.createContext({
        console, Math, Audio: AudioStub, MusicManager: MusicStub,
        GameClock: class extends GameClock { constructor() { super(() => now); } },
        FixedStep, segmentTouchesCircle, createHockeyRound, resetHockeyRound, stepHockey,
        document: { getElementById: element, querySelector: element, querySelectorAll: () => [], body: element('body') },
        createGameControls: opts => { controlCallbacks = opts; return { update() {} }; },
        initHandTracker: (_video, ready) => ready(960, 540), detectHands: noop,
        getPointers: () => pointers, getGestures: () => gestures, drawSkeleton: noop, drawPointers: noop,
        GAME_WIDTH: 960, GAME_HEIGHT: 540,
        ParticleSystem: class { clear() {} draw() {} explode() {} sparkle() {} count = 0; },
        Background: class { draw() {} },
        fetch: async () => ({ json: async () => ({ tracks: [] }) }),
        requestAnimationFrame: noop, setTimeout: () => 1, clearTimeout: noop,
        playHit: noop, playGoal: noop, playTick: noop, playPop: noop, playSlice: noop,
        playBomb: noop, playMiss: noop, playSuccess: noop, resumeAudio: noop,
    });
    const source = fs.readFileSync(new URL(`../games/${name}/game.js`, import.meta.url), 'utf8')
        .replace(/^import .*;\r?\n/gm, '');
    vm.runInContext(source, context, { filename: `${name}/game.js` });
    return { run: code => vm.runInContext(code, context), element,
        setNow: value => { now = value; }, setPointers: value => { pointers = value; },
        setGestures: value => { gestures = value; }, controls: controlCallbacks };
}

for (const name of ['air-hockey', 'bubble-pop', 'fruit-ninja', 'reaction-duel', 'shadow-puppets', 'starri-motion']) {
    test(`${name} pauses its real game clock and resumes without consuming the break`, () => {
        const game = loadGame(name);
        game.setNow(100); game.controls.onPause(); game.setNow(60100);
        assert.equal(game.run('clock.now()'), 100);
        game.controls.onResume(); game.setNow(60200);
        assert.equal(game.run('clock.now()'), 200);
    });
}

test('bubble and fruit movement is consistent at different render rates', () => {
    for (const name of ['bubble-pop', 'fruit-ninja']) {
        const run = hz => {
            const game = loadGame(name);
            game.run(name === 'bubble-pop'
                ? 'bubbles = [{x:100,y:500,r:30,vx:0.2,vy:-0.6,wobblePhase:0,wobbleSpeed:0.03}];'
                : 'fruits = [{x:100,y:500,r:30,vx:0.2,vy:-12,rotation:0,rotSpeed:0.03}];');
            for (let i = 0; i < hz; i++) game.run(`${name === 'bubble-pop' ? 'updateBubbles' : 'updateFruits'}(${1 / hz})`);
            return JSON.parse(game.run(`JSON.stringify(${name === 'bubble-pop' ? 'bubbles' : 'fruits'}[0])`));
        };
        const low = run(30), high = run(120);
        for (const key of ['x', 'y']) assert.ok(Math.abs(low[key] - high[key]) < 1e-8, `${name} ${key}`);
    }
});

test('fruit swipe speed uses seconds and restarting clears old hand positions', () => {
    const game = loadGame('fruit-ninja');
    for (const hz of [30, 60, 120]) {
        game.setPointers([{ x: 0.1 + 0.5 / hz, y: 0.5, active: true }]);
        game.run(`prevPointers=[{x:0.1,y:0.5,active:true}]; frameSeconds=${1 / hz};`);
        assert.ok(Math.abs(game.run('getSwipeSpeed(0)') - 480) < 1e-8);
    }
    game.run('startGame(CONFIGS.zen)');
    assert.equal(game.run('prevPointers.some(p => p.active)'), false);
});

test('Fruit camera samples have the same swipe threshold on high-refresh displays', () => {
    const game = loadGame('fruit-ninja');
    for (const hz of [30, 60, 120, 144]) {
        game.setPointers([{ x: 0.1 + 16 / 960, y: 0.5, active: true, sampleTime: 100 }]);
        game.run(`prevPointers=[{x:0.1,y:0.5,active:true,sampleTime:100-1000/30}]; frameSeconds=${1 / hz};`);
        assert.ok(Math.abs(game.run('getSwipeSpeed(0)') - 480) < 1e-8);
        game.run('prevPointers[0].sampleTime = 100');
        assert.equal(game.run('getSwipeSpeed(0)'), 0);
    }
});

test('Shadow Puppets cannot advance to the next round during a pause', () => {
    const game = loadGame('shadow-puppets');
    game.setNow(100); game.run('startGame(CONFIGS.easy)');
    game.setGestures([game.run('targetGesture.name')]);
    game.run('checkGestureMatch()');
    assert.equal(game.run('currentRound'), 1);
    game.controls.onPause(); game.setNow(60100); game.run('mainLoop()');
    assert.equal(game.run('currentRound'), 1);
    game.controls.onResume(); game.setNow(61101); game.run('mainLoop()');
    assert.equal(game.run('currentRound'), 2);
});

test('every supported gesture can complete its Shadow Puppets target', () => {
    for (const [label] of MANUAL_GESTURES) {
        const game = loadGame('shadow-puppets');
        game.run(`startGame(CONFIGS.hard); targetGesture = GESTURES.hard.find(gesture => gesture.name === ${JSON.stringify(label)});`);
        assert.equal(game.run('Boolean(targetGesture)'), true, label);
        game.setGestures([label]);
        game.run('checkGestureMatch()');
        assert.equal(game.run('matched'), 1, label);
    }
});

test('Reaction Duel reports no hits instead of a perfect zero-ms result after all misses', () => {
    const game = loadGame('reaction-duel');
    game.run("startGame('solo'); endGame();");
    assert.equal(game.element('winnerText').innerText, 'TRY AGAIN!');
    assert.match(game.element('statsBlock').innerHTML, /No hits/);
    assert.doesNotMatch(game.element('statsBlock').innerHTML, />0 ms/);
});

test('Starri counts expired notes as misses instead of silently skipping them', () => {
    const game = loadGame('starri-motion');
    game.run("currentLevel=LEVELS.easy; beatmap=[{time:1,dir:'up',hit:false,missed:false}]; combo=3; advanceNotePointer(2); processHitDetection(2);");
    assert.equal(game.run('missCount'), 1);
    assert.equal(game.run('combo'), 0);
    assert.equal(game.run('beatmap[0].missed'), true);
});

test('Starri gameplay timer keeps running when optional music playback is rejected', async () => {
    const game = loadGame('starri-motion', { rejectMusic: true });
    game.run("selectedLevelId='easy'; currentLevel=LEVELS.easy; availableTracks=[{file:'example.mp3'}];");
    await game.run('startGameSession()');
    game.setNow(5000);
    assert.equal(game.run('getCurrentGameTime()'), 5);
    assert.equal(game.run('gameState'), 'playing');
});

test('Starri calibration requires a continuous hand hold', () => {
    const game = loadGame('starri-motion');
    game.run('enterCalibration()'); game.setPointers([{ active: true, x: 0.5, y: 0.48 }]);
    game.setNow(100); game.run('updateCalibration()');
    game.setNow(1500); game.run('updateCalibration()');
    game.setPointers([]); game.run('updateCalibration()');
    assert.equal(game.run('calibrationProgress'), 0);
    assert.equal(game.run('calibrationStartTime'), 0);
});

test('hockey winning goal shows results and restart clears both scores', () => {
    const game = loadGame('air-hockey');
    game.run("startGame('1p'); p1Score = 6; scoreGoal(1);");
    assert.equal(game.run('state'), 'results');
    assert.equal(game.element('winnerText').innerText, 'PLAYER 1 WINS!');
    game.controls.onRestart();
    assert.equal(game.run('state'), 'countdown');
    assert.equal(game.run('p1Score + p2Score'), 0);
    assert.equal(game.run('puck.vx'), 0);
});

test('MusicManager propagates browser playback rejection to its caller', async () => {
    const source = fs.readFileSync(new URL('../shared/audio.js', import.meta.url), 'utf8')
        .replace(/^export /gm, '');
    const context = vm.createContext({ Audio: class {
        play() { return Promise.reject(new Error('Autoplay denied')); }
    } });
    vm.runInContext(source, context);
    await assert.rejects(vm.runInContext('const manager = new MusicManager(); manager._loaded = true; manager.play();', context), /Autoplay denied/);
});
