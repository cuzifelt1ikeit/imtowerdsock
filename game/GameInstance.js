// MARK: - Game Instance
// Manages a full multiplayer co-op game: 2-4 players, each with their own lane.
// Enemies that leak through a lane get randomly routed to another lane.
// Only does damage to shared HP if an enemy survives ALL lanes.

const { Lane } = require('./Lane');

class GameInstance {
  constructor(roomId, config) {
    this.roomId = roomId;
    // MP config overrides
    this.config = {
      ...config,
      player: {
        ...config.player,
        startCash: 1300, // More cash to build before harder waves
      },
      _mpStartWave: 5, // Waves 1-5 are skipped, start generating at wave 6 difficulty
    };
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
    this._tickRate = 16; // ms (~60 ticks/sec)
    this._broadcastCounter = 0;
    this._broadcastEvery = 6; // Send state every 6 ticks (~10fps, interpolated on client)

    // Stalled enemy scanner
    this._stalledScanTimer = 0;
    this._stalledScanInterval = 4; // seconds
    this._lastEnemyPositions = new Map(); // enemyId -> { x, y, laneId }

    // Synchronized wave management
    this._allLanesCleared = false;
    this._betweenWaveTimer = 0;
    this._waveQueued = false; // Flag: start wave on next tick

    // Callback for broadcasting state
    this.onStateUpdate = null;   // Full state (throttled ~10fps)
    this.onLaneEvent = null;     // Discrete lane events (immediate)
    this.onGameOver = null;
  }

