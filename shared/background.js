/**
 * Shared Background Renderer
 * Reusable starfield / nebula background for all games.
 */

export class Background {
    constructor(particleCount = 40, options = {}) {
        this.color = options.color || '123, 97, 255';
        this.speed = options.speed || 0.3;
        this.particles = [];
        this._cachedGrad = null;
        this._cachedW = 0;
        this._cachedH = 0;
        for (let i = 0; i < particleCount; i++) {
            this.particles.push({
                x: Math.random(),
                y: Math.random(),
                size: Math.random() * 2 + 0.5,
                speed: Math.random() * 0.01 + 0.002,
                opacity: Math.random() * 0.2 + 0.05
            });
        }
    }

    draw(ctx, w, h) {
        // Radial gradient (cached)
        if (!this._cachedGrad || this._cachedW !== w || this._cachedH !== h) {
            this._cachedGrad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.8);
            this._cachedGrad.addColorStop(0, 'rgba(15, 8, 40, 0.95)');
            this._cachedGrad.addColorStop(0.5, 'rgba(8, 5, 25, 0.98)');
            this._cachedGrad.addColorStop(1, 'rgba(5, 2, 15, 1)');
            this._cachedW = w;
            this._cachedH = h;
        }
        ctx.fillStyle = this._cachedGrad;
        ctx.fillRect(0, 0, w, h);

        // Floating particles
        this.particles.forEach(p => {
            p.y -= p.speed * this.speed;
            if (p.y < 0) { p.y = 1; p.x = Math.random(); }
            ctx.beginPath();
            ctx.arc(p.x * w, p.y * h, p.size, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${this.color}, ${p.opacity})`;
            ctx.fill();
        });

    }
}
