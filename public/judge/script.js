const socket = io();

// ─── Screens ────────────────────────────────────
const connectScreen = document.getElementById('connect-screen');
const scoringScreen = document.getElementById('scoring-screen');
const connectStatus = document.getElementById('connect-status');
const connectError = document.getElementById('connect-error');

// Status bar
const judgeLabel = document.getElementById('judge-label');
const judgeTimer = document.getElementById('judge-timer');
const judgeRound = document.getElementById('judge-round');

// Overlay
const matchOverlay = document.getElementById('match-overlay');
const overlayText = document.getElementById('overlay-text');

let myJudgeId = null;

// ─── Judge selection & connection ───────────────
document.querySelectorAll('.judge-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const id = parseInt(btn.dataset.id);
        connectAsJudge(id);
    });
});

// Check URL params for auto-connect
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.has('id')) {
    const autoId = parseInt(urlParams.get('id'));
    if (autoId >= 1 && autoId <= 3) {
        connectAsJudge(autoId);
    }
}

function connectAsJudge(id) {
    myJudgeId = id;

    // Highlight selected button
    document.querySelectorAll('.judge-btn').forEach(b => b.classList.remove('selected'));
    const selectedBtn = document.querySelector(`.judge-btn[data-id="${id}"]`);
    if (selectedBtn) selectedBtn.classList.add('selected');

    // Show connecting status
    connectStatus.classList.remove('hidden');
    connectError.classList.add('hidden');

    socket.emit('judge:register', { judgeId: id }, (response) => {
        connectStatus.classList.add('hidden');
        if (response && response.success) {
            showScoringScreen(id);
        } else {
            connectError.classList.remove('hidden');
            connectError.textContent = `Referee ${id} is already taken. Choose another position.`;
        }
    });
}

function showScoringScreen(id) {
    connectScreen.classList.add('hidden');
    scoringScreen.classList.remove('hidden');
    judgeLabel.textContent = `Referee ${id}`;
}

// ─── Touch gesture handling ─────────────────────
const SWIPE_THRESHOLD = 50; // px

document.querySelectorAll('.scoring-zone').forEach(zone => {
    let touchStartY = 0;
    let touchStartTime = 0;

    zone.addEventListener('touchstart', (e) => {
        e.preventDefault();
        touchStartY = e.touches[0].clientY;
        touchStartTime = Date.now();

        // Ripple effect
        createRipple(zone, e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: false });

    zone.addEventListener('touchend', (e) => {
        e.preventDefault();
        const touchEndY = e.changedTouches[0].clientY;
        const deltaY = touchStartY - touchEndY;
        const elapsed = Date.now() - touchStartTime;

        const color = zone.dataset.color;

        if (deltaY > SWIPE_THRESHOLD && elapsed < 500) {
            // Swipe up → Head
            sendScore(color, 'head');
            showFeedback(zone, 'HEAD!');
        } else {
            // Tap → Body
            sendScore(color, 'body');
            showFeedback(zone, 'BODY');
        }
    }, { passive: false });

    // Mouse fallback for desktop testing
    let mouseStartY = 0;
    zone.addEventListener('mousedown', (e) => {
        mouseStartY = e.clientY;
        createRipple(zone, e.clientX, e.clientY);
    });

    zone.addEventListener('mouseup', (e) => {
        const deltaY = mouseStartY - e.clientY;
        const color = zone.dataset.color;

        if (deltaY > SWIPE_THRESHOLD) {
            sendScore(color, 'head');
            showFeedback(zone, 'HEAD!');
        } else {
            sendScore(color, 'body');
            showFeedback(zone, 'BODY');
        }
    });
});

function sendScore(color, zone) {
    if (!myJudgeId) return;
    socket.emit('judge:score', { judgeId: myJudgeId, color, zone });

    // Haptic feedback
    if (navigator.vibrate) navigator.vibrate(50);
}

// ─── Visual Feedback ────────────────────────────
function showFeedback(zoneEl, text) {
    const fb = zoneEl.querySelector('.zone-feedback');
    const fbText = zoneEl.querySelector('.feedback-text');
    fbText.textContent = text;
    fb.classList.remove('hidden', 'show');
    void fb.offsetWidth;
    fb.classList.add('show');
    setTimeout(() => fb.classList.add('hidden'), 500);
}

function createRipple(zoneEl, x, y) {
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    const rect = zoneEl.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    ripple.style.width = ripple.style.height = size + 'px';
    ripple.style.left = (x - rect.left - size / 2) + 'px';
    ripple.style.top = (y - rect.top - size / 2) + 'px';
    zoneEl.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
}

// ─── State updates ──────────────────────────────
socket.on('state:update', (data) => {
    const { state, config } = data;

    // Timer
    const totalSec = Math.ceil(state.timer);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    judgeTimer.textContent = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;

    // Round
    if (state.isGoldenPoint) {
        judgeRound.textContent = 'GOLDEN PT';
    } else {
        judgeRound.textContent = `R${state.currentRound}`;
    }

    // Match status overlay
    if (state.status === 'matchEnd') {
        matchOverlay.classList.remove('hidden');
        if (state.winner === 'draw') {
            overlayText.textContent = 'MATCH END\nDRAW';
        } else {
            overlayText.textContent = `MATCH END\n${state.winner === 'red' ? 'HONG' : 'CHUNG'} WINS`;
        }
    } else if (state.status === 'idle' || state.status === 'roundEnd') {
        matchOverlay.classList.remove('hidden');
        if (state.status === 'roundEnd') {
            overlayText.textContent = 'ROUND END\nWaiting...';
        } else {
            overlayText.textContent = 'READY\nWaiting to start...';
        }
    } else if (state.status === 'paused') {
        matchOverlay.classList.remove('hidden');
        overlayText.textContent = 'PAUSED';
    } else {
        matchOverlay.classList.add('hidden');
    }
});

// ─── Reconnection handling ──────────────────────
socket.on('connect', () => {
    // Re-register if we had a judge ID
    if (myJudgeId) {
        socket.emit('judge:register', { judgeId: myJudgeId }, (response) => {
            if (!response || !response.success) {
                // Return to connect screen
                connectScreen.classList.remove('hidden');
                scoringScreen.classList.add('hidden');
                connectError.classList.remove('hidden');
                connectError.textContent = 'Reconnection failed. Your position may have been taken.';
                myJudgeId = null;
            }
        });
    }
});

socket.on('disconnect', () => {
    matchOverlay.classList.remove('hidden');
    overlayText.textContent = 'DISCONNECTED\nReconnecting...';
});
