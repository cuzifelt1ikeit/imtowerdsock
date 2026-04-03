// MARK: - Wave Manager
// Direct port of WaveManager.swift — spawns enemies, manages wave timing.

const { Enemy } = require('./Enemy');

class WaveManager {
  constructor(grid, config) {
    this.grid = grid;
    this.config = config;
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

    // Update enemies
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      enemy.update(dt, this.grid);

      if (enemy.escaped && !enemy.deathHandled) {
        enemy.deathHandled = true;
        if (this.onEnemyEscaped) this.onEnemyEscaped(enemy);
      } else if (!enemy.alive && !enemy.escaped && !enemy.deathHandled) {
        enemy.deathHandled = true;
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
        // Clean up dead enemies between waves
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
    const enemy = new Enemy(id, spawnCol, 0, data.hp, data.speed, data.type, data.isPathfinder, this.config);

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
    const spawnCol = Math.floor(Math.random() * this.grid.cols);
    const id = this._nextEnemyId++;
    const enemy = new Enemy(id, spawnCol, 0, enemyData.hp, enemyData.speed, enemyData.type, true, this.config);
    // Preserve leak tracking key so the system knows which lanes this enemy has visited
    if (enemyData._leakKey) {
      enemy._leakKey = enemyData._leakKey;
    }
    const path = this.grid.findPath(spawnCol, 0, null);
    if (path) {
      enemy.setPath(path);
      this.enemies.push(enemy);
    }
  }

  recalculatePaths() {
    for (const enemy of this.enemies) {
      if (!enemy.alive || !enemy.isPathfinder) continue;
      const currentCol = Math.round(enemy.x);
      const currentRow = Math.round(enemy.y);
      const path = this.grid.findPath(currentCol, currentRow, null);
      if (path) {
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
