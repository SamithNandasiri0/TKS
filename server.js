/**
 * TKD Scoring Wi-Fi — Server
 * Express + Socket.IO server for real-time scoring over local Wi-Fi.
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const path = require('path');
const QRCode = require('qrcode');
const GameEngine = require('./game-engine');

const PORT = 4444;
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const game = new GameEngine();

// ─── Static files ───────────────────────────────────────────────
app.use('/scoreboard', express.static(path.join(__dirname, 'public', 'scoreboard')));
app.use('/admin', express.static(path.join(__dirname, 'public', 'admin')));
app.use('/judge', express.static(path.join(__dirname, 'public', 'judge')));
app.use('/assets', express.static(path.join(__dirname, 'public', 'assets')));

// Default route → scoreboard
app.get('/', (req, res) => res.redirect('/scoreboard'));

// ─── REST API for QR code & server info ─────────────────────────
app.get('/api/server-info', (req, res) => {
    const ip = getLocalIP();
    res.json({ ip, port: PORT, url: `http://${ip}:${PORT}` });
});

app.get('/api/qrcode', async (req, res) => {
    try {
        const ip = getLocalIP();
        const url = `http://${ip}:${PORT}/judge`;
        const dataUrl = await QRCode.toDataURL(url, { width: 300, margin: 2 });
        res.json({ qr: dataUrl, url });
    } catch (err) {
        res.status(500).json({ error: 'Failed to generate QR code' });
    }
});

// ─── Socket.IO ──────────────────────────────────────────────────

function broadcastState() {
    io.emit('state:update', game.getState());
}

io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    // Send current state on connect
    socket.emit('state:update', game.getState());

    // ── Judge events ──
    socket.on('judge:register', (data, callback) => {
        const success = game.registerJudge(socket.id, data.judgeId);
        if (callback) callback({ success, judgeId: data.judgeId });
        broadcastState();
        if (success) {
            console.log(`Judge ${data.judgeId} registered (${socket.id})`);
        }
    });

    socket.on('judge:score', (data) => {
        // data: { judgeId, color, zone }
        const judgeInfo = game.judges[socket.id];
        if (!judgeInfo || !judgeInfo.connected) return;

        const result = game.addScore(judgeInfo.id, data.color, data.zone);
        // Always broadcast so clients see vote feedback; result indicates if points were awarded
        broadcastState();
        if (result) {
            io.emit('score:awarded', { color: data.color, zone: data.zone, points: game.config.points[data.zone] });
        }
    });

    // ── Admin events ──
    socket.on('admin:timer', (data) => {
        switch (data.action) {
            case 'start':
                game.startTimer(
                    () => broadcastState(),
                    () => {
                        broadcastState();
                        io.emit('round:end', game.getState());
                    }
                );
                break;
            case 'pause':
                game.pauseTimer();
                break;
        }
        broadcastState();
    });

    socket.on('admin:config', (data) => {
        game.updateConfig(data);
        broadcastState();
    });

    socket.on('admin:penalty', (data) => {
        game.addPenalty(data.color);
        broadcastState();
    });

    socket.on('admin:newMatch', () => {
        game.newMatch();
        broadcastState();
    });

    socket.on('admin:nextRound', () => {
        if (game.state.status === 'roundEnd') {
            // Already advanced round in _handleRoundEnd; just reset timer status
            game.state.status = 'idle';
            broadcastState();
        }
    });

    // ── Disconnect ──
    socket.on('disconnect', () => {
        game.disconnectJudge(socket.id);
        broadcastState();
        console.log(`Client disconnected: ${socket.id}`);
    });
});

// ─── Helpers ────────────────────────────────────────────────────

// Allow manual IP override: node server.js --ip 192.168.1.5
// Or via env: SERVER_IP=192.168.1.5 node server.js
const manualIP = (() => {
    const ipArgIdx = process.argv.indexOf('--ip');
    if (ipArgIdx !== -1 && process.argv[ipArgIdx + 1]) return process.argv[ipArgIdx + 1];
    if (process.env.SERVER_IP) return process.env.SERVER_IP;
    return null;
})();

function getLocalIP() {
    if (manualIP) return manualIP;

    const interfaces = os.networkInterfaces();
    const candidates = [];

    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                const addr = iface.address;
                // Skip link-local / APIPA addresses (169.254.x.x) — unreachable from other devices
                if (addr.startsWith('169.254.')) continue;
                candidates.push({ address: addr, name });
            }
        }
    }

    if (candidates.length === 0) return '127.0.0.1';

    // Prefer common LAN ranges
    const preferred = candidates.find(c =>
        c.address.startsWith('192.168.') ||
        c.address.startsWith('10.') ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(c.address)
    );

    return preferred ? preferred.address : candidates[0].address;
}

// ─── Start ──────────────────────────────────────────────────────

server.listen(PORT, '0.0.0.0', () => {
    const ip = getLocalIP();
    console.log('');
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║         TKD Scoring Wi-Fi Server                ║');
    console.log('╠══════════════════════════════════════════════════╣');
    console.log(`║  Scoreboard:  http://${ip}:${PORT}/scoreboard`);
    console.log(`║  Admin:       http://${ip}:${PORT}/admin`);
    console.log(`║  Judge:       http://${ip}:${PORT}/judge`);
    console.log('╠══════════════════════════════════════════════════╣');
    console.log(`║  Local:       http://localhost:${PORT}`);
    console.log('╚══════════════════════════════════════════════════╝');
    console.log('');
});
