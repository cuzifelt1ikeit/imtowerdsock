// MARK: - Wave Manager
// Direct port of WaveManager.swift — spawns enemies, manages wave timing.

const { Enemy } = require('./Enemy');

class WaveManager {
  constructor(grid, config, enemyPool = null) {
    this.grid = grid;
    this.config = config;
    this.enemyPool = enemyPool || null; // Optional pool for object pooling
    this.enemies = [];
    this.waveNumber = 0;
    this.waveActive = false;
    this.spawnQueue = [];
    this.spawnTimer = 0;
    this.spawnInterval = config.waves.spawnInterval;
    this.betweenWaveTimer = 0;
    this.betweenWaveDuration = config.waves.betweenDuration;
    this.waveCleared = true;
    this.waitingForPlayer = true;

    this._nextEnemyId = 0;

    // Callbacks
    this.onEnemyEscaped = null;
    this.onEnemyKilled = null;
    this.onWaveStart = null;
    this.onWaveCleared = null;
  }

  reset() {
    this.enemies = [];
    this.waveNumber = 0;
    this.waveActive = false;
    this.spawnQueue = [];
    this.spawnTimer = 0;
    this.spawnInterval = this.config.waves.spawnInterval;
    this.betweenWaveTimer = 0;
    this.waveCleared = true;
    this.waitingForPlayer = true;
    this._nextEnemyId = 0;
  }

  getPathfinderRatio(waveNum) {
    const cfg = this.config.waves;
    return Math.min(cfg.pathfinderCap, cfg.pathfinderBase + (waveNum - 1) * cfg.pathfinderPerWave);
  }

