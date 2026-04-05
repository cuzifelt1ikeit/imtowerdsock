// MARK: - Lane
// Each player gets their own Lane (grid + wave manager + bunkers).

const { Grid, CellType } = require('./Grid');
const { WaveManager } = require('./WaveManager');
const { BunkerManager, getUpgradeCost } = require('./Bunker');

class Lane {
  constructor(playerId, config) {
    this.playerId = playerId;
    this.config = config;
    this.grid = new Grid(config.grid.cols, config.grid.rows);
    this.waveManager = new WaveManager(this.grid, config, this._enemyPool);
    this.bunkerManager = new BunkerManager();
    this.cash = config.player.startCash;
    this.totalEarned = 0;
    this.totalKills = 0;
    this.totalLeaked = 0;
    this.waveKills = 0;
    this.bunkersBuilt = 0;
    this.troopsPurchased = { mg: 0, sg: 0, sn: 0, ft: 0 };
    this.troopsUpgraded = { mg: 0, sg: 0, sn: 0, ft: 0 };
    this.currentBounty = 10;
    this._gridDirty = true; // Only send grid when it changes

    // Enemy object pool — pre-allocate to reduce GC pressure
    // Pool size: max enemies per wave + 10% buffer
    const maxEnemies = Math.max(50, config.enemies.maxSpawn * 2);
    this._enemyPool = [];
    this._spawnEnemies = 0;

    // Pre-allocate enemy objects in pool
    for (let i = 0; i < maxEnemies; i++) {
      const poolIndex = i % maxEnemies;
      const enemy = new Enemy(
        0, // placeholder col
        0, // placeholder row
        1, // dummy hp
        1, // dummy speed
        'grunt', // dummy type
        false // dummy isPathfinder
      );
      enemy._idle = true; // Mark as available for pooling
      this._enemyPool[poolIndex] = enemy;
    }

    // Callbacks set by GameInstance
    this.onEnemyEscaped = null;
  }

  setup() {
    this.waveManager.onEnemyEscaped = (enemy) => {
      this.totalLeaked++;
      if (this.onEnemyEscaped) {
        this.onEnemyEscaped(enemy);
      }
    };

    this.waveManager.onEnemyKilled = (enemy) => {
      this.cash += this.currentBounty;
      this.totalEarned += this.currentBounty;
      this.totalKills++;
      this.waveKills++;
      if (this.totalKills <= 3) {
        console.log(`[lane:${this.playerId}] Kill! +$${this.currentBounty}, cash now: $${this.cash}`);
      }
      // Emit kill event for immediate client cash update
      if (this.onKillEvent) {
        this.onKillEvent(this.currentBounty, this.cash);
      }
    };

    this.waveManager.onWaveStart = (waveNum) => {
      const bCfg = this.config.bounty;
      const budget = bCfg.budgetBase + waveNum * bCfg.budgetPerWave;
      const totalEnemies = this.waveManager.spawnQueue.length + this.waveManager.enemies.filter(e => e.alive).length;
      this.currentBounty = Math.max(1, Math.round(budget / Math.max(1, totalEnemies)));
    };

    this.waveManager.onWaveCleared = () => {};
  }

  // MARK: - Enemy Pool Management

  // Get an enemy from the pool or create a new one
  _getEnemy() {
    // Reuse an idle enemy from pool
    const poolIndex = this._spawnEnemies % this._enemyPool.length;
    const enemy = this._enemyPool[poolIndex];

    if (enemy && enemy._idle) {
      // Reset enemy to idle state
      enemy.alive = true;
      enemy.path = [];
      enemy.pathIndex = 0;
      enemy.dots = [];
      enemy.hitFlash = 0;
      enemy.wanderTimer = 0;
      enemy.stuckTimer = 0;
      enemy._leakKey = null;
      enemy._idle = false;
      return enemy;
    }

    // Pool exhausted or enemy not available — create new enemy
    return new Enemy(
      this.waveManager.spawnQueue[0].col,
      this.waveManager.spawnQueue[0].row,
      this.config.enemies[this.waveManager.spawnQueue[0].type].hp,
      this.config.enemies[this.waveManager.spawnQueue[0].type].speed,
      this.waveManager.spawnQueue[0].type
    );
  }

