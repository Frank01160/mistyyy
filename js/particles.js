// ============================================
// BASHAAN POS - PARTICLE ANIMATION ENGINE
// ============================================

class ParticleSystem {
    constructor() {
        this.canvas = document.getElementById('particles-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.particles = [];
        this.mouse = { x: -1000, y: -1000 };
        this.maxParticles = 80;
        this.connectionDistance = 120;
        this.colors = [
            'rgba(76, 175, 80, 0.6)',   // Green primary
            'rgba(102, 187, 106, 0.5)',  // Green light
            'rgba(0, 230, 118, 0.4)',    // Green accent
            'rgba(129, 199, 132, 0.3)',  // Green lighter
            'rgba(165, 214, 167, 0.2)',  // Green pale
        ];
        this.isRunning = true;
        
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
                vx: (Math.random() - 0.5) * 0.8,
                vy: (Math.random() - 0.5) * 0.8 - 0.3, // Slight upward drift
                radius: Math.random() * 3 + 1,
                color: this.colors[Math.floor(Math.random() * this.colors.length)],
                opacity: Math.random() * 0.5 + 0.2,
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
            this.mouse.x = -1000;
            this.mouse.y = -1000;
        });
        
        // Handle page visibility
        document.addEventListener('visibilitychange', () => {
            this.isRunning = !document.hidden;
            if (this.isRunning) {
                this.animate();
            }
        });
    }
    
    drawParticle(particle) {
        const ctx = this.ctx;
        const pulse = Math.sin(Date.now() * particle.pulseSpeed + particle.pulseOffset) * 0.2 + 0.8;
        
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.radius * pulse, 0, Math.PI * 2);
        
        // Glow effect
        const gradient = ctx.createRadialGradient(
            particle.x, particle.y, 0,
            particle.x, particle.y, particle.radius * 3
        );
        gradient.addColorStop(0, particle.color);
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        
        ctx.fillStyle = gradient;
        ctx.fill();
        
        // Core
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.radius * 0.7 * pulse, 0, Math.PI * 2);
        ctx.fillStyle = particle.color.replace('0.', '0.8');
        ctx.fill();
    }
    
    drawConnections(p1, p2, distance) {
        const ctx = this.ctx;
        const opacity = (1 - distance / this.connectionDistance) * 0.3;
        
        if (opacity <= 0) return;
        
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.strokeStyle = `rgba(76, 175, 80, ${opacity})`;
        ctx.lineWidth = 0.5;
        ctx.stroke();
    }
    
    updateParticle(particle) {
        // Move particle
        particle.x += particle.vx;
        particle.y += particle.vy;
        
        // Mouse interaction - particles avoid cursor
        const dx = particle.x - this.mouse.x;
        const dy = particle.y - this.mouse.y;
        const distToMouse = Math.sqrt(dx * dx + dy * dy);
        
        if (distToMouse < 80) {
            const force = (80 - distToMouse) / 80;
            particle.x += (dx / distToMouse) * force * 2;
            particle.y += (dy / distToMouse) * force * 2;
        }
        
        // Wrap around edges
        if (particle.x < -10) particle.x = this.canvas.width + 10;
        if (particle.x > this.canvas.width + 10) particle.x = -10;
        if (particle.y < -10) particle.y = this.canvas.height + 10;
        if (particle.y > this.canvas.height + 10) particle.y = -10;
    }
    
    animate() {
        if (!this.isRunning) return;
        
        const ctx = this.ctx;
        
        // Clear with slight trail effect
        ctx.fillStyle = 'rgba(10, 31, 20, 0.1)';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Update and draw particles
        for (let i = 0; i < this.particles.length; i++) {
            this.updateParticle(this.particles[i]);
            this.drawParticle(this.particles[i]);
            
            // Draw connections with nearby particles
            for (let j = i + 1; j < this.particles.length; j++) {
                const dx = this.particles[i].x - this.particles[j].x;
                const dy = this.particles[i].y - this.particles[j].y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                if (distance < this.connectionDistance) {
                    this.drawConnections(this.particles[i], this.particles[j], distance);
                }
            }
        }
        
        requestAnimationFrame(() => this.animate());
    }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    new ParticleSystem();
    console.log('✨ Particle system initialized');
});