/**
 * Gravity Mode (Zero Gravity)
 * Makes KPI cards float and bounce around the screen.
 */

let gravityActive = false;
let animationId;
let bodies = [];
const GRAVITY_BTN_ID = 'toggle-gravity-btn';

document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById(GRAVITY_BTN_ID);
    if (btn) btn.addEventListener('click', toggleGravity);
});

function toggleGravity() {
    gravityActive = !gravityActive;
    const btn = document.getElementById(GRAVITY_BTN_ID);

    if (gravityActive) {
        // TURN ON
        btn.innerHTML = '<i class="fas fa-times"></i>';
        btn.classList.add('bg-red-200', 'text-red-800');
        btn.classList.remove('bg-gray-200', 'text-gray-700');
        startGravity();
    } else {
        // TURN OFF (Reload to reset cleanly)
        location.reload();
    }
}

function startGravity() {
    const cards = document.querySelectorAll('.kpi-card');
    const container = document.getElementById('dashboard-container');

    // Freeze height to prevent collapse
    document.body.style.height = '100vh';
    document.body.style.overflow = 'hidden';

    // Initialize floating bodies
    cards.forEach((card, index) => {
        const rect = card.getBoundingClientRect();

        // Clone to body to break out of grid constraints specific context
        // Actually, setting fixed position on existing elements works if we handle it right.

        card.style.position = 'fixed';
        card.style.left = rect.left + 'px';
        card.style.top = rect.top + 'px';
        card.style.width = rect.width + 'px';
        card.style.zIndex = '1000';
        card.style.transition = 'none'; // Disable grid transitions

        // Random Velocity
        const vx = (Math.random() - 0.5) * 4;
        const vy = (Math.random() - 0.5) * 4;

        bodies.push({
            element: card,
            x: rect.left,
            y: rect.top,
            vx: vx,
            vy: vy,
            width: rect.width,
            height: rect.height,
            isDragging: false
        });

        // Add Drag Events
        card.addEventListener('mousedown', (e) => startDrag(e, index));
        card.addEventListener('touchstart', (e) => startDrag(e, index));
    });

    // Start Loop
    loop();
}

// Drag Logic
let draggedBody = null;
let dragOffsetX = 0;
let dragOffsetY = 0;

function startDrag(e, index) {
    draggedBody = bodies[index];
    draggedBody.isDragging = true;
    draggedBody.vx = 0; // Stop movement while holding
    draggedBody.vy = 0;

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    dragOffsetX = clientX - draggedBody.x;
    dragOffsetY = clientY - draggedBody.y;

    // Global Listeners for move/up
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
    document.addEventListener('touchmove', onDragMove);
    document.addEventListener('touchend', onDragEnd);
}

function onDragMove(e) {
    if (!draggedBody) return;

    e.preventDefault(); // Prevent scroll
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    // Update position directly
    draggedBody.x = clientX - dragOffsetX;
    draggedBody.y = clientY - dragOffsetY;

    // Track velocity for "throw" effect
    // Simple previous position tracking could be added for better throw
}

function onDragEnd(e) {
    if (draggedBody) {
        draggedBody.isDragging = false;
        // Give a little push
        draggedBody.vx = (Math.random() - 0.5) * 10;
        draggedBody.vy = (Math.random() - 0.5) * 10;
        draggedBody = null;
    }
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
    document.removeEventListener('touchmove', onDragMove);
    document.removeEventListener('touchend', onDragEnd);
}


function loop() {
    if (!gravityActive) return;

    bodies.forEach(body => {
        if (!body.isDragging) {
            // Apply Physics
            body.x += body.vx;
            body.y += body.vy;

            // Bounce off walls
            if (body.x <= 0) {
                body.x = 0;
                body.vx *= -1;
            } else if (body.x + body.width >= window.innerWidth) {
                body.x = window.innerWidth - body.width;
                body.vx *= -1;
            }

            if (body.y <= 0) {
                body.y = 0;
                body.vy *= -1;
            } else if (body.y + body.height >= window.innerHeight) {
                body.y = window.innerHeight - body.height;
                body.vy *= -1;
            }
        }

        // Apply to element
        body.element.style.left = body.x + 'px';
        body.element.style.top = body.y + 'px';
    });

    requestAnimationFrame(loop);
}
