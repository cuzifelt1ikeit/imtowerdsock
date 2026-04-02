// MARK: - Cell Types
const CellType = {
  EMPTY: 0,
  BUNKER: 1,
  SPAWN: 2,
  EXIT: 3,
};

// MARK: - Grid
// Direct port of Grid.swift — 2D grid with A* pathfinding.
class Grid {
  constructor(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    this.cells = [];
    this._initCells();
  }

  _initCells() {
    this.cells = [];
    for (let r = 0; r < this.rows; r++) {
      const row = [];
      for (let c = 0; c < this.cols; c++) {
        if (r === 0) row.push(CellType.SPAWN);
        else if (r === this.rows - 1) row.push(CellType.EXIT);
        else row.push(CellType.EMPTY);
      }
      this.cells.push(row);
    }
  }

  reset() {
    this._initCells();
  }

  getCell(col, row) {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return null;
    return this.cells[row][col];
  }

  setCell(col, row, value) {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return false;
    this.cells[row][col] = value;
    return true;
  }

  canPlace(col, row) {
    return this.getCell(col, row) === CellType.EMPTY;
  }

  // Try to place a bunker. Reverts if it would block all paths.
  tryPlace(col, row) {
    if (!this.canPlace(col, row)) return false;
    this.cells[row][col] = CellType.BUNKER;
    if (!this.hasValidPath()) {
      this.cells[row][col] = CellType.EMPTY;
      return false;
    }
    return true;
  }

  hasValidPath() {
    for (let c = 0; c < this.cols; c++) {
      if (this.findPath(c, 0, null)) return true;
    }
    return false;
  }

  // A* Pathfinding
  findPath(startCol, startRow, targetExitCol) {
    const exitRow = this.rows - 1;

    const heuristic = (col, row) => {
      if (targetExitCol !== null && targetExitCol !== undefined) {
        return Math.abs(col - targetExitCol) + Math.abs(row - exitRow);
      }
      return Math.abs(row - exitRow);
    };

    const key = (col, row) => `${col},${row}`;
    const openSet = [];
    const closedSet = new Set();
    const cameFrom = new Map();
    const gScore = new Map();

    const startKey = key(startCol, startRow);
    gScore.set(startKey, 0);
    openSet.push({ col: startCol, row: startRow, g: 0, f: heuristic(startCol, startRow) });

    while (openSet.length > 0) {
      openSet.sort((a, b) => a.f - b.f);
      const current = openSet.shift();
      const currentKey = key(current.col, current.row);

      if (current.row === exitRow) {
        // Reconstruct path
        const path = [];
        let pos = currentKey;
        while (pos) {
          const [c, r] = pos.split(',').map(Number);
          path.unshift({ col: c, row: r });
          pos = cameFrom.get(pos) || null;
        }
        return path;
      }

      closedSet.add(currentKey);

      const neighbors = [
        { col: current.col, row: current.row - 1 },
        { col: current.col, row: current.row + 1 },
        { col: current.col - 1, row: current.row },
        { col: current.col + 1, row: current.row },
      ];

      for (const n of neighbors) {
        const nKey = key(n.col, n.row);
        if (closedSet.has(nKey)) continue;
        const cell = this.getCell(n.col, n.row);
        if (cell === null || cell === CellType.BUNKER) continue;

        const tentativeG = (gScore.get(currentKey) ?? Infinity) + 1;
        if (tentativeG < (gScore.get(nKey) ?? Infinity)) {
          gScore.set(nKey, tentativeG);
          cameFrom.set(nKey, currentKey);
          const f = tentativeG + heuristic(n.col, n.row);

          const idx = openSet.findIndex(o => o.col === n.col && o.row === n.row);
          if (idx >= 0) {
            openSet[idx] = { col: n.col, row: n.row, g: tentativeG, f };
          } else {
            openSet.push({ col: n.col, row: n.row, g: tentativeG, f });
          }
        }
      }
    }

    return null;
  }

  getCurrentPath() {
    const centerCol = Math.floor(this.cols / 2);
    return this.findPath(centerCol, 0, centerCol);
  }
}

module.exports = { Grid, CellType };
