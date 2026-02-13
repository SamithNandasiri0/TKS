const socket = io();

// ─── DOM refs ───────────────────────────────────
const scoreRed = document.getElementById('score-red');
const scoreBlue = document.getElementById('score-blue');
const penaltyRed = document.getElementById('penalty-red');
const penaltyBlue = document.getElementById('penalty-blue');
const timerMin = document.getElementById('timer-min');
const timerSec = document.getElementById('timer-sec');
const timerDisplay = document.getElementById('timer-display');
const roundNumber = document.getElementById('round-number');
const roundTotal = document.getElementById('round-total');
const matchStatus = document.getElementById('match-status');
const goldenBadge = document.getElementById('golden-badge');
const scoreFlash = document.getElementById('score-flash');
const winnerOverlay = document.getElementById('winner-overlay');
const winnerText = document.getElementById('winner-text');

// ─── Buzzer (Web Audio API) ─────────────────────
let audioCtx = null;
function playBuzzer() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(440, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(220, audioCtx.currentTime + 1.5);
    gain.gain.setValueAtTime(0.5, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 1.5);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 1.5);
}

// ─── State rendering ────────────────────────────
let prevState = null;

function render(data) {
    const { state, config } = data;

    // Scores (with penalty points included)
    const redTotal = state.scores.red + state.penaltyPoints.red;
    const blueTotal = state.scores.blue + state.penaltyPoints.blue;

    // Animate score changes
    if (prevState) {
        const prevRedTotal = prevState.scores.red + prevState.penaltyPoints.red;
        const prevBlueTotal = prevState.scores.blue + prevState.penaltyPoints.blue;
        if (redTotal !== prevRedTotal) popScore(scoreRed);
        if (blueTotal !== prevBlueTotal) popScore(scoreBlue);
    }

    scoreRed.textContent = redTotal;
    scoreBlue.textContent = blueTotal;

    // Penalties
    penaltyRed.textContent = state.penalties.red;
    penaltyBlue.textContent = state.penalties.blue;

    // Timer
    const totalSec = Math.ceil(state.timer);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    timerMin.textContent = String(min).padStart(2, '0');
    timerSec.textContent = String(sec).padStart(2, '0');

    // Danger state (last 10 seconds)
    timerDisplay.classList.toggle('danger', state.status === 'running' && totalSec <= 10);

    // Round info
    roundNumber.textContent = state.isGoldenPoint ? 'GP' : state.currentRound;
    roundTotal.textContent = state.isGoldenPoint ? '' : `/ ${config.rounds}`;

    // Golden point badge
    goldenBadge.classList.toggle('hidden', !state.isGoldenPoint);

    // Match status
    const statusLabels = {
        idle: 'READY',
        running: '',
        paused: 'PAUSED',
        roundEnd: 'ROUND END',
        matchEnd: ''
    };
    matchStatus.textContent = statusLabels[state.status] || '';

    // Winner overlay
    if (state.status === 'matchEnd' && state.winner) {
        winnerOverlay.classList.remove('hidden', 'winner-red', 'winner-blue', 'winner-draw');
        winnerOverlay.classList.add(`winner-${state.winner}`);
        if (state.winner === 'draw') {
            winnerText.textContent = 'DRAW';
        } else {
            winnerText.textContent = `${state.winner === 'red' ? 'HONG' : 'CHUNG'} WINS!`;
        }
    } else {
        winnerOverlay.classList.add('hidden');
    }

    prevState = JSON.parse(JSON.stringify(state));
}

function popScore(el) {
    el.classList.remove('pop');
    void el.offsetWidth; // force reflow
    el.classList.add('pop');
    setTimeout(() => el.classList.remove('pop'), 400);
}

// ─── Score flash effect ─────────────────────────
function showScoreFlash(color, points) {
    scoreFlash.className = `flash-${color} show`;
    scoreFlash.textContent = `+${points}`;
    setTimeout(() => {
        scoreFlash.className = 'hidden';
    }, 700);
}

// ─── Socket events ──────────────────────────────
socket.on('state:update', render);

socket.on('score:awarded', (data) => {
    showScoreFlash(data.color, data.points);
});

socket.on('round:end', () => {
    playBuzzer();
});

// Enable audio context on first user interaction (Chrome autoplay policy)
document.addEventListener('click', () => {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}, { once: true });
