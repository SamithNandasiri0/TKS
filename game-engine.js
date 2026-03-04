class GameEngine {
  constructor() {
    this.reset();
  }

  /** Reset to default configuration and zero state */
  reset() {
    // Configuration (can be changed via admin)
    this.config = {
      rounds: 3,
      roundDuration: 120,        // seconds
      goldenPoint: true,
      consensusEnabled: true,
      consensusWindow: 1000,     // ms — votes must arrive within this window
      consensusMinJudges: 2,     // minimum agreeing judges
      points: {
        body: 2,
        head: 3,
        tech: 1
      }
    };

    // Match state
    this.state = {
      status: 'idle',            // idle | running | paused | roundEnd | matchEnd
      currentRound: 1,
      isGoldenPoint: false,
      timer: this.config.roundDuration,
      scores: { red: 0, blue: 0 },
      penalties: { red: 0, blue: 0 },  // gamjeom count
      penaltyPoints: { red: 0, blue: 0 }, // points awarded from opponent penalties
      winner: null,
      roundHistory: []  // { round, scores, penalties, penaltyPoints }
    };

    // Consensus vote buffer
    this._voteBuffer = [];

    // Timer internals
    this._timerInterval = null;
    this._lastTick = null;

    // Connected judges
    this.judges = {};  // { socketId: { id: 1|2|3, connected: true } }
  }

  /** Update configuration (partial merge) */
  updateConfig(partial) {
    if (partial.points) {
      Object.assign(this.config.points, partial.points);
      delete partial.points;
    }
    Object.assign(this.config, partial);
    // If round duration changed while idle, update timer
    if (this.state.status === 'idle' || this.state.status === 'roundEnd') {
      this.state.timer = this.config.roundDuration;
    }
  }

  /** Get serializable snapshot */
  getState() {
    return {
      config: { ...this.config, points: { ...this.config.points } },
      state: {
        ...this.state,
        scores: { ...this.state.scores },
        penalties: { ...this.state.penalties },
        penaltyPoints: { ...this.state.penaltyPoints },
        roundHistory: this.state.roundHistory.map(r => ({
          round: r.round,
          scores: { ...r.scores },
          penalties: { ...r.penalties },
          penaltyPoints: { ...r.penaltyPoints }
        }))
      },
      judges: Object.values(this.judges).map(j => ({ id: j.id, connected: j.connected }))
    };
  }

  // ─── Timer ────────────────────────────────────────────────────

  startTimer(onTick, onRoundEnd) {
    if (this.state.status === 'matchEnd') return;
    if (this._timerInterval) return; // already running

    this.state.status = 'running';
    this._lastTick = Date.now();

    this._timerInterval = setInterval(() => {
      const now = Date.now();
      const elapsed = (now - this._lastTick) / 1000;
      this._lastTick = now;
      this.state.timer = Math.max(0, this.state.timer - elapsed);

      if (this.state.timer <= 0) {
        this.state.timer = 0;
        this._stopTimerInternal();
        this._handleRoundEnd(onRoundEnd);
      }
      if (onTick) onTick(this.getState());
    }, 100);

    return this.getState();
  }

  pauseTimer() {
    if (this.state.status !== 'running') return this.getState();
    this._stopTimerInternal();
    this.state.status = 'paused';
    return this.getState();
  }

  _stopTimerInternal() {
    if (this._timerInterval) {
      clearInterval(this._timerInterval);
      this._timerInterval = null;
    }
  }

  _handleRoundEnd(onRoundEnd) {
    const isLastRound = this.state.currentRound >= this.config.rounds;
    const isGolden = this.state.isGoldenPoint;

    // Save current round's scores into history
    this._saveRoundToHistory();

    if (isGolden) {
      // Golden point round ended without a score — draw
      this.state.status = 'matchEnd';
      this.state.winner = this._determineWinner();
    } else if (isLastRound) {
      // Check if we need golden point — use cumulative totals
      const totals = this._getCumulativeTotals();
      if (totals.red === totals.blue && this.config.goldenPoint) {
        this.state.status = 'roundEnd';
        this.state.isGoldenPoint = true;
        this.state.timer = this.config.roundDuration;
        // Reset scores for golden point round
        this._resetRoundScores();
      } else {
        this.state.status = 'matchEnd';
        this.state.winner = this._determineWinner();
      }
    } else {
      this.state.status = 'roundEnd';
      this.state.currentRound++;
      this.state.timer = this.config.roundDuration;
      // Reset scores for next round
      this._resetRoundScores();
    }

    if (onRoundEnd) onRoundEnd(this.getState());
  }

  _determineWinner() {
    const totals = this._getCumulativeTotals();
    if (totals.red > totals.blue) return 'red';
    if (totals.blue > totals.red) return 'blue';
    return 'draw';
  }

  /** Save current round scores to history */
  _saveRoundToHistory() {
    this.state.roundHistory.push({
      round: this.state.isGoldenPoint ? 'GP' : this.state.currentRound,
      scores: { ...this.state.scores },
      penalties: { ...this.state.penalties },
      penaltyPoints: { ...this.state.penaltyPoints }
    });
  }

  /** Reset scores/penalties for a new round */
  _resetRoundScores() {
    this.state.scores = { red: 0, blue: 0 };
    this.state.penalties = { red: 0, blue: 0 };
    this.state.penaltyPoints = { red: 0, blue: 0 };
  }

  /** Get cumulative totals across all rounds in history (includes current round scores) */
  _getCumulativeTotals() {
    let red = this.state.scores.red + this.state.penaltyPoints.red;
    let blue = this.state.scores.blue + this.state.penaltyPoints.blue;
    for (const r of this.state.roundHistory) {
      red += r.scores.red + r.penaltyPoints.red;
      blue += r.scores.blue + r.penaltyPoints.blue;
    }
    return { red, blue };
  }

  // ─── Scoring ──────────────────────────────────────────────────

  /**
   * Register a judge's score vote.
   * Returns the updated state if a point was awarded, null otherwise.
   */
  addScore(judgeId, color, zone) {
    if (this.state.status !== 'running') return null;
    if (!['red', 'blue'].includes(color)) return null;
    if (!['body', 'head', 'tech'].includes(zone)) return null;

    if (!this.config.consensusEnabled) {
      // No consensus — every vote counts immediately
      this._applyScore(color, zone);
      return this.getState();
    }

    // Consensus mode
    const now = Date.now();
    this._voteBuffer.push({ judgeId, color, zone, time: now });

    // Purge old votes
    this._voteBuffer = this._voteBuffer.filter(v => now - v.time <= this.config.consensusWindow);

    // Check consensus for this color+zone
    const matching = this._voteBuffer.filter(v => v.color === color && v.zone === zone);
    const uniqueJudges = new Set(matching.map(v => v.judgeId));

    if (uniqueJudges.size >= this.config.consensusMinJudges) {
      this._applyScore(color, zone);
      // Clear matching votes so we don't double-count
      this._voteBuffer = this._voteBuffer.filter(v => !(v.color === color && v.zone === zone));
      return this.getState();
    }

    return null; // No consensus yet
  }

  _applyScore(color, zone) {
    const pts = this.config.points[zone] || 0;
    this.state.scores[color] += pts;

    // Golden point — immediate win
    if (this.state.isGoldenPoint && pts > 0) {
      this._stopTimerInternal();
      this.state.status = 'matchEnd';
      this.state.winner = color;
    }
  }

  // ─── Penalties ────────────────────────────────────────────────

  addPenalty(color) {
    if (!['red', 'blue'].includes(color)) return this.getState();
    this.state.penalties[color]++;
    // Every gamjeom gives 1 point to the opponent
    const opponent = color === 'red' ? 'blue' : 'red';
    this.state.penaltyPoints[opponent]++;

    // Check for disqualification (10 gamjeoms)
    if (this.state.penalties[color] >= 10) {
      this._stopTimerInternal();
      this.state.status = 'matchEnd';
      this.state.winner = opponent;
    }

    return this.getState();
  }

  // ─── Score Reduction (Admin) ────────────────────────────────────

  reduceScore(color, zone) {
    if (!['red', 'blue'].includes(color)) return this.getState();
    if (!['body', 'head'].includes(zone)) return this.getState();

    const pts = this.config.points[zone] || 0;
    this.state.scores[color] = Math.max(0, this.state.scores[color] - pts);
    return this.getState();
  }

  // ─── Penalty Reduction (Admin) ────────────────────────────────

  reducePenalty(color) {
    if (!['red', 'blue'].includes(color)) return this.getState();
    if (this.state.penalties[color] <= 0) return this.getState();

    this.state.penalties[color]--;
    const opponent = color === 'red' ? 'blue' : 'red';
    this.state.penaltyPoints[opponent] = Math.max(0, this.state.penaltyPoints[opponent] - 1);
    return this.getState();
  }

  // ─── Point-Gap Stoppage (Admin) ───────────────────────────────

  getPointGap() {
    const redTotal = this.state.scores.red + this.state.penaltyPoints.red;
    const blueTotal = this.state.scores.blue + this.state.penaltyPoints.blue;
    return Math.abs(redTotal - blueTotal);
  }

  adminStopMatch(winner) {
    if (!['red', 'blue'].includes(winner)) return this.getState();
    if (this.state.status !== 'running' && this.state.status !== 'paused') return this.getState();

    this._stopTimerInternal();
    this.state.status = 'matchEnd';
    this.state.winner = winner;
    return this.getState();
  }

  // ─── Judge Management ─────────────────────────────────────────

  registerJudge(socketId, judgeNumber) {
    // Validate judge number 1-3
    const num = parseInt(judgeNumber);
    if (num < 1 || num > 3) return false;

    // Check if this number is already taken by another connected judge
    for (const [sid, j] of Object.entries(this.judges)) {
      if (j.id === num && j.connected && sid !== socketId) return false;
    }

    this.judges[socketId] = { id: num, connected: true };
    return true;
  }

  disconnectJudge(socketId) {
    if (this.judges[socketId]) {
      this.judges[socketId].connected = false;
    }
  }

  removeJudge(socketId) {
    delete this.judges[socketId];
  }

  /** Start a new match (reset scores but keep config) */
  newMatch() {
    this._stopTimerInternal();
    this.state = {
      status: 'idle',
      currentRound: 1,
      isGoldenPoint: false,
      timer: this.config.roundDuration,
      scores: { red: 0, blue: 0 },
      penalties: { red: 0, blue: 0 },
      penaltyPoints: { red: 0, blue: 0 },
      winner: null,
      roundHistory: []
    };
    this._voteBuffer = [];
    return this.getState();
  }
}

module.exports = GameEngine;