  // Return an enemy to the pool when it dies
  _returnEnemy(enemy) {
    enemy.alive = false;
    enemy.deathHandled = true;
    this._spawnEnemies++;
    // Mark enemy as idle again
    enemy._idle = true;
  }

  update(dt) {
    this.waveManager.update(dt);
    this.bunkerManager.update(dt, this.waveManager.enemies);
  }

  // Player actions
  placeBunker(col, row) {
    if (this.cash < this.config.player.bunkerCost) return { success: false, reason: 'insufficient_cash' };

    // Check no enemy on cell
    const enemyOnCell = this.waveManager.enemies.some(e =>
      e.alive && Math.round(e.x) === col && Math.round(e.y) === row
    );
    if (enemyOnCell) return { success: false, reason: 'enemy_on_cell' };

    if (!this.grid.tryPlace(col, row)) return { success: false, reason: 'invalid_placement' };

    this._gridDirty = true;
    this.cash -= this.config.player.bunkerCost;
    this.bunkersBuilt++;
    this.bunkerManager.addBunker(col, row);
    this.waveManager.recalculatePaths();

    return { success: true };
  }

  addUnit(col, row, unitType) {
    const bunker = this.bunkerManager.getBunker(col, row);
    if (!bunker) return { success: false, reason: 'no_bunker' };
    if (bunker.units.length >= 4) return { success: false, reason: 'bunker_full' };

    const unitCfg = this.config.units[unitType];
    if (!unitCfg) return { success: false, reason: 'invalid_unit_type' };
    if (this.cash < unitCfg.cost) return { success: false, reason: 'insufficient_cash' };

    this.cash -= unitCfg.cost;
    bunker.addUnit(unitType, this.config);

    const key = { machinegun: 'mg', shotgun: 'sg', sniper: 'sn', flamethrower: 'ft' }[unitType];
    if (key) this.troopsPurchased[key]++;

    return { success: true };
  }

  upgradeUnit(col, row, unitIndex) {
    const bunker = this.bunkerManager.getBunker(col, row);
    if (!bunker) return { success: false, reason: 'no_bunker' };
    if (unitIndex < 0 || unitIndex >= bunker.units.length) return { success: false, reason: 'invalid_unit' };

    const unit = bunker.units[unitIndex];
    const cost = getUpgradeCost(unit.type, unit.tier, this.config);
    if (this.cash < cost) return { success: false, reason: 'insufficient_cash' };

    if (!unit.upgrade(this.config)) return { success: false, reason: 'max_tier' };

    this.cash -= cost;
    const key = { machinegun: 'mg', shotgun: 'sg', sniper: 'sn', flamethrower: 'ft' }[unit.type];
    if (key) this.troopsUpgraded[key]++;

    return { success: true };
  }

  sendEarly() {
    return this.waveManager.sendEarly();
  }

  // Receive a transferred enemy from another lane
  // Returns false if the enemy couldn't be placed (no valid path)
  receiveEnemy(enemyData) {
    return this.waveManager.spawnTransfer(enemyData);
  }

  toState() {
    return {
      playerId: this.playerId,
      cash: this.cash,
      waveNumber: this.waveManager.waveNumber,
      waveActive: this.waveManager.waveActive,
      waveCountdown: Math.round(this.waveManager.timeUntilNextWave * 10) / 10,
      enemiesRemaining: this.waveManager.enemiesRemaining,
      enemies: this.waveManager.enemies.filter(e => e.alive).map(e => e.toState()),
      bunkers: this.bunkerManager.allBunkers.map(b => b.toState()),
      grid: this.grid.cells,
      totalKills: this.totalKills,
      totalLeaked: this.totalLeaked,
    };
  }
}

module.exports = { Lane };
