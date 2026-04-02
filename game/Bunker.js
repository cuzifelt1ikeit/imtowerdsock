// MARK: - Unit & Bunker
// Direct port of Unit.swift + Bunker.swift — units attack enemies from bunkers.

class Unit {
  constructor(type, config) {
    this.type = type;
    const def = config.units[type];
    this.baseDamage = def.damage;
    this.baseFireRate = def.fireRate;
    this.baseRange = def.range;
    this.damage = def.damage;
    this.fireRate = def.fireRate;
    this.range = def.range;
    this.tier = 1;
    this.fireCooldown = 0;
    this.splash = def.splash;
    this.splashRadius = def.splashRadius;
    this.dot = def.dot;
    this.dotDamage = def.dotDamage;
    this.dotDuration = def.dotDuration;
  }

  upgrade(config) {
    const cfg = config.upgrades;
    if (this.tier >= cfg.maxTier) return false;
    this.tier++;
    const ti = this.tier - 1;
    this.damage = Math.round(this.baseDamage * cfg.damageScale[ti]);
    this.fireRate = Math.round(this.baseFireRate * cfg.fireRateScale[ti] * 100) / 100;
    this.range = Math.round(this.baseRange * cfg.rangeScale[ti] * 10) / 10;
    return true;
  }

  get canUpgrade() {
    // Accessed via config at check time
    return this.tier < 5; // Will be overridden by GameInstance
  }

  update(dt) {
    if (this.fireCooldown > 0) this.fireCooldown -= dt;
  }

  get canFire() {
    return this.fireCooldown <= 0;
  }

  fire() {
    this.fireCooldown = 1 / this.fireRate;
  }
}

class Bunker {
  constructor(col, row) {
    this.col = col;
    this.row = row;
    this.units = [];
  }

  addUnit(type, config) {
    if (this.units.length >= 4) return null;
    const unit = new Unit(type, config);
    this.units.push(unit);
    return unit;
  }

  get maxRange() {
    if (this.units.length === 0) return 0;
    return Math.max(...this.units.map(u => u.range));
  }

  update(dt, enemies) {
    for (const unit of this.units) {
      unit.update(dt);
      if (!unit.canFire) continue;

      // Find target in range
      let target = null;
      let bestDist = Infinity;
      for (const enemy of enemies) {
        if (!enemy.alive) continue;
        const dx = enemy.x - this.col;
        const dy = enemy.y - this.row;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= unit.range && dist < bestDist) {
          bestDist = dist;
          target = enemy;
        }
      }

      if (target) {
        unit.fire();

        if (unit.splash && unit.splashRadius > 0) {
          // Splash damage to all enemies near target
          for (const e of enemies) {
            if (!e.alive) continue;
            const sdx = e.x - target.x;
            const sdy = e.y - target.y;
            const sdist = Math.sqrt(sdx * sdx + sdy * sdy);
            if (sdist <= unit.splashRadius) {
              e.takeDamage(unit.damage);
            }
          }
        } else {
          target.takeDamage(unit.damage);
        }

        if (unit.dot && unit.dotDamage > 0) {
          target.applyDot(unit.dotDamage, unit.dotDuration);
        }
      }
    }
  }

  toState() {
    return {
      col: this.col,
      row: this.row,
      units: this.units.map(u => ({
        type: u.type,
        tier: u.tier,
        damage: u.damage,
        fireRate: u.fireRate,
        range: u.range,
      })),
    };
  }
}

class BunkerManager {
  constructor() {
    this.bunkers = new Map();
  }

  addBunker(col, row) {
    const key = `${col},${row}`;
    if (this.bunkers.has(key)) return this.bunkers.get(key);
    const bunker = new Bunker(col, row);
    this.bunkers.set(key, bunker);
    return bunker;
  }

  getBunker(col, row) {
    return this.bunkers.get(`${col},${row}`) || null;
  }

  update(dt, enemies) {
    for (const bunker of this.bunkers.values()) {
      bunker.update(dt, enemies);
    }
  }

  reset() {
    this.bunkers.clear();
  }

  get allBunkers() {
    return Array.from(this.bunkers.values());
  }
}

function getUpgradeCost(type, currentTier, config) {
  const cfg = config.upgrades;
  if (currentTier >= cfg.maxTier) return Infinity;
  const baseCost = config.units[type].cost;
  return Math.round(baseCost * cfg.costMultipliers[currentTier]);
}

module.exports = { Unit, Bunker, BunkerManager, getUpgradeCost };
