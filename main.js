/**
 * MediaGames Arcade — Hub Main Script
 * Animated star background for the hub page.
 */

const canvas = document.getElementById('bgCanvas');
const ctx = canvas.getContext('2d');

let stars = [];
let w, h;

function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
}

function initStars() {
    stars = [];
    for (let i = 0; i < 120; i++) {
        stars.push({
            x: Math.random() * w,
            y: Math.random() * h,
            size: Math.random() * 2 + 0.5,
            speed: Math.random() * 0.3 + 0.05,
            opacity: Math.random() * 0.5 + 0.2,
            twinkleSpeed: Math.random() * 0.02 + 0.005,
            twinkleOffset: Math.random() * Math.PI * 2,
        });
    }
}

function drawStars(time) {
    ctx.clearRect(0, 0, w, h);

    // Subtle gradient background fill
    const grad = ctx.createRadialGradient(w / 2, h * 0.4, 0, w / 2, h * 0.4, w * 0.9);
    grad.addColorStop(0, 'rgba(18, 8, 40, 0.6)');
    grad.addColorStop(0.5, 'rgba(10, 5, 25, 0.4)');
    grad.addColorStop(1, 'rgba(5, 2, 15, 0.2)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    stars.forEach(s => {
        s.y -= s.speed;
        if (s.y < -5) { s.y = h + 5; s.x = Math.random() * w; }

        const twinkle = 0.5 + 0.5 * Math.sin(time * s.twinkleSpeed + s.twinkleOffset);
        const alpha = s.opacity * twinkle;

        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(180, 160, 255, ${alpha})`;
        ctx.fill();
    });

    // Nebula glow
    const pulseAlpha = 0.04 + Math.sin(time * 0.001) * 0.02;
    const glow = ctx.createRadialGradient(w * 0.3, h * 0.5, 0, w * 0.3, h * 0.5, w * 0.4);
    glow.addColorStop(0, `rgba(123, 97, 255, ${pulseAlpha})`);
    glow.addColorStop(0.5, `rgba(255, 110, 199, ${pulseAlpha * 0.5})`);
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    const glow2 = ctx.createRadialGradient(w * 0.75, h * 0.35, 0, w * 0.75, h * 0.35, w * 0.3);
    glow2.addColorStop(0, `rgba(0, 229, 255, ${pulseAlpha * 0.6})`);
    glow2.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow2;
    ctx.fillRect(0, 0, w, h);
}

function animate(time) {
    drawStars(time);
    requestAnimationFrame(animate);
}

window.addEventListener('resize', () => { resize(); initStars(); });
resize();
initStars();
requestAnimationFrame(animate);
