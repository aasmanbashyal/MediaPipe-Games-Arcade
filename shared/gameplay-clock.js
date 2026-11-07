// Timers use active play time so a paused or backgrounded game cannot expire.
export class GameClock {
    constructor(source = () => performance.now()) {
        this.source = source;
        this.offset = 0;
        this.pausedAt = null;
        this.lastFrame = this.now();
    }
    get paused() { return this.pausedAt !== null; }
    now() { return (this.pausedAt ?? this.source()) - this.offset; }
    pause() { if (!this.paused) this.pausedAt = this.source(); }
    resume() {
        if (this.paused) {
            this.offset += this.source() - this.pausedAt;
            this.pausedAt = null;
            this.resetFrame();
        }
    }
    resetFrame() { this.lastFrame = this.now(); }
    frame() {
        const now = this.now();
        const delta = this.paused ? 0 : Math.max(0, Math.min(0.1, (now - this.lastFrame) / 1000));
        this.lastFrame = now;
        return delta;
    }
}

// A bounded accumulator keeps collision updates consistent across display rates.
export class FixedStep {
    constructor(step = 1 / 120) { this.step = step; this.remainder = 0; }
    reset() { this.remainder = 0; }
    advance(seconds, update) {
        this.remainder += Math.max(0, Math.min(0.1, seconds));
        while (this.remainder + 1e-9 >= this.step) {
            this.remainder -= this.step;
            if (update(this.step) === false) { this.reset(); break; }
        }
    }
}

export function segmentTouchesCircle(start, end, circle, padding = 0) {
    const dx = end.x - start.x, dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
        ((circle.x - start.x) * dx + (circle.y - start.y) * dy) / lengthSquared));
    return Math.hypot(start.x + t * dx - circle.x, start.y + t * dy - circle.y) < circle.r + padding;
}