  update(dt) {
    // Between waves countdown
    if (!this.waveActive && this.waveCleared) {
      if (this.waitingForPlayer) return;
      this.betweenWaveTimer -= dt;
      if (this.betweenWaveTimer <= 0) {
        this._startNextWave();
      }
    }

    // Spawn queue
    if (this.spawnQueue.length > 0) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this._spawnEnemy(this.spawnQueue.shift());
        this.spawnTimer = this.spawnInterval;
      }
    }

    // Update enemies (movement only)
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      enemy.update(dt, this.grid);
    }

    // Handle escapes and deaths (separate pass so bunker kills from last frame are caught)
    for (const enemy of this.enemies) {
      if (enemy.deathHandled) continue;
      if (enemy.escaped) {
        enemy.deathHandled = true;
        if (this.onEnemyEscaped) this.onEnemyEscaped(enemy);
      } else if (!enemy.alive) {
        enemy.deathHandled = true;
        // Return enemy to pool if available
        if (this.enemyPool && this.enemyPool._returnEnemy) {
          this.enemyPool._returnEnemy(enemy);
        }
        if (this.onEnemyKilled) this.onEnemyKilled(enemy);
      }
    }

    // Check wave cleared
    if (this.waveActive && this.spawnQueue.length === 0) {
      const alive = this.enemies.some(e => e.alive);
      if (!alive) {
        this.waveActive = false;
        this.waveCleared = true;
        this.betweenWaveTimer = this.betweenWaveDuration;
        // Clean up dead enemies between waves and return them to pool
        for (const enemy of this.enemies) {
          if (!enemy.alive) {
            if (this.enemyPool && this.enemyPool._returnEnemy) {
              this.enemyPool._returnEnemy(enemy);
            }
          }
        }
        this.enemies = [];
        if (this.onWaveCleared) this.onWaveCleared(this.waveNumber);
      }
    }
  }

  sendEarly() {
    if (this.waitingForPlayer) {
      this.waitingForPlayer = false;
      this._startNextWave();
      return 0;
    }

    const timeLeft = this.betweenWaveTimer;
    if (timeLeft <= 0) return 0;

    const bonus = Math.round(timeLeft * this.config.waves.earlyBonusPerSecond);
    this.betweenWaveTimer = 0;
    return bonus;
  }

  _startNextWave() {
    this.waveNumber++;
    this.waveActive = true;
    this.waveCleared = false;
    this.spawnQueue = this._generateWave(this.waveNumber);
    this.spawnTimer = 0;
    console.log(`[wave] Starting wave ${this.waveNumber}: ${this.spawnQueue.length} enemies, ${this.enemies.length} leftover`);
    if (this.onWaveStart) this.onWaveStart(this.waveNumber);
  }

  _generateWave(waveNum) {
    const cfg = this.config.waves;
    const queue = [];
    const pfRatio = this.getPathfinderRatio(waveNum);
    const hpMult = Math.pow(cfg.hpScalePerWave, waveNum);
    const speedMult = waveNum > cfg.speedScaleAfterWave
      ? 1 + (waveNum - cfg.speedScaleAfterWave) * cfg.speedScaleRate
      : 1;

    // Intro waves
    const introKey = String(waveNum);
    if (cfg.introWaves[introKey]) {
      const intro = cfg.introWaves[introKey];
      const enemyCfg = this.config.enemies[intro.type];
      for (let i = 0; i < intro.count; i++) {
        queue.push({
          type: intro.type,
          hp: Math.round(enemyCfg.hp * hpMult),
          speed: enemyCfg.speed * speedMult,
          isPathfinder: Math.random() < pfRatio,
        });
      }
    } else {
      // Scaled waves
      const types = ['grunt', 'runner', 'tank', 'swarm'];
      const count = cfg.scaledWaveBaseCount + waveNum * cfg.scaledWavePerWave;

      if (waveNum % cfg.bossEveryN === 0) {
        const bossCfg = this.config.enemies.boss;
        queue.push({
          type: 'boss',
          hp: Math.round(bossCfg.hp * hpMult * cfg.bossHpMultiplier),
          speed: bossCfg.speed * speedMult,
          isPathfinder: true,
        });
      }

      for (let i = 0; i < count; i++) {
        const t = types[Math.floor(Math.random() * types.length)];
        const enemyCfg = this.config.enemies[t];
        queue.push({
          type: t,
          hp: Math.round(enemyCfg.hp * hpMult),
          speed: enemyCfg.speed * speedMult,
          isPathfinder: Math.random() < pfRatio,
        });
      }
    }

    return queue;
  }

  _spawnEnemy(data) {
    const spawnCol = Math.floor(Math.random() * this.grid.cols);
    const id = this._nextEnemyId++;

    // Use pooled enemy if available, otherwise create new one
    let enemy;
    if (this.enemyPool && this.enemyPool._getEnemy) {
      enemy = this.enemyPool._getEnemy();
    } else {
      enemy = new Enemy(id, spawnCol, 0, data.hp, data.speed, data.type, data.isPathfinder, this.config);
    }

    if (data.isPathfinder) {
      let path = this.grid.findPath(spawnCol, 0, null);
      if (!path) {
        // Try other columns
        for (let c = 0; c < this.grid.cols; c++) {
          path = this.grid.findPath(c, 0, null);
          if (path) break;
        }
      }
      if (path) {
        enemy.setPath(path);
        this.enemies.push(enemy);
        // No valid path at all — skip this enemy
        console.log(`[wave] No path found for enemy at col ${spawnCol}`);
      }
    } else {
      enemy.x = spawnCol;
      enemy.y = 0;
      const candidates = [
        { col: spawnCol, row: 1 },
        { col: spawnCol - 1, row: 0 },
        { col: spawnCol + 1, row: 0 },
      ];
      let firstStep = null;
      for (const c of candidates) {
        const cell = this.grid.getCell(c.col, c.row);
        if (cell !== null && cell !== 1) { // not BUNKER
          firstStep = c;
          break;
        }
      }
      if (firstStep) {
        enemy.path = [{ col: spawnCol, row: 0 }, firstStep];
        enemy.pathIndex = 0;
        this.enemies.push(enemy);
      } else {
        const path = this.grid.findPath(spawnCol, 0, null);
        if (path) {
          enemy.setPath(path);
          this.enemies.push(enemy);
        }
      }
    }
  }

  // Spawn a transferred enemy from another lane
  spawnTransfer(enemyData) {
    const id = this._nextEnemyId++;

    // Find an open spawn column (top row, no bunker)
    // Try random first, then sweep all columns
    let spawnCol = Math.floor(Math.random() * this.grid.cols);
    let path = this.grid.findPath(spawnCol, 0, null);
    if (!path) {
      for (let c = 0; c < this.grid.cols; c++) {
        path = this.grid.findPath(c, 0, null);
        if (path) { spawnCol = c; break; }
      }
    }
    if (!path || path.length < 2) return false; // No valid path at all

    // Use pooled enemy if available
    let enemy;
    if (this.enemyPool && this.enemyPool._getEnemy) {
      enemy = this.enemyPool._getEnemy();
    } else {
      const enemyCfg = this.config.enemies[enemyData.type];
      enemy = new Enemy(id, spawnCol, 0, enemyData.hp, enemyData.speed, enemyData.type, true, this.config);
    }

    if (enemyData._leakKey) {
      enemy._leakKey = enemyData._leakKey;
    }

    // Always use pathfinder movement with a fresh full path
    enemy.path = path;
    enemy.pathIndex = 0;
    enemy.x = path[0].col;
    enemy.y = path[0].row;
    enemy.col = path[0].col;
    enemy.row = path[0].row;
    enemy.heading = Math.PI / 2; // Face down
    enemy.stuckTimer = 0;
    enemy.lastX = enemy.x;
    enemy.lastY = enemy.y;

    this.enemies.push(enemy);
    return true;
  }

  recalculatePaths() {
    for (const enemy of this.enemies) {
      if (!enemy.alive || !enemy.isPathfinder) continue;
      const currentCol = Math.round(enemy.x);
      const currentRow = Math.round(enemy.y);
      let path = this.grid.findPath(currentCol, currentRow, null);
      // If no path from current cell (might be on a bunker), try nearby cells
      if (!path) {
        for (const [dc, dr] of [[0,1],[1,0],[-1,0],[0,-1],[1,1],[-1,1]]) {
          const nc = currentCol + dc;
          const nr = currentRow + dr;
          if (nc >= 0 && nc < this.grid.cols && nr >= 0 && nr < this.grid.rows) {
            path = this.grid.findPath(nc, nr, null);
            if (path) {
              enemy.x = nc;
              enemy.y = nr;
              break;
            }
          }
        }
      }
      if (path && path.length >= 2) {
        enemy.path = path;
        enemy.pathIndex = 0;
      }
    }
  }

  get timeUntilNextWave() {
    return this.waveActive ? 0 : Math.max(0, this.betweenWaveTimer);
  }

  get enemiesRemaining() {
    return this.enemies.filter(e => e.alive).length + this.spawnQueue.length;
  }
}

module.exports = { WaveManager };
