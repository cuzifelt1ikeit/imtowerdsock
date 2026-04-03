// MARK: - Game Instance
// Manages a full multiplayer co-op game: 2-4 players, each with their own lane.
// Enemies that leak through a lane get randomly routed to another lane.
// Only does damage to shared HP if an enemy survives ALL lanes.

const { Lane } = require('./Lane');

class GameInstance {
  constructor(roomId, config) {
    this.roomId = roomId;
    this.config = config;
    this.lanes = new Map(); // playerId -> Lane
    this.sharedHp = config.player.maxHp;
    this.maxHp = config.player.maxHp;
    this.gameOver = false;
    this.gameStarted = false;
    this.startTime = null;
    this.waveNumber = 0;

    // Track which enemies have visited which lanes (to prevent infinite loops)
    // Key: original enemy signature, Value: Set of playerIds it has visited
    this._leakTracker = new Map();
    this._leakId = 0;

    this._tickInterval = null;
    this._tickRate = 50; // ms (20 ticks/sec)
    this._broadcastCounter = 0;
    this._broadcastEvery = 3; // Send state every 3rd tick (~7fps, reduces bandwidth)

    // Callback for broadcasting state
    this.onStateUpdate = null;
    this.onGameOver = null;
  }

  addPlayer(playerId) {
    if (this.lanes.size >= 4) return false;
    if (this.lanes.has(playerId)) return false;

    const lane = new Lane(playerId, this.config);
    lane.setup();

    // Set up leak handling
    lane.onEnemyEscaped = (enemy) => {
      this._handleLeak(playerId, enemy);
    };

    // Sync wave starts across all lanes
    const originalOnWaveStart = lane.waveManager.onWaveStart;
    lane.waveManager.onWaveStart = (waveNum) => {
      originalOnWaveStart(waveNum);
      if (waveNum > this.waveNumber) {
        this.waveNumber = waveNum;
      }
    };

    this.lanes.set(playerId, lane);
    return true;
  }

  removePlayer(playerId) {
    this.lanes.delete(playerId);
  }

  start() {
    if (this.gameStarted) return;
    this.gameStarted = true;
    this.startTime = Date.now();

    // Auto-start all lanes (begin wave 1)
    for (const lane of this.lanes.values()) {
      lane.waveManager.waitingForPlayer = false;
      lane.waveManager.betweenWaveTimer = 5; // 5 second countdown before wave 1
    }

    // Start the game loop
    this._tickInterval = setInterval(() => {
      this._tick();
    }, this._tickRate);
  }

  stop() {
    if (this._tickInterval) {
      clearInterval(this._tickInterval);
      this._tickInterval = null;
    }
  }

  _tick() {
    if (this.gameOver) return;

    const dt = this._tickRate / 1000; // Convert ms to seconds

    for (const lane of this.lanes.values()) {
      lane.update(dt);
    }

    // Check game over
    if (this.sharedHp <= 0 && !this.gameOver) {
      this.gameOver = true;
      this.stop();
      if (this.onGameOver) {
        this.onGameOver(this.getResults());
      }
    }

    // Broadcast state (throttled)
    this._broadcastCounter++;
    if (this._broadcastCounter >= this._broadcastEvery && this.onStateUpdate) {
      this._broadcastCounter = 0;
      this.onStateUpdate(this.getState());
    }
  }

  _handleLeak(fromPlayerId, enemy) {
    // Create or get leak tracking ID
    const leakKey = enemy._leakKey || `leak_${this._leakId++}`;
    if (!enemy._leakKey) enemy._leakKey = leakKey;

    if (!this._leakTracker.has(leakKey)) {
      this._leakTracker.set(leakKey, new Set());
    }
    const visited = this._leakTracker.get(leakKey);
    visited.add(fromPlayerId);

    // Find lanes this enemy hasn't visited yet (excluding the one it just came from)
    const availableLanes = [];
    for (const [pid] of this.lanes) {
      if (!visited.has(pid)) {
        availableLanes.push(pid);
      }
    }

    if (availableLanes.length > 0) {
      // Random lane assignment
      const targetId = availableLanes[Math.floor(Math.random() * availableLanes.length)];
      const targetLane = this.lanes.get(targetId);

      // Transfer enemy with remaining HP and leak tracking key
      const transferHp = enemy.hp > 0 ? enemy.hp : this.config.enemies[enemy.type].hp;
      targetLane.receiveEnemy({
        type: enemy.type,
        hp: transferHp,
        speed: enemy.speed,
        _leakKey: leakKey,
      });
      console.log(`[leak] ${enemy.type} transferred from ${fromPlayerId} to ${targetId} (hp: ${Math.round(transferHp)}, visited: ${visited.size}/${this.lanes.size})`);
    } else {
      // Enemy survived ALL lanes — deal damage to shared HP
      const leakDamage = this.config.enemies[enemy.type].leakDamage;
      this.sharedHp = Math.max(0, this.sharedHp - leakDamage);
      this._leakTracker.delete(leakKey);
    }
  }

  // Player actions (validated by server)
  handleAction(playerId, action) {
    const lane = this.lanes.get(playerId);
    if (!lane) return { success: false, reason: 'invalid_player' };

    switch (action.type) {
      case 'place_bunker':
        return lane.placeBunker(action.col, action.row);

      case 'add_unit':
        return lane.addUnit(action.col, action.row, action.unitType);

      case 'upgrade_unit':
        return lane.upgradeUnit(action.col, action.row, action.unitIndex);

      case 'send_early': {
        const bonus = lane.sendEarly();
        if (bonus > 0) {
          lane.cash += bonus;
          lane.totalEarned += bonus;
        }
        return { success: true, bonus };
      }

      default:
        return { success: false, reason: 'unknown_action' };
    }
  }

  // Start all lanes' waves simultaneously
  startAllWaves() {
    for (const lane of this.lanes.values()) {
      if (lane.waveManager.waitingForPlayer) {
        lane.waveManager.sendEarly();
      }
    }
  }

  getState() {
    const lanes = {};
    for (const [pid, lane] of this.lanes) {
      lanes[pid] = lane.toState();
    }

    return {
      roomId: this.roomId,
      sharedHp: Math.round(this.sharedHp),
      maxHp: this.maxHp,
      waveNumber: this.waveNumber,
      gameOver: this.gameOver,
      lanes,
    };
  }

  getResults() {
    const players = {};
    for (const [pid, lane] of this.lanes) {
      players[pid] = {
        totalKills: lane.totalKills,
        totalLeaked: lane.totalLeaked,
        totalEarned: lane.totalEarned,
        bunkersBuilt: lane.bunkersBuilt,
        troopsPurchased: lane.troopsPurchased,
        troopsUpgraded: lane.troopsUpgraded,
      };
    }

    return {
      roomId: this.roomId,
      waveReached: this.waveNumber,
      sharedHp: Math.round(this.sharedHp),
      durationSeconds: Math.round((Date.now() - this.startTime) / 1000),
      players,
    };
  }

  get playerCount() {
    return this.lanes.size;
  }
}

module.exports = { GameInstance };
