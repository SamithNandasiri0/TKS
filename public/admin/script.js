const socket = io();

// ─── DOM refs ───────────────────────────────────
const miniScoreRed = document.getElementById('mini-score-red');
const miniScoreBlue = document.getElementById('mini-score-blue');
const miniTimerDisplay = document.getElementById('mini-timer-display');
const miniRound = document.getElementById('mini-round');
const adminPenaltyRed = document.getElementById('admin-penalty-red');
const adminPenaltyBlue = document.getElementById('admin-penalty-blue');
const serverUrl = document.getElementById('server-url');
const qrCode = document.getElementById('qr-code');
const roundHistoryPanel = document.getElementById('round-history-panel');
const roundHistoryList = document.getElementById('round-history-list');

// Config inputs
const cfgRounds = document.getElementById('cfg-rounds');
const cfgDuration = document.getElementById('cfg-duration');
const cfgBreak = document.getElementById('cfg-break');
const cfgBody = document.getElementById('cfg-body');
const cfgHead = document.getElementById('cfg-head');
const cfgTurn = document.getElementById('cfg-turn');
const cfgTech = document.getElementById('cfg-tech');
const cfgGolden = document.getElementById('cfg-golden');
const cfgConsensus = document.getElementById('cfg-consensus');
const cfgWindow = document.getElementById('cfg-window');
const cfgWindowVal = document.getElementById('cfg-window-val');
const cfgMinJudges = document.getElementById('cfg-min-judges');

// ─── Timer controls ─────────────────────────────
document.getElementById('btn-start').addEventListener('click', () => {
    socket.emit('admin:timer', { action: 'start' });
});

document.getElementById('btn-pause').addEventListener('click', () => {
    socket.emit('admin:timer', { action: 'pause' });
});

document.getElementById('btn-break').addEventListener('click', () => {
    socket.emit('admin:startBreak');
});

document.getElementById('btn-next-round').addEventListener('click', () => {
    socket.emit('admin:nextRound');
});

document.getElementById('btn-new-match').addEventListener('click', () => {
    if (confirm('Start a new match? This will reset all scores.')) {
        socket.emit('admin:newMatch');
    }
});

// ─── Score adjustment (Add/Reduce) ──────────────
document.getElementById('btn-add-body-red').addEventListener('click', () => {
    socket.emit('admin:addScore', { color: 'red', zone: 'body' });
});

document.getElementById('btn-add-head-red').addEventListener('click', () => {
    socket.emit('admin:addScore', { color: 'red', zone: 'head' });
});

document.getElementById('btn-add-turn-red').addEventListener('click', () => {
    socket.emit('admin:addScore', { color: 'red', zone: 'turn' });
});

document.getElementById('btn-add-body-blue').addEventListener('click', () => {
    socket.emit('admin:addScore', { color: 'blue', zone: 'body' });
});

document.getElementById('btn-add-head-blue').addEventListener('click', () => {
    socket.emit('admin:addScore', { color: 'blue', zone: 'head' });
});

document.getElementById('btn-add-turn-blue').addEventListener('click', () => {
    socket.emit('admin:addScore', { color: 'blue', zone: 'turn' });
});

document.getElementById('btn-reduce-body-red').addEventListener('click', () => {
    socket.emit('admin:reduceScore', { color: 'red', zone: 'body' });
});

document.getElementById('btn-reduce-head-red').addEventListener('click', () => {
    socket.emit('admin:reduceScore', { color: 'red', zone: 'head' });
});

document.getElementById('btn-reduce-turn-red').addEventListener('click', () => {
    socket.emit('admin:reduceScore', { color: 'red', zone: 'turn' });
});

document.getElementById('btn-reduce-body-blue').addEventListener('click', () => {
    socket.emit('admin:reduceScore', { color: 'blue', zone: 'body' });
});

document.getElementById('btn-reduce-head-blue').addEventListener('click', () => {
    socket.emit('admin:reduceScore', { color: 'blue', zone: 'head' });
});

document.getElementById('btn-reduce-turn-blue').addEventListener('click', () => {
    socket.emit('admin:reduceScore', { color: 'blue', zone: 'turn' });
});

// ─── Penalty controls ───────────────────────────
document.getElementById('btn-penalty-red').addEventListener('click', () => {
    socket.emit('admin:penalty', { color: 'red' });
});

document.getElementById('btn-penalty-blue').addEventListener('click', () => {
    socket.emit('admin:penalty', { color: 'blue' });
});

document.getElementById('btn-reduce-penalty-red').addEventListener('click', () => {
    socket.emit('admin:reducePenalty', { color: 'red' });
});

document.getElementById('btn-reduce-penalty-blue').addEventListener('click', () => {
    socket.emit('admin:reducePenalty', { color: 'blue' });
});

// ─── Target Reached Stoppage ─────────────────────────
const pointGapAlert = document.getElementById('point-gap-alert');
const gapValueText = document.getElementById('gap-value-text');

document.getElementById('btn-end-round').addEventListener('click', () => {
    if (confirm('Manually end the current round?')) {
        socket.emit('admin:endRound');
    }
});

