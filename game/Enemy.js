// MARK: - Enemy
// Direct port of Enemy.swift — movement, pathfinding, wandering, damage, DOTs.

class Enemy {
  constructor(id, col, row, hp, speed, type, isPathfinder, config) {
    this.id = id;
    this.col = col;
    this.row = row;
    this.x = col;
    this.y = row;
    this.hp = hp;
    this.maxHp = hp;
    this.speed = speed;
    this.type = type;
    this.isPathfinder = isPathfinder;
    this.alive = true;
    this.escaped = false;
    this.deathHandled = false;

    this.path = [];
    this.pathIndex = 0;

    this.dots = [];
    this.hitFlash = 0;
    this.heading = Math.PI / 2; // default pointing down
    this.stuckTimer = 0;
    this.lastX = -999;
    this.lastY = -999;

    // Wanderer state
    const wCfg = config.wanderer;
    this.wanderBias = wCfg.bias;
    this.wanderInterval = wCfg.interval;
    this.wanderTimer = 0;
    this.lastDir = null;
  }

  setPath(path) {
    this.path = path;
    this.pathIndex = 0;
    if (path.length > 0) {
      this.x = path[0].col;
      this.y = path[0].row;
    }
  }

  update(dt, grid) {
    this._grid = grid; // Store for stuck recovery
    if (this.hitFlash > 0) this.hitFlash -= dt;
    if (this.dots.length > 0) this._updateDots(dt);
    if (!this.alive) return;

    if (this.isPathfinder) {
      this._updatePathfinder(dt);
    } else {
      this._updateWanderer(dt, grid);
    }
  }