  addPlayer(playerId) {
    if (this.lanes.size >= 4) return false;
    if (this.lanes.has(playerId)) return false;

    const lane = new Lane(playerId, this.config);

    // Set callbacks BEFORE setup() so they're available when wiring wave handlers
    lane.onEnemyEscaped = (enemy) => {
      this._handleLeak(playerId, enemy);
    };

    lane.onKillEvent = (bounty, newCash) => {
      if (this.onLaneEvent) {
        this.onLaneEvent(playerId, 'enemy_killed', { bounty, cash: newCash });
      }
    };

    lane.setup();

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

    // Disable individual lane wave progression — GameInstance controls it
    for (const lane of this.lanes.values()) {
      lane.waveManager.waitingForPlayer = true;
    }
    // Wait for players to manually start (via send_early / start button)
    this._betweenWaveTimer = 0;
    this._allLanesCleared = true;
    this._waitingForFirstWave = true;

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

    // Synchronized wave management
    if (this._waveQueued) {
      this._waveQueued = false;
      this._startNextWaveAllLanes();
    } else if (this._betweenWaveTimer > 0) {
      this._betweenWaveTimer -= dt;
      if (this._betweenWaveTimer <= 0) {
        this._betweenWaveTimer = 0;
        this._startNextWaveAllLanes();
      }
    } else if (this.waveNumber > 0) {
      // Check if ALL lanes have cleared their wave
      const allCleared = Array.from(this.lanes.values()).every(lane => {
        const wm = lane.waveManager;
        return wm.spawnQueue.length === 0 && !wm.enemies.some(e => e.alive);
      });

      if (allCleared && !this._allLanesCleared) {
        this._allLanesCleared = true;
        this._betweenWaveTimer = this.config.waves.betweenDuration;
        for (const lane of this.lanes.values()) {
          lane.waveManager.enemies = [];
          lane.waveManager.waveActive = false;
          lane.waveManager.waveCleared = true;
        }
        console.log(`[wave] All lanes cleared wave ${this.waveNumber}, next in ${this.config.waves.betweenDuration}s`);
      }
    }

    for (const lane of this.lanes.values()) {
      lane.update(dt);
    }

    // Stalled enemy scanner — every 4s, check if any enemy hasn't moved
    this._stalledScanTimer += dt;
    if (this._stalledScanTimer >= this._stalledScanInterval) {
      this._stalledScanTimer = 0;
      this._scanForStalledEnemies();
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

  _scanForStalledEnemies() {
    const currentPositions = new Map();

    for (const [pid, lane] of this.lanes) {
      for (const enemy of lane.waveManager.enemies) {
        if (!enemy.alive) continue;
        const key = `${pid}_${enemy.id}`;
        const cx = Math.round(enemy.x * 100) / 100;
        const cy = Math.round(enemy.y * 100) / 100;
        currentPositions.set(key, { x: cx, y: cy, pid });

        const prev = this._lastEnemyPositions.get(key);
        if (prev && Math.abs(prev.x - cx) < 0.1 && Math.abs(prev.y - cy) < 0.1) {
          // Enemy hasn't moved since last scan — respawn at top of its lane
          const grid = lane.waveManager.grid;
          let respawned = false;
          for (let c = 0; c < grid.cols; c++) {
            const path = grid.findPath(c, 0, null);
            if (path && path.length >= 2) {
              enemy.path = path;
              enemy.pathIndex = 0;
              enemy.x = path[0].col;
              enemy.y = path[0].row;
              enemy.col = path[0].col;
              enemy.row = path[0].row;
              enemy.heading = Math.PI / 2;
              enemy.stuckTimer = 0;
              enemy.lastX = enemy.x;
              enemy.lastY = enemy.y;
              respawned = true;
              console.log(`[stalled] Respawned ${enemy.type} (id:${enemy.id}) to top of lane ${pid} at col ${c}`);
              break;
            }
          }
          if (!respawned) {
            console.log(`[stalled] No path for ${enemy.type} (id:${enemy.id}) in lane ${pid} — killing`);
            enemy.alive = false;
            enemy.deathHandled = true;
          }
        }
      }
    }

    this._lastEnemyPositions = currentPositions;
  }

  _startNextWaveAllLanes() {
    this.waveNumber++;
    this._allLanesCleared = false;

    // In MP, wave difficulty is offset (wave 1 plays like wave 6 in SP)
    const difficultyWave = this.waveNumber + (this.config._mpStartWave || 0);

    for (const lane of this.lanes.values()) {
      const wm = lane.waveManager;
      wm.waveNumber = this.waveNumber;
      wm.waveActive = true;
      wm.waveCleared = false;
      // Generate wave using offset difficulty
      wm.spawnQueue = wm._generateWave(difficultyWave);
      wm.spawnTimer = 0;

      // Recalculate bounty using difficulty wave
      const bCfg = this.config.bounty;
      const budget = bCfg.budgetBase + difficultyWave * bCfg.budgetPerWave;
      const totalEnemies = wm.spawnQueue.length;
      lane.currentBounty = Math.max(1, Math.round(budget / Math.max(1, totalEnemies)));
    }

    console.log(`[wave] Starting wave ${this.waveNumber} (difficulty ${difficultyWave}) on all lanes`);
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
      case 'place_bunker': {
        const result = lane.placeBunker(action.col, action.row);
        if (result.success && this.onLaneEvent) {
          this.onLaneEvent(playerId, 'bunker_placed', {
            col: action.col, row: action.row, cash: lane.cash,
            grid: lane.grid.cells,
          });
        }
        return result;
      }

      case 'add_unit': {
        const result = lane.addUnit(action.col, action.row, action.unitType);
        if (result.success && this.onLaneEvent) {
          const bunker = lane.bunkerManager.getBunker(action.col, action.row);
          this.onLaneEvent(playerId, 'unit_added', {
            col: action.col, row: action.row, cash: lane.cash,
            bunker: bunker ? bunker.toState() : null,
          });
        }
        return result;
      }

      case 'upgrade_unit': {
        const result = lane.upgradeUnit(action.col, action.row, action.unitIndex);
        if (result.success && this.onLaneEvent) {
          const bunker = lane.bunkerManager.getBunker(action.col, action.row);
          this.onLaneEvent(playerId, 'unit_upgraded', {
            col: action.col, row: action.row, unitIndex: action.unitIndex,
            cash: lane.cash,
            bunker: bunker ? bunker.toState() : null,
          });
        }
        return result;
      }

      case 'send_early': {
        // First wave — any player can start the game
        if (this._waitingForFirstWave) {
          this._waitingForFirstWave = false;
          this._waveQueued = true;
          console.log(`[wave] Game started by player ${playerId}`);
          return { success: true, bonus: 0 };
        }
        // Between waves — skip countdown, bonus to ALL + $25 extra to the grabber
        if (this._betweenWaveTimer > 0) {
          const bonus = Math.round(this._betweenWaveTimer * this.config.waves.earlyBonusPerSecond);
          const grabberBonus = 25;
          this._betweenWaveTimer = 0;
          this._waveQueued = true;
          if (bonus > 0) {
            for (const l of this.lanes.values()) {
              l.cash += bonus;
              l.totalEarned += bonus;
            }
          }
          // Extra $25 to whoever grabbed it
          lane.cash += grabberBonus;
          lane.totalEarned += grabberBonus;

          // Announce in chat
          const playerInfo = this._getPlayerUsername(playerId);
          this._announceChat(`${playerInfo} grabbed the loot! +$${grabberBonus} bonus`);

          console.log(`[wave] Send early by ${playerInfo}, bonus $${bonus} to all, +$${grabberBonus} to grabber`);
          return { success: true, bonus: bonus + grabberBonus };
        }
        return { success: true, bonus: 0 };
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
      waveCountdown: Math.max(0, Math.round(this._betweenWaveTimer * 10) / 10),
      allLanesActive: !this._allLanesCleared,
      waitingForStart: this._waitingForFirstWave || false,
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

  _getPlayerUsername(playerId) {
    // Look up username from the room (set by server.js when game starts)
    return this._playerNames?.[playerId] || `Player ${playerId}`;
  }

  _announceChat(message) {
    // Will be overridden by server.js to broadcast chat
    if (this.onChatAnnounce) {
      this.onChatAnnounce(message);
    }
  }

  get playerCount() {
    return this.lanes.size;
  }
}

module.exports = { GameInstance };
