/**
 * Tech Particles Background
 * Creates a subtle "constellation" effect with connected nodes.
 */

const canvas = document.createElement('canvas');
canvas.id = 'bg-particles';
document.body.prepend(canvas);

const ctx = canvas.getContext('2d');
let particlesArray;

// Styling
canvas.style.position = 'fixed';
canvas.style.top = '0';
canvas.style.left = '0';
canvas.style.width = '100%';
canvas.style.height = '100%';
canvas.style.zIndex = '-1';
canvas.style.pointerEvents = 'none'; // Allow clicks to pass through

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

let mouse = {
    x: null,
    y: null,
    radius: (canvas.height / 80) * (canvas.width / 80)
}

window.addEventListener('mousemove', (e) => {
    mouse.x = e.x;
    mouse.y = e.y;
});

// Create Particle Class
class Particle {
    constructor(x, y, dataX, directionX, directionY, size, color) {
        this.x = x;
        this.y = y;
        this.directionX = directionX;
        this.directionY = directionY;
        this.size = size;
        this.color = color;
    }

    // Method to draw individual particle
    draw() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2, false);
        ctx.fillStyle = '#cbd5e1'; // Tooltip/Gray-300 color equivalent 
        if (document.documentElement.classList.contains('dark')) {
            ctx.fillStyle = '#475569'; // Dark mode color
        }
        ctx.fill();
    }

    // Method to check particle position, check mouse position, move the particle, draw the particle
    update() {
        if (this.x > canvas.width || this.x < 0) {
            this.directionX = -this.directionX;
        }
        if (this.y > canvas.height || this.y < 0) {
            this.directionY = -this.directionY;
        }

        // Check collision detection - mouse position / particle position
        let dx = mouse.x - this.x;
        let dy = mouse.y - this.y;
        let distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < mouse.radius + this.size) {
            if (mouse.x < this.x && this.x < canvas.width - this.size * 10) {
                this.x += 10;
            }
            if (mouse.x > this.x && this.x > this.size * 10) {
                this.x -= 10;
            }
            if (mouse.y < this.y && this.y < canvas.height - this.size * 10) {
                this.y += 10;
            }
            if (mouse.y > this.y && this.y > this.size * 10) {
                this.y -= 10;
            }
        }

        this.x += this.directionX;
        this.y += this.directionY;
        this.draw();
    }
}

// Create particle array
function init() {
    particlesArray = [];
    // Dynamic number of particles based on screen size
    let numberOfParticles = (canvas.height * canvas.width) / 9000;

    for (let i = 0; i < numberOfParticles; i++) {
        let size = (Math.random() * 2) + 1; // Random size 1-3
        let x = (Math.random() * ((innerWidth - size * 2) - (size * 2)) + size * 2);
        let y = (Math.random() * ((innerHeight - size * 2) - (size * 2)) + size * 2);
        let directionX = (Math.random() * 0.4) - 0.2; // Speed range -0.2 to 0.2
        let directionY = (Math.random() * 0.4) - 0.2;
        let color = '#cbd5e1'; // Default

        particlesArray.push(new Particle(x, y, directionX, directionY, size, color));
    }
}

// Check if particles are close enough to draw line
function connect() {
    let opacityValue = 1;
    for (let a = 0; a < particlesArray.length; a++) {
        for (let b = a; b < particlesArray.length; b++) {
            let distance = ((particlesArray[a].x - particlesArray[b].x) * (particlesArray[a].x - particlesArray[b].x)) +
                ((particlesArray[a].y - particlesArray[b].y) * (particlesArray[a].y - particlesArray[b].y));

            if (distance < (canvas.width / 7) * (canvas.height / 7)) {
                opacityValue = 1 - (distance / 20000);

                let strokeColor = 'rgba(203, 213, 225, ' + opacityValue + ')'; // Light gray
                if (document.documentElement.classList.contains('dark')) {
                    strokeColor = 'rgba(71, 85, 105, ' + opacityValue + ')'; // Dark gray
                }

                ctx.strokeStyle = strokeColor;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(particlesArray[a].x, particlesArray[a].y);
                ctx.lineTo(particlesArray[b].x, particlesArray[b].y);
                ctx.stroke();
            }
        }
    }
}

// Animation Loop
function animate() {
    requestAnimationFrame(animate);
    ctx.clearRect(0, 0, innerWidth, innerHeight);

    for (let i = 0; i < particlesArray.length; i++) {
        particlesArray[i].update();
    }
    connect();
}

// Global run
window.addEventListener('resize', () => {
    canvas.width = innerWidth;
    canvas.height = innerHeight;
    mouse.radius = ((canvas.height / 80) * (canvas.height / 80));
    init();
});

window.addEventListener('mouseout', () => {
    mouse.x = undefined;
    mouse.y = undefined;
});

init();
animate();
