const socket = io();

// ─── DOM refs ───────────────────────────────────
const scoreRed = document.getElementById('score-red');
const scoreBlue = document.getElementById('score-blue');
const penaltyRed = document.getElementById('penalty-red');
const penaltyBlue = document.getElementById('penalty-blue');
const timerMin = document.getElementById('timer-min');
const timerSec = document.getElementById('timer-sec');
const timerDisplay = document.getElementById('timer-display');
const breakTimerDisplay = document.getElementById('break-timer-display');
const breakMin = document.getElementById('break-min');
const breakSec = document.getElementById('break-sec');
const roundNumber = document.getElementById('round-number');
const roundTotal = document.getElementById('round-total');
const matchStatus = document.getElementById('match-status');
const goldenBadge = document.getElementById('golden-badge');
const scoreFlash = document.getElementById('score-flash');
const targetReachedOverlay = document.getElementById('target-reached-overlay');
const targetReachedReason = document.getElementById('target-reached-reason');
const winnerOverlay = document.getElementById('winner-overlay');
const winnerText = document.getElementById('winner-text');
const roundSummary = document.getElementById('round-summary');
const roundTableBody = document.getElementById('round-table-body');
const totalRedEl = document.getElementById('total-red');
const totalBlueEl = document.getElementById('total-blue');

// ─── Audio (Chime) ──────────────────────────────
let chimeAudio = new Audio('https://actions.google.com/sounds/v1/alarms/bugle_tune.ogg');
chimeAudio.volume = 0.8;

function playBuzzer() {
    chimeAudio.currentTime = 0;
    chimeAudio.play().catch(e => console.log('Audio blocked', e));
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

    // Break Timer
    const breakSecTotal = Math.ceil(state.breakTimer);
    if ((state.status === 'paused' || state.status === 'roundEnd') && breakSecTotal > 0) {
        breakTimerDisplay.classList.remove('hidden');
        timerDisplay.classList.add('dimmed');
        const bMin = Math.floor(breakSecTotal / 60);
        const bSec = breakSecTotal % 60;
        breakMin.textContent = String(bMin).padStart(2, '0');
        breakSec.textContent = String(bSec).padStart(2, '0');
    } else {
        breakTimerDisplay.classList.add('hidden');
        timerDisplay.classList.remove('dimmed');
    }

    // Danger state (last 10 seconds of round)
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

    // Target Reached Alert - Only shown in admin dashboard now
    targetReachedOverlay.classList.add('hidden');

    // Winner overlay
    if (state.status === 'matchEnd' && state.winner) {
        winnerOverlay.classList.remove('hidden', 'winner-red', 'winner-blue', 'winner-draw');
        winnerOverlay.classList.add(`winner-${state.winner}`);
        if (state.winner === 'draw') {
            winnerText.textContent = 'DRAW';
        } else {
            winnerText.textContent = `${state.winner === 'red' ? 'HONG' : 'CHUNG'} WINS!`;
        }

        // Populate round summary table
        if (state.roundHistory && state.roundHistory.length > 0) {
            roundSummary.classList.remove('hidden');
            roundTableBody.innerHTML = '';
            let cumRed = 0, cumBlue = 0;
            state.roundHistory.forEach(r => {
                const rRedTotal = r.scores.red + r.penaltyPoints.red;
                const rBlueTotal = r.scores.blue + r.penaltyPoints.blue;
                cumRed += rRedTotal;
                cumBlue += rBlueTotal;
                const tr = document.createElement('tr');
                const label = r.round === 'GP' ? 'Golden Pt' : `Round ${r.round}`;
                tr.innerHTML = `<td>${label}</td><td class="col-red">${rRedTotal}</td><td class="col-blue">${rBlueTotal}</td>`;
                roundTableBody.appendChild(tr);
            });
            totalRedEl.textContent = cumRed;
            totalBlueEl.textContent = cumBlue;

            // Hit Counts
            const hitCountSummary = document.getElementById('hit-count-summary');
            if (hitCountSummary) {
                hitCountSummary.classList.remove('hidden');
                
                let headRed = 0, headBlue = 0;
                let bodyRed = 0, bodyBlue = 0;
                let turnRed = 0, turnBlue = 0;
                
                state.roundHistory.forEach(r => {
                    if (r.hitCounts) {
                        headRed += r.hitCounts.red.head;
                        headBlue += r.hitCounts.blue.head;
                        bodyRed += r.hitCounts.red.body;
                        bodyBlue += r.hitCounts.blue.body;
                        turnRed += (r.hitCounts.red.turn || 0);
                        turnBlue += (r.hitCounts.blue.turn || 0);
                    }
                });
                
                document.getElementById('hit-head-red').textContent = headRed;
                document.getElementById('hit-head-blue').textContent = headBlue;
                document.getElementById('hit-body-red').textContent = bodyRed;
                document.getElementById('hit-body-blue').textContent = bodyBlue;
                document.getElementById('hit-turn-red').textContent = turnRed;
                document.getElementById('hit-turn-blue').textContent = turnBlue;
            }

        } else {
            roundSummary.classList.add('hidden');
            const hitCountSummary = document.getElementById('hit-count-summary');
            if (hitCountSummary) hitCountSummary.classList.add('hidden');
        }
    } else {
        winnerOverlay.classList.add('hidden');
        roundSummary.classList.add('hidden');
        const hitCountSummary = document.getElementById('hit-count-summary');
        if (hitCountSummary) hitCountSummary.classList.add('hidden');
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

// ─── Floating Text Animations ───────────────────
function showFloatingText(color, message, type) {
    const container = document.getElementById(`float-container-${color}`);
    if (!container) return;

    const el = document.createElement('div');
    el.className = `floating-text ${type}-anim`;
    el.textContent = message;

    // Slight random horizontal offset
    const offsetX = (Math.random() - 0.5) * 40;
    el.style.left = `calc(50% + ${offsetX}px)`;
    el.style.transform = 'translateX(-50%)';

    container.appendChild(el);

    // Remove element after animation completes (1.5s)
    setTimeout(() => {
        el.remove();
    }, 1500);
}

// ─── Socket events ──────────────────────────────
socket.on('state:update', render);

socket.on('score:awarded', (data) => {
    showScoreFlash(data.color, data.points);
    showFloatingText(data.color, `+${data.points} ${data.zone.toUpperCase()}!`, 'score');
});

socket.on('penalty:awarded', (data) => {
    showFloatingText(data.color, 'GAMJEOM!', 'penalty');
});

socket.on('round:end', () => {
    playBuzzer();
});

socket.on('break:end', () => {
    // Ring the same chime when the break is over
    playBuzzer();
});

// Enable audio on first interaction
document.addEventListener('click', () => {
    chimeAudio.load();
}, { once: true });
