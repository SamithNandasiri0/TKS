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
      breakDuration: 30,         // seconds
      points: {
        body: 2,
        head: 3,
        turn: 5,
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
      breakTimer: 0,
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

  startTimer(onTick, onRoundEnd, onBreakEnd) {
    if (this.state.status === 'matchEnd') return this.getState();
    if (this.state.status === 'running') return this.getState(); // already running

    this.state.status = 'running';
    this.state.breakTimer = 0; // Clear break timer when starting
    this._lastTick = Date.now();

    // Store callbacks internally to prevent scoping issues on pause/resume
    if (onTick) this._onTick = onTick;
    if (onRoundEnd) this._onRoundEnd = onRoundEnd;
    if (onBreakEnd) this._onBreakEnd = onBreakEnd;

    if (!this._timerInterval) {
      this._timerInterval = setInterval(() => {
        const now = Date.now();
        const elapsed = (now - this._lastTick) / 1000;
        this._lastTick = now;

        if (this.state.status === 'running') {
          this.state.timer = Math.max(0, this.state.timer - elapsed);

          if (this.state.timer <= 0) {
            this.state.timer = 0;
            // DO NOT stop interval here! It needs to keep ticking for the break timer
            this._handleRoundEnd(this._onRoundEnd);
          }
        } else if (this.state.status === 'paused' || this.state.status === 'roundEnd' || this.state.status === 'idle') {
          if (this.state.breakTimer > 0) {
            this.state.breakTimer -= elapsed;
            if (this.state.breakTimer <= 0) {
              this.state.breakTimer = 0;
              if (this._onBreakEnd) this._onBreakEnd();
            }
          }
        }

        if (this._onTick) this._onTick(this.getState());
      }, 100);
    }

    return this.getState();
  }

  startBreak(onTick, onRoundEnd, onBreakEnd) {
    if (this.state.status === 'running') return this.getState(); // Cannot start break while running

    this.state.breakTimer = this.config.breakDuration; // Initialize break timer
    this._lastTick = Date.now();

    // Store callbacks Internally
    if (onTick) this._onTick = onTick;
    if (onRoundEnd) this._onRoundEnd = onRoundEnd;
    if (onBreakEnd) this._onBreakEnd = onBreakEnd;

    if (!this._timerInterval) {
      this._timerInterval = setInterval(() => {
        const now = Date.now();
        const elapsed = (now - this._lastTick) / 1000;
        this._lastTick = now;

        if (this.state.status === 'running') {
          this.state.timer = Math.max(0, this.state.timer - elapsed);

          if (this.state.timer <= 0) {
            this.state.timer = 0;
            // DO NOT stop interval here! It needs to keep ticking for the break timer
            this._handleRoundEnd(this._onRoundEnd);
          }
        } else if (this.state.status === 'paused' || this.state.status === 'roundEnd' || this.state.status === 'idle') {
          if (this.state.breakTimer > 0) {
            this.state.breakTimer -= elapsed;
            if (this.state.breakTimer <= 0) {
              this.state.breakTimer = 0;
              if (this._onBreakEnd) this._onBreakEnd();
            }
          }
        }

        if (this._onTick) this._onTick(this.getState());
      }, 100);
    }

    return this.getState();
  }

  pauseTimer() {
    if (this.state.status !== 'running') return this.getState();
    // We do NOT stop the internal interval, because we need it to tick the break timer.
    this.state.status = 'paused';
    this.state.breakTimer = this.config.breakDuration; // start break timer
    this._lastTick = Date.now(); // reset tick to avoid huge jumps
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
      this.state.breakTimer = this.config.breakDuration;
      // We do not stop the internal interval, to let the break timer run during roundEnd
      this._lastTick = Date.now();
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
    if (!['running', 'paused', 'roundEnd'].includes(this.state.status)) return null; // Allow scoring while paused or round ended
    if (!['red', 'blue'].includes(color)) return null;
    if (!['body', 'head', 'turn', 'tech'].includes(zone)) return null;

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

    // Removed auto-stop on 10 penalties — rely on Smart Notifications instead.

    return this.getState();
  }

  // ─── Score Adjustment (Admin) ────────────────────────────────────

  adminAddScore(color, zone) {
    if (!['red', 'blue'].includes(color)) return this.getState();
    if (!['body', 'head', 'turn', 'tech'].includes(zone)) return this.getState();

    const pts = this.config.points[zone] || 0;
    this.state.scores[color] += pts;
    return this.getState();
  }

  reduceScore(color, zone) {
    if (!['red', 'blue'].includes(color)) return this.getState();
    if (!['body', 'head', 'turn'].includes(zone)) return this.getState();

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

  // ─── Admin Triggers ───────────────────────────────

  adminEndRound(onRoundEnd) {
    if (this.state.status !== 'running' && this.state.status !== 'paused') return this.getState();
    this.state.timer = 0; // force timer down
    this._handleRoundEnd(onRoundEnd);
    return this.getState();
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

  /** Transition from roundEnd to idle */
  readyNextRound() {
    if (this.state.status === 'roundEnd') {
      this.state.status = 'idle';
      this.state.breakTimer = 0;
      this._stopTimerInternal(); // Stop the loop to save resources until 'start' is clicked
    }
    return this.getState();
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
      breakTimer: 0,
      roundHistory: []
    };
    this._voteBuffer = [];
    return this.getState();
  }
}

module.exports = GameEngine;
