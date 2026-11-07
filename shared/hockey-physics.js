export const PUCK_RADIUS = 18;
export const PADDLE_RADIUS = 35;
const MAX_SPEED = 1080;
const PADDLE_SPEED = 1500;

export function createHockeyRound(width = 960, height = 540) {
    const round = { width, height, puck: { r: PUCK_RADIUS },
        paddles: [{ r: PADDLE_RADIUS }, { r: PADDLE_RADIUS }], aiTargetY: height / 2 };
    resetHockeyRound(round);
    return round;
}

export function resetHockeyRound(round) {
    const { width: w, height: h, puck, paddles } = round;
    Object.assign(puck, { x: w / 2, y: h / 2, vx: 0, vy: 0 });
    // CSS mirrors the canvas: P1 is on the visible left, at high canvas X.
    for (const [i, p] of paddles.entries()) {
        Object.assign(p, { x: w * (i === 0 ? 0.85 : 0.15), y: h / 2, vx: 0, vy: 0 });
    }
    round.aiTargetY = h / 2;
}

export function pointerTargets(pointers, width, height, mode) {
    const active = pointers.filter(p => p.active && Number.isFinite(p.x) && Number.isFinite(p.y))
        .map(p => ({ x: Math.max(0, Math.min(1, p.x)) * width,
            y: Math.max(0, Math.min(1, p.y)) * height })).sort((a, b) => b.x - a.x);
    if (mode === '1p') return [active[0] ?? null, null];
    if (active.length >= 2) return [active[0], active[1]];
    if (active.length === 1) return active[0].x >= width / 2 ? [active[0], null] : [null, active[0]];
    return [null, null];
}

function movePaddle(p, target, minX, maxX, height, seconds, speed = PADDLE_SPEED) {
    p.vx = 0; p.vy = 0;
    if (!target) return;
    const tx = Math.max(minX + p.r, Math.min(maxX - p.r, target.x));
    const ty = Math.max(p.r, Math.min(height - p.r, target.y));
    const dx = tx - p.x, dy = ty - p.y, distance = Math.hypot(dx, dy);
    const ratio = distance ? Math.min(1, speed * seconds / distance) : 0;
    p.vx = dx * ratio / seconds; p.vy = dy * ratio / seconds;
    p.x += dx * ratio; p.y += dy * ratio;
}

function limitSpeed(puck) {
    const speed = Math.hypot(puck.vx, puck.vy);
    if (speed > MAX_SPEED) { puck.vx *= MAX_SPEED / speed; puck.vy *= MAX_SPEED / speed; }
}

export function collidePaddle(puck, paddle) {
    const dx = puck.x - paddle.x, dy = puck.y - paddle.y;
    const distance = Math.hypot(dx, dy), radius = puck.r + paddle.r;
    if (distance >= radius) return false;
    // Exact overlap must also resolve without dividing by zero.
    const velocityLength = Math.hypot(puck.vx - paddle.vx, puck.vy - paddle.vy);
    const nx = distance > 1e-9 ? dx / distance : velocityLength ? -(puck.vx - paddle.vx) / velocityLength : 1;
    const ny = distance > 1e-9 ? dy / distance : velocityLength ? -(puck.vy - paddle.vy) / velocityLength : 0;
    puck.x = paddle.x + nx * radius; puck.y = paddle.y + ny * radius;
    const approach = (puck.vx - paddle.vx) * nx + (puck.vy - paddle.vy) * ny;
    if (approach >= 0) return false; // Do not pull a separating puck back into the paddle.
    puck.vx -= 2 * approach * nx; puck.vy -= 2 * approach * ny;
    const speed = Math.hypot(puck.vx, puck.vy);
    if (speed < 180) { puck.vx = nx * 180; puck.vy = ny * 180; }
    limitSpeed(puck);
    return true;
}

export function stepHockey(round, pointers, mode, seconds) {
    if (!(seconds > 0)) return { scorer: 0, hit: false };
    const { width: w, height: h, puck, paddles } = round;
    const targets = pointerTargets(pointers, w, h, mode);
    movePaddle(paddles[0], targets[0], w / 2, w, h, seconds);
    if (mode === '1p') {
        const following = puck.vx < 0;
        round.aiTargetY += ((following ? puck.y : h / 2) - round.aiTargetY) * (1 - Math.exp(-4 * seconds));
        const targetX = following && puck.x < w / 2 ? puck.x + puck.vx * 0.13 : w * 0.2;
        movePaddle(paddles[1], { x: targetX, y: round.aiTargetY }, 0, w / 2, h, seconds, 360);
    } else movePaddle(paddles[1], targets[1], 0, w / 2, h, seconds);

    limitSpeed(puck);
    puck.x += puck.vx * seconds; puck.y += puck.vy * seconds;
    const damping = Math.pow(0.995, seconds * 60);
    puck.vx *= damping; puck.vy *= damping;
    let hit = false;
    if (puck.y < puck.r) { puck.y = puck.r; puck.vy = Math.abs(puck.vy); hit = true; }
    if (puck.y > h - puck.r) { puck.y = h - puck.r; puck.vy = -Math.abs(puck.vy); hit = true; }
    const fitsGoal = puck.y - puck.r >= h * 0.325 && puck.y + puck.r <= h * 0.675;
    if (puck.x - puck.r < 0) {
        if (fitsGoal) return { scorer: 1, hit };
        puck.x = puck.r; puck.vx = Math.abs(puck.vx); hit = true;
    }
    if (puck.x + puck.r > w) {
        if (fitsGoal) return { scorer: 2, hit };
        puck.x = w - puck.r; puck.vx = -Math.abs(puck.vx); hit = true;
    }
    for (const paddle of paddles) hit = collidePaddle(puck, paddle) || hit;
    return { scorer: 0, hit };
}
