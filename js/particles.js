// ============================================
// BASHAAN POS - PARTICLES
// ============================================

class ParticleSystem {
  constructor() {
    this.canvas = document.getElementById('particles-canvas');
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.particles = [];
    this.mouse = { x: -1000, y: -1000 };
    this.maxParticles = 60;
    this.connectionDistance = 130;
    this.colors = [
      'rgba(76, 175, 80, 0.55)',
      'rgba(102, 187, 106, 0.45)',
      'rgba(0, 230, 118, 0.35)',
      'rgba(129, 199, 132, 0.28)'
    ];
    this.isRunning = true;
    this.rafId = null;

    this.init();
  }

  init() {
    this.resize();
    this.createParticles();
    this.bindEvents();
    this.animate();
  }

  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  createParticles() {
    this.particles = [];
    for (let i = 0; i < this.maxParticles; i++) {
      this.particles.push({
        x: Math.random() * this.canvas.width,
        y: Math.random() * this.canvas.height,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5 - 0.2,
        radius: Math.random() * 2.2 + 0.8,
        color: this.colors[Math.floor(Math.random() * this.colors.length)],
        pulseSpeed: Math.random() * 0.02 + 0.005,
        pulseOffset: Math.random() * Math.PI * 2
      });
    }
  }

  bindEvents() {
    window.addEventListener('resize', () => this.resize());

    document.addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
    });

    document.addEventListener('mouseleave', () => {
      this.mouse.x = -1000; this.mouse.y = -1000;
    });

    document.addEventListener('visibilitychange', () => {
      this.isRunning = !document.hidden;
      if (this.isRunning && !this.rafId) this.animate();
    });
  }

  drawParticle(p) {
    const ctx = this.ctx;
    const pulse = Math.sin(Date.now() * p.pulseSpeed + p.pulseOffset) * 0.2 + 0.8;

    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius * 3);
    g.addColorStop(0, p.color);
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius * pulse, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius * 0.7 * pulse, 0, Math.PI * 2);
    ctx.fillStyle = p.color.replace('0.', '0.8');
    ctx.fill();
  }

  drawConnection(a, b, dist) {
    const opacity = (1 - dist / this.connectionDistance) * 0.25;
    if (opacity <= 0) return;
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = `rgba(76, 175, 80, ${opacity})`;
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }

  updateParticle(p) {
    p.x += p.vx;
    p.y += p.vy;

    const dx = p.x - this.mouse.x;
    const dy = p.y - this.mouse.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 80 && d > 0.01) {
      const f = (80 - d) / 80;
      p.x += (dx / d) * f * 1.8;
      p.y += (dy / d) * f * 1.8;
    }

    if (p.x < -10) p.x = this.canvas.width + 10;
    if (p.x > this.canvas.width + 10) p.x = -10;
    if (p.y < -10) p.y = this.canvas.height + 10;
    if (p.y > this.canvas.height + 10) p.y = -10;
  }

  animate() {
    if (!this.isRunning) { this.rafId = null; return; }
    const ctx = this.ctx;

    ctx.fillStyle = 'rgba(10, 31, 20, 0.12)';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    for (let i = 0; i < this.particles.length; i++) {
      this.updateParticle(this.particles[i]);
      this.drawParticle(this.particles[i]);

      for (let j = i + 1; j < this.particles.length; j++) {
        const dx = this.particles[i].x - this.particles[j].x;
        const dy = this.particles[i].y - this.particles[j].y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < this.connectionDistance) {
          this.drawConnection(this.particles[i], this.particles[j], d);
        }
      }
    }
    this.rafId = requestAnimationFrame(() => this.animate());
  }
}

document.addEventListener('DOMContentLoaded', () => new ParticleSystem());