// ─── Config controls ────────────────────────────
cfgWindow.addEventListener('input', () => {
    cfgWindowVal.textContent = (cfgWindow.value / 1000).toFixed(1) + 's';
});

document.getElementById('btn-apply-config').addEventListener('click', () => {
    const config = {
        rounds: parseInt(cfgRounds.value),
        roundDuration: parseInt(cfgDuration.value),
        breakDuration: parseInt(cfgBreak.value),
        goldenPoint: cfgGolden.checked,
        consensusEnabled: cfgConsensus.checked,
        consensusWindow: parseInt(cfgWindow.value),
        consensusMinJudges: parseInt(cfgMinJudges.value),
        points: {
            body: parseInt(cfgBody.value),
            head: parseInt(cfgHead.value),
            turn: parseInt(cfgTurn.value),
            tech: parseInt(cfgTech.value)
        }
    };
    socket.emit('admin:config', config);
});

// ─── State rendering ────────────────────────────
function render(data) {
    const { state, config, judges } = data;

    // Mini scoreboard
    const redTotal = state.scores.red + state.penaltyPoints.red;
    const blueTotal = state.scores.blue + state.penaltyPoints.blue;
    miniScoreRed.textContent = redTotal;
    miniScoreBlue.textContent = blueTotal;

    // Timer
    const totalSec = Math.ceil(state.timer);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    miniTimerDisplay.textContent = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;

    // Round
    if (state.isGoldenPoint) {
        miniRound.textContent = 'GOLDEN POINT';
    } else {
        miniRound.textContent = `R${state.currentRound} / ${config.rounds} — ${state.status.toUpperCase()}`;
    }

    // Penalties
    adminPenaltyRed.textContent = state.penalties.red;
    adminPenaltyBlue.textContent = state.penalties.blue;

    // Target Reached alert (Gap >= 12 or Penalties >= 5)
    const gap = Math.abs(redTotal - blueTotal);
    const isMatchActive = state.status === 'running' || state.status === 'paused';

    if (isMatchActive && (gap >= 12 || state.penalties.red >= 5 || state.penalties.blue >= 5)) {
        pointGapAlert.classList.remove('hidden');
        if (gap >= 12) {
            gapValueText.innerHTML = `The point gap is <strong>${gap}</strong> points.`;
        } else {
            const who = state.penalties.red >= 5 ? 'HONG (RED)' : 'CHUNG (BLUE)';
            const pens = Math.max(state.penalties.red, state.penalties.blue);
            gapValueText.innerHTML = `<strong>${who}</strong> reached ${pens} penalties.`;
        }
    } else {
        pointGapAlert.classList.add('hidden');
    }

    // Round history
    if (state.roundHistory && state.roundHistory.length > 0) {
        roundHistoryPanel.classList.remove('hidden');
        roundHistoryList.innerHTML = state.roundHistory.map(r => {
            const rRed = r.scores.red + r.penaltyPoints.red;
            const rBlue = r.scores.blue + r.penaltyPoints.blue;
            const label = r.round === 'GP' ? 'Golden Pt' : `R${r.round}`;
            return `<div class="rh-row"><span class="rh-label">${label}</span><span class="rh-red">${rRed}</span><span class="rh-sep">-</span><span class="rh-blue">${rBlue}</span></div>`;
        }).join('');
    } else {
        roundHistoryPanel.classList.add('hidden');
    }

    // Judge slots
    for (let i = 1; i <= 3; i++) {
        const slot = document.getElementById(`judge-slot-${i}`);
        const judge = judges.find(j => j.id === i);
        if (judge && judge.connected) {
            slot.className = 'judge-slot online';
            slot.innerHTML = `Referee ${i} — <span>Connected ✓</span>`;
        } else {
            slot.className = 'judge-slot offline';
            slot.innerHTML = `Referee ${i} — <span>Offline</span>`;
        }
    }

    // Sync config inputs to current server config (on first load)
    if (!render._synced) {
        cfgRounds.value = config.rounds;
        cfgDuration.value = config.roundDuration;
        if (cfgBreak) cfgBreak.value = config.breakDuration || 30;
        cfgBody.value = config.points.body;
        cfgHead.value = config.points.head;
        if (cfgTurn) cfgTurn.value = config.points.turn || 5;
        cfgTech.value = config.points.tech;
        cfgGolden.checked = config.goldenPoint;
        cfgConsensus.checked = config.consensusEnabled;
        cfgWindow.value = config.consensusWindow;
        cfgWindowVal.textContent = (config.consensusWindow / 1000).toFixed(1) + 's';
        cfgMinJudges.value = config.consensusMinJudges;
        render._synced = true;
    }
}

socket.on('state:update', render);

// ─── Load server info & QR code ─────────────────
async function loadServerInfo() {
    try {
        const resp = await fetch('/api/server-info');
        const data = await resp.json();
        serverUrl.textContent = data.url;
    } catch (e) {
        serverUrl.textContent = 'Error loading';
    }

    try {
        const resp = await fetch('/api/qrcode');
        const data = await resp.json();
        qrCode.src = data.qr;
    } catch (e) {
        qrCode.alt = 'QR code unavailable';
    }
}

loadServerInfo();