  // Pathfinder movement
  _updatePathfinder(dt) {
    if (this.path.length === 0 || this.pathIndex >= this.path.length - 1) {
      if (this.alive && this.path.length > 0 && this.pathIndex >= this.path.length - 1) {
        this.escaped = true;
        this.alive = false;
      }
      return;
    }

    // Stuck detection — if position hasn't changed, recalculate path
    const moved = Math.abs(this.x - this.lastX) > 0.05 || Math.abs(this.y - this.lastY) > 0.05;
    if (!moved) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 0.5 && this._grid) {
        // Full path recalculation from current position
        const curCol = Math.round(this.x);
        const curRow = Math.round(this.y);
        const newPath = this._grid.findPath(curCol, curRow, null);
        if (newPath && newPath.length >= 2) {
          this.path = newPath;
          this.pathIndex = 0;
          this.x = newPath[0].col;
          this.y = newPath[0].row;
          this.col = newPath[0].col;
          this.row = newPath[0].row;
        } else {
          // No path from current position — respawn at top row with a fresh path
          for (let c = 0; c < this._grid.cols; c++) {
            const topPath = this._grid.findPath(c, 0, null);
            if (topPath && topPath.length >= 2) {
              this.path = topPath;
              this.pathIndex = 0;
              this.x = topPath[0].col;
              this.y = topPath[0].row;
              this.col = topPath[0].col;
              this.row = topPath[0].row;
              this.heading = Math.PI / 2;
              break;
            }
          }
        }
        this.stuckTimer = 0;
        this.lastX = this.x;
        this.lastY = this.y;
        return;
      }
    } else {
      this.stuckTimer = 0;
      this.lastX = this.x;
      this.lastY = this.y;
    }

    const target = this.path[this.pathIndex + 1];
    const dx = target.col - this.x;
    const dy = target.row - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 0.3) {
      this.x = target.col;
      this.y = target.row;
      this.col = target.col;
      this.row = target.row;
      this.pathIndex++;
    } else {
      const targetHeading = Math.atan2(dy, dx);
      this.heading = this._lerpAngle(this.heading, targetHeading, 0.25);

      const move = this.speed * dt;
      this.x += (dx / dist) * move;
      this.y += (dy / dist) * move;
      this.col = Math.round(this.x);
      this.row = Math.round(this.y);
    }
  }

  // Wanderer movement
  _updateWanderer(dt, grid) {
    const exitRow = grid.rows - 1;

    if (Math.round(this.y) >= exitRow) {
      this.escaped = true;
      this.alive = false;
      return;
    }

    // If still moving toward a waypoint, keep going
    if (this.path.length > 0 && this.pathIndex < this.path.length - 1) {
      this._updatePathfinder(dt);
      return;
    }

    this.wanderTimer -= dt;
    if (this.wanderTimer > 0) return;
    this.wanderTimer = this.wanderInterval + Math.random() * 0.03;

    const curCol = Math.round(this.x);
    const curRow = Math.round(this.y);

    const moves = [
      { col: curCol, row: curRow + 1 },
      { col: curCol - 1, row: curRow },
      { col: curCol + 1, row: curRow },
      { col: curCol, row: curRow - 1 },
    ];

    const validMoves = moves.filter(m => {
      if (m.col < 0 || m.col >= grid.cols || m.row < 0 || m.row >= grid.rows) return false;
      if (grid.getCell(m.col, m.row) === 1) return false; // BUNKER
      if (this.lastDir && m.col === this.lastDir.col && m.row === this.lastDir.row) return false;
      return true;
    });

    if (validMoves.length === 0) {
      const any = moves.filter(m => {
        if (m.col < 0 || m.col >= grid.cols || m.row < 0 || m.row >= grid.rows) return false;
        return grid.getCell(m.col, m.row) !== 1;
      });
      if (any.length > 0) {
        const pick = any[Math.floor(Math.random() * any.length)];
        this._setWanderTarget(pick, { col: curCol, row: curRow });
      }
      return;
    }

    // Weighted selection using config values
    const weighted = [];
    for (const m of validMoves) {
      let weight;
      if (m.row > curRow) weight = this._wanderWeightDown;
      else if (m.row === curRow) weight = this._wanderWeightSide;
      else weight = this._wanderWeightUp;
      for (let i = 0; i < weight; i++) weighted.push(m);
    }

    if (weighted.length > 0) {
      const pick = weighted[Math.floor(Math.random() * weighted.length)];
      this._setWanderTarget(pick, { col: curCol, row: curRow });
    }
  }

  _setWanderTarget(target, from) {
    this.lastDir = from;
    this.path = [from, target];
    this.pathIndex = 0;
    // Don't snap position — use current position to avoid oscillation
    // Only snap if we're far from the "from" cell (shouldn't happen)
    const dx = Math.abs(this.x - from.col);
    const dy = Math.abs(this.y - from.row);
    if (dx > 0.5 || dy > 0.5) {
      this.x = from.col;
      this.y = from.row;
    }
  }

  // Damage
  takeDamage(amount) {
    this.hp -= amount;
    this.hitFlash = 0.1;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
    }
  }

  applyDot(dps, duration) {
    this.dots.push({ dps, remaining: duration });
  }

  _updateDots(dt) {
    for (let i = this.dots.length - 1; i >= 0; i--) {
      this.hp -= this.dots[i].dps * dt;
      this.dots[i].remaining -= dt;
      if (this.dots[i].remaining <= 0) this.dots.splice(i, 1);
    }
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
    }
  }

  _lerpAngle(from, to, t) {
    let diff = to - from;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    return from + diff * t;
  }

  // Serializable state for sending to clients
  toState() {
    return {
      id: this.id,
      x: Math.round(this.x * 100) / 100,
      y: Math.round(this.y * 100) / 100,
      hp: Math.round(this.hp),
      maxHp: this.maxHp,
      type: this.type,
      alive: this.alive,
      heading: Math.round(this.heading * 100) / 100,
      hasDots: this.dots.length > 0,
    };
  }
}

// Store wanderer weights on prototype from config (set once at module load)
Enemy.setWandererWeights = function (config) {
  Enemy.prototype._wanderWeightDown = config.wanderer.weightDown;
  Enemy.prototype._wanderWeightSide = config.wanderer.weightSide;
  Enemy.prototype._wanderWeightUp = config.wanderer.weightUp;
};

module.exports = { Enemy };
