/**
 * Shared Particle System — Optimized with Object Pooling
 * Reusable explosion/sparkle effects for all games.
 */

const POOL_SIZE = 500;

export class ParticleSystem {
    constructor() {
        this._pool = [];
        this._active = 0;
        // Pre-allocate pool
        for (let i = 0; i < POOL_SIZE; i++) {
            this._pool.push({
                x: 0, y: 0, vx: 0, vy: 0, life: 0,
                color: '#fff', size: 0, type: 'dot', ringRadius: 0, alive: false
            });
        }
    }

    _acquire() {
        // Find a dead particle in the pool
        for (let i = 0; i < this._pool.length; i++) {
            if (!this._pool[i].alive) return this._pool[i];
        }
        // Pool exhausted — grow it
        const p = { x: 0, y: 0, vx: 0, vy: 0, life: 0, color: '#fff', size: 0, type: 'dot', ringRadius: 0, alive: false };
        this._pool.push(p);
        return p;
    }

    /** Burst explosion at a point. */
    explode(x, y, color, count = 20) {
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 10 + 3;
            const p = this._acquire();
            p.x = x; p.y = y;
            p.vx = Math.cos(angle) * speed;
            p.vy = Math.sin(angle) * speed;
            p.life = 1.0; p.color = color;
            p.size = Math.random() * 4 + 1.5;
            p.type = 'dot'; p.alive = true;
        }
        // Ring burst
        const ring = this._acquire();
        ring.x = x; ring.y = y; ring.vx = 0; ring.vy = 0;
        ring.life = 1.0; ring.color = color;
        ring.size = 5; ring.type = 'ring'; ring.ringRadius = 10; ring.alive = true;
    }

    /** Soft sparkle at a point. */
    sparkle(x, y, color, count = 8) {
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 4 + 1;
            const p = this._acquire();
            p.x = x; p.y = y;
            p.vx = Math.cos(angle) * speed;
            p.vy = Math.sin(angle) * speed - 2;
            p.life = 1.0; p.color = color;
            p.size = Math.random() * 3 + 1;
            p.type = 'dot'; p.alive = true;
        }
    }

    /** Update & draw all particles. */
    draw(ctx) {
        let activeCount = 0;
        for (let i = 0; i < this._pool.length; i++) {
            const p = this._pool[i];
            if (!p.alive) continue;

            if (p.type === 'ring') {
                p.ringRadius += 6;
                p.life -= 0.04;
                if (p.life <= 0) { p.alive = false; continue; }

                ctx.save();
                ctx.globalAlpha = p.life * 0.5;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.ringRadius, 0, Math.PI * 2);
                ctx.strokeStyle = p.color;
                ctx.lineWidth = 2;
                ctx.stroke();

                // Fake glow ring
                ctx.globalAlpha = p.life * 0.2;
                ctx.lineWidth = 6;
                ctx.stroke();
                ctx.restore();
            } else {
                p.x += p.vx;
                p.y += p.vy;
                p.vx *= 0.95;
                p.vy *= 0.95;
                p.life -= 0.03;
                if (p.life <= 0) { p.alive = false; continue; }

                ctx.save();
                // Fake glow dot
                ctx.globalAlpha = p.life * 0.3;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size * 2, 0, Math.PI * 2);
                ctx.fillStyle = p.color;
                ctx.fill();

                ctx.globalAlpha = p.life;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fillStyle = p.color;
                ctx.fill();
                ctx.restore();
            }
            activeCount++;
        }
        this._active = activeCount;
    }

    get count() { return this._active; }

    clear() {
        for (let i = 0; i < this._pool.length; i++) {
            this._pool[i].alive = false;
        }
        this._active = 0;
    }
}
