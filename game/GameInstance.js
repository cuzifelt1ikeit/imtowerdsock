// MARK: - Game Instance
// Manages a full multiplayer co-op game: 2-4 players, each with their own lane.
// Enemies that leak through a lane get randomly routed to another lane.
// Only does damage to shared HP if an enemy survives ALL lanes.

function _pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

const MOST_KILLS_LINES = [
  "{name} just went absolutely feral — {kills} kills!",
  "{name} is HIM. {kills} kills, no debate.",
  "{name} woke up and chose violence. {kills} kills.",
  "I'm literally shaking. {name} with {kills} kills.",
  "{name} is carrying so hard my back hurts. {kills} kills!",
  "Someone check on {name}, they just dropped {kills} kills like it was nothing.",
  "{name} with {kills} kills. I'm not worthy.",
  "Can we talk about {name}?? {kills} kills. GOAT behavior.",
  "{name} said 'I got this' and meant it. {kills} kills.",
  "{name} is cooking. {kills} kills served hot.",
  "The enemies saw {name} and chose death. {kills} kills.",
  "{name} really said 'watch this' — {kills} kills.",
  "{name} ate that wave up. {kills} kills, zero crumbs.",
  "POV: you're an enemy and {name} is in your lane. {kills} kills.",
  "{name} is on a different planet right now. {kills} kills.",
  "Actual legend. {name} with {kills} kills.",
  "{name} just did {kills} kills like it was a Tuesday.",
  "I need {name}'s gaming chair. {kills} kills.",
  "{name} is playing a different game than the rest of us. {kills} kills.",
  "That wave belonged to {name}. {kills} kills of pure dominance.",
  "{name} walked in and collected {kills} kills. Casual.",
  "Scientists are studying {name}'s {kills}-kill wave as we speak.",
  "{name} didn't even break a sweat. {kills} kills.",
  "Build a statue for {name}. {kills} kills this wave.",
  "{name} with the {kills} piece. Absolutely disgusting.",
  "Rename the game after {name}. {kills} kills.",
  "{name} turned that wave into a highlight reel. {kills} kills.",
  "Everyone else: playing. {name}: dominating. {kills} kills.",
  "{name} just made {kills} kills look easy and I'm offended.",
  "The wave never stood a chance. {name}, {kills} kills.",
  "{name} out here farming kills like crops. {kills} this wave.",
  "I'd let {name} defend my lane any day. {kills} kills!",
  "{name} is built different. {kills} kills, effortlessly.",
  "Breaking news: {name} annihilates wave with {kills} kills.",
  "{name} putting the team on their back. {kills} kills.",
  "GG EZ for {name}. {kills} kills without trying.",
  "{name} chose violence and violence chose them back. {kills} kills.",
  "Petition to rename MVP to {name}VP. {kills} kills.",
  "The enemies filed a complaint about {name}. {kills} kills.",
  "{name} is speedrunning this game. {kills} kills.",
  "{kills} kills?! {name} is a menace to society.",
  "{name} just went full send. {kills} kills.",
  "If kills were currency, {name} would be rich. {kills} this wave.",
  "{name} really said 'they shall not pass.' {kills} kills.",
  "Mom come pick me up, {name} is scary. {kills} kills.",
  "Is {name} even human? {kills} kills says no.",
  "{name} devoured that wave. {kills} kills, gone.",
  "They're not ready for this conversation: {name}, {kills} kills.",
  "{name} just speed-deleted {kills} enemies. Wow.",
  "All hail {name}, destroyer of waves. {kills} kills.",
  "{name} collected {kills} kills like Pokemon cards.",
  "We don't deserve {name}. {kills} kills this wave.",
  "{name} with {kills} kills. Touch grass? Never heard of it.",
  "That wave was {name}'s personal playground. {kills} kills.",
  "{name} went nuclear. {kills} kills, mushroom cloud included.",
  "The scoreboard belongs to {name} today. {kills} kills.",
  "{kills} kills for {name}. The enemies are requesting a trade.",
  "{name} woke up dangerous. {kills} kills.",
  "{name} just turned that wave into confetti. {kills} kills.",
  "Alert: {name} is unstoppable. {kills} kills confirmed.",
  "{name} treated that wave like a buffet. {kills} kills consumed.",
  "Give {name} a trophy. {kills} kills, no contest.",
  "{name} with casual {kills} kills. Just another day at the office.",
  "Somebody nerf {name}. {kills} kills is unfair.",
  "I think {name} might be cheating. {kills} kills. (Just kidding... maybe.)",
  "{name}'s lane is a graveyard. {kills} kills.",
  "Standing ovation for {name}. {kills} kills.",
  "{name} rolled a nat 20. {kills} kills.",
  "That was art. {name}, {kills} kills, masterpiece.",
  "{name} with {kills} kills. Poetry in motion.",
  "I've seen greatness and its name is {name}. {kills} kills.",
  "{name} just made history. {kills} kills in one wave.",
  "Never bet against {name}. {kills} kills.",
  "The prophecy was true. {name} delivers {kills} kills.",
  "{name} didn't come to play. {name} came to slay. {kills} kills.",
  "Report {name} for being too good. {kills} kills.",
  "{kills} kills. {name} is that person your coach warned you about.",
  "{name} showing everyone how it's done. {kills} kills.",
  "Bow before {name} and their {kills} kills.",
  "The enemies need therapy after {name}'s {kills}-kill wave.",
  "{name} is the main character. {kills} kills proved it.",
  "Someone get {name} a sponsor. {kills} kills.",
  "{name} simply does not miss. {kills} kills.",
  "Log off everyone, {name} already won. {kills} kills.",
  "{name} just went ultra instinct. {kills} kills.",
  "How does {name} make {kills} kills look so casual?",
  "{name} saw the wave and took it personally. {kills} kills.",
  "{name} is the reason the enemies cry at night. {kills} kills.",
  "Highlight of the game: {name} with {kills} kills.",
  "{name} was locked in. {kills} kills. Respect.",
  "The wave lasted 0 seconds against {name}. {kills} kills.",
  "Every enemy in {name}'s lane just vanished. {kills} kills.",
  "{name} brought the thunder. {kills} kills.",
  "{name} is single-handedly saving the team. {kills} kills.",
  "I'm telling my kids about {name}'s {kills}-kill wave.",
  "If this was a movie, {name} would be the hero. {kills} kills.",
  "{name} just pulled a {kills}-kill flex on the whole lobby.",
  "The enemies have left the chat. {name}: {kills} kills.",
  "Inject {name}'s {kills}-kill performance into my veins.",
  "{name} is a kill vacuum. {kills} sucked up this wave.",
];

const LEAST_KILLS_LINES = [
  "{name} contributed {kills} kills. Thoughts and prayers.",
  "{kills} kills, {name}? Were you even playing?",
  "{name} with {kills} kills. The enemies thank you for your mercy.",
  "Someone check if {name}'s phone is on. {kills} kills.",
  "{name} managed {kills} kills. Participation trophy incoming.",
  "The enemies walked right past {name}. {kills} kills.",
  "{name}: {kills} kills. AFK simulator.",
  "{kills} kills from {name}. Bold strategy.",
  "{name} decided to let the enemies live. {kills} kills.",
  "Were {name}'s towers on vacation? {kills} kills.",
  "{name} brought a pool noodle to a gunfight. {kills} kills.",
  "{kills} kills, {name}? My grandma could do better.",
  "{name} is playing tower defense without the defense. {kills} kills.",
  "Congrats {name}, you almost hit double digits. {kills} kills.",
  "{name} watched the wave like it was a movie. {kills} kills.",
  "{name}'s towers are decorative apparently. {kills} kills.",
  "{kills} kills from {name}. At least they showed up.",
  "{name} said 'it's not about the kills' and proved it. {kills}.",
  "{name} is the reason we can't have nice things. {kills} kills.",
  "The enemies sent {name} a thank you card. {kills} kills.",
  "{name} played like their screen was off. {kills} kills.",
  "{kills} kills? {name}, we need to talk.",
  "{name}'s contribution: {kills} kills and emotional support.",
  "Plot twist: {name} is secretly helping the enemies. {kills} kills.",
  "{name} held it down with {kills} kills. Held what down? Unclear.",
  "If {name}'s kills were a grade, that's an F. {kills}.",
  "{name} just vibed while the team worked. {kills} kills.",
  "{name}: {kills} kills. Was that on purpose?",
  "Somebody tell {name} this isn't a spectator sport. {kills} kills.",
  "The enemies felt safe in {name}'s lane. {kills} kills.",
  "{name} with {kills} kills. Truly inspirational... to the enemies.",
  "{name}'s towers: exist. {name}'s kills: barely. {kills}.",
  "{kills} kills from {name}. Even the towers are embarrassed.",
  "{name} really said 'I'll let y'all handle it.' {kills} kills.",
  "Fun fact: {name} had {kills} kills. Less fun fact: that's the lowest.",
  "{name} treated that wave like a nature documentary. Just observed. {kills} kills.",
  "{kills} kills, {name}. The enemies didn't even know you were there.",
  "{name} is either trolling or lost. {kills} kills.",
  "{name} might need a tutorial. {kills} kills.",
  "Somebody give {name} a map to the enemies. {kills} kills.",
  "{name}: {kills} kills. At this point it's performance art.",
  "Breaking: {name} discovers new strategy of not killing things. {kills} kills.",
  "{name} playing 4D chess while the rest of us play tower defense. {kills} kills.",
  "{name} with {kills} kills. The audacity.",
  "Was {name} building a sandcastle? {kills} kills.",
  "{kills} kills from {name}. Setting records. Bad ones.",
  "The scoreboard sends its condolences to {name}. {kills} kills.",
  "{name}'s lane is an open highway. {kills} kills.",
  "{name} speedran having the fewest kills. {kills}. Impressive?",
  "{kills} kills. {name}, do you need a hug?",
  "{name} played like they were on the enemy team. {kills} kills.",
  "If avoiding kills was a skill, {name} would be MVP. {kills}.",
  "{name}'s towers said 'nah.' {kills} kills.",
  "{name} generously donated {kills} kills to the cause.",
  "{name}: professional enemy escort. {kills} kills.",
  "{kills} kills from {name}. Red carpet for the enemies.",
  "{name} let the enemies through like a gentleman. {kills} kills.",
  "{name}'s kill count is {kills}. I counted too. Still {kills}.",
  "Enemies in {name}'s lane had a spa day. {kills} kills.",
  "{name}: {kills} kills. It's giving 'first time playing.'",
  "{kills} kills, {name}. The enemies are clapping.",
  "{name} was morally opposed to killing this wave. {kills}.",
  "If {name}'s kills were a limbo bar, we'd all clear it. {kills}.",
  "{name} played defense. Just not tower defense. {kills} kills.",
  "{name} with {kills} kills. Moment of silence.",
  "The enemies vacationed in {name}'s lane. {kills} kills.",
  "Can someone tell {name} we're at war? {kills} kills.",
  "{name} showed incredible restraint. {kills} kills.",
  "Enemies ranked {name}'s lane 5 stars on Yelp. {kills} kills.",
  "{kills} kills from {name}. The scoreboard cringed.",
  "{name} discovered pacifism mid-game. {kills} kills.",
  "{name}'s towers are filing for unemployment. {kills} kills.",
  "Everyone carried {name} this wave. {kills} kills.",
  "Not the {kills} kills from {name}...",
  "{name}: {kills} kills. Better luck next wave?",
  "The enemies applauded {name}'s hospitality. {kills} kills.",
  "{name} really out here doing {kills} kills. On purpose.",
  "Bless {name}'s heart. {kills} kills.",
  "{name}'s towers hit the snooze button. {kills} kills.",
  "Emergency meeting: {name} had {kills} kills.",
  "{name} is giving 'I just downloaded this game.' {kills} kills.",
  "{kills} kills from {name}. The team felt that.",
  "{name}: {kills} kills. Underperforming is an understatement.",
  "I hope {name}'s next wave goes better than {kills} kills.",
  "{name}'s lane was a tourist attraction for enemies. {kills} kills.",
  "Somewhere, someone believes in {name}. {kills} kills tested that.",
  "{name} just set a personal worst. {kills} kills.",
  "{kills} kills. {name}, the enemies left you a tip.",
  "Even {name}'s towers are confused. {kills} kills.",
  "Did {name} forget to build? {kills} kills suggests yes.",
  "{name}'s highlight reel: {kills} kills. Runtime: 2 seconds.",
  "{name} said 'defense optional.' {kills} kills.",
  "Yikes. {name} with {kills} kills. Just... yikes.",
  "{kills} kills from {name}. Alexa, play a sad song.",
  "{name} treated the enemies like houseguests. {kills} kills.",
  "Nobody: ... {name}: {kills} kills. Absolute cinema.",
  "{name} had {kills} kills. Let's not make it a thing. Too late.",
  "{kills} kills. {name} really woke up and chose peace.",
  "The enemies wrote {name} a 5-star review. {kills} kills.",
  "{name}: professional wave watcher. {kills} kills.",
];

const { Lane } = require('./Lane');

// MARK: - Delta Encoding Helpers

// Helper: create minimal state with only changed fields
// previousState is passed in and returned to keep it per-instance
function createDeltaState(currentState, previousState) {
  if (!previousState) {
    // First broadcast — send full state
    return { state: currentState, prev: currentState };
  }

  const delta = {
    roomId: currentState.roomId,
    waveNumber: currentState.waveNumber,
    sharedHp: currentState.sharedHp,
    waveCountdown: currentState.waveCountdown,
    allLanesActive: currentState.allLanesActive,
    waitingForStart: currentState.waitingForStart,
    lanes: {},
  };

  // Only include lanes that have changed
  for (const [laneIndex, laneState] of Object.entries(currentState.lanes)) {
    if (!previousState.lanes[laneIndex]) {
      // New lane
      delta.lanes[laneIndex] = laneState;
    } else {
      // Check for changes
      const prevLane = previousState.lanes[laneIndex];
      const changes = [];

      if (prevLane.cash !== laneState.cash) changes.push('cash', laneState.cash);
      if (prevLane.waveNumber !== laneState.waveNumber) changes.push('waveNumber', laneState.waveNumber);
      if (prevLane.waveActive !== laneState.waveActive) changes.push('waveActive', laneState.waveActive);
      if (prevLane.waveCountdown !== laneState.waveCountdown) changes.push('waveCountdown', laneState.waveCountdown);
      if (prevLane.enemiesRemaining !== laneState.enemiesRemaining) changes.push('enemiesRemaining', laneState.enemiesRemaining);

      // Check enemy changes (only if there are changes)
      const prevEnemies = prevLane.enemies.map(e => ({
        id: e.id,
        alive: e.alive,
        x: e.x,
        y: e.y,
        hp: e.hp,
      }));
      const currEnemies = laneState.enemies.map(e => ({
        id: e.id,
        alive: e.alive,
        x: e.x,
        y: e.y,
        hp: e.hp,
      }));

      // Compare enemies by ID
      const enemyChanges = new Set();
      for (const curr of currEnemies) {
        const prev = prevEnemies.find(p => p.id === curr.id);
        if (!prev) {
          // New enemy
          enemyChanges.add('enemies', curr);
        } else if (
          prev.hp !== curr.hp ||
          prev.x !== curr.x ||
          prev.y !== curr.y
        ) {
          enemyChanges.add('enemies', curr);
        }
      }

      // If no changes to this lane, skip it
      if (changes.length === 0 && enemyChanges.size === 0) {
        continue; // Skip unchanged lanes
      }

      delta.lanes[laneIndex] = {
        cash: laneState.cash,
        waveNumber: laneState.waveNumber,
        waveActive: laneState.waveActive,
        waveCountdown: laneState.waveCountdown,
        enemiesRemaining: laneState.enemiesRemaining,
        changes,
      };

      // Only include enemies if there are changes
      if (enemyChanges.size > 0) {
        delta.lanes[laneIndex].enemies = Array.from(enemyChanges);
      }
    }
  }

  return { state: delta, prev: structuredClone(currentState) };
}

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
    this.lanes = new Map(); // playerId -> Lane (authoritative store)
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

    // Per-instance delta state tracking (NOT module-level)
    this._previousState = null;

    this._tickInterval = null;
    this._tickRate = 16; // ms (~60 ticks/sec)
    this._broadcastCounter = 0;
    this._broadcastEvery = 3; // Send state every 3 ticks (~20fps, interpolated on client)

    // Stalled enemy scanner
    this._stalledScanTimer = 0;
    this._stalledScanInterval = 4; // seconds
    this._lastEnemyPositions = new Map(); // enemyId -> { x, y, laneId }

    // Synchronized wave management
    this._allLanesCleared = false;
    this._betweenWaveTimer = 0;
    this._waveQueued = false; // Flag: start wave on next tick
    this._sendEarlyProcessed = false; // Guard against duplicate send_early

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
        this._sendEarlyProcessed = false;

        // Announce wave kill stats before resetting
        this._announceWaveStats();

        for (const lane of this.lanes.values()) {
          lane.waveManager.enemies = [];
          lane.waveManager.waveActive = false;
          lane.waveManager.waveCleared = true;
          lane.waveKills = 0; // Reset per-wave kills
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

    // Broadcast state (throttled, full state each time — delta encoding removed for reliability)
    this._broadcastCounter++;
    if (this._broadcastCounter >= this._broadcastEvery && this.onStateUpdate) {
      this._broadcastCounter = 0;
      this.onStateUpdate(this.getState());
    }
  }

  _announceWaveStats() {
    if (this.lanes.size < 2) return;

    let mostKills = { pid: null, kills: -1, name: '' };
    let leastKills = { pid: null, kills: Infinity, name: '' };

    for (const [pid, lane] of this.lanes) {
      const name = this._getPlayerUsername(pid);
      if (lane.waveKills > mostKills.kills) {
        mostKills = { pid, kills: lane.waveKills, name };
      }
      if (lane.waveKills < leastKills.kills) {
        leastKills = { pid, kills: lane.waveKills, name };
      }
    }

    if (mostKills.pid) {
      const msg = _pickRandom(MOST_KILLS_LINES)
        .replace('{name}', mostKills.name)
        .replace('{kills}', mostKills.kills);
      this._announceChat(msg);
    }
    if (leastKills.pid && leastKills.pid !== mostKills.pid) {
      const msg = _pickRandom(LEAST_KILLS_LINES)
        .replace('{name}', leastKills.name)
        .replace('{kills}', leastKills.kills);
      this._announceChat(msg);
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
          // Enemy hasn't moved since last scan
          const stalledCount = (prev.stalledCount || 0) + 1;
          currentPositions.get(key).stalledCount = stalledCount;

          // If stuck on spawn row for 2+ consecutive checks, treat as leaked
          if (stalledCount >= 2 && Math.round(cy) <= 0) {
            console.log(`[stalled] ${enemy.type} (id:${enemy.id}) stuck on spawn row in lane ${pid} for ${stalledCount} checks — treating as leak`);
            enemy.alive = false;
            enemy.deathHandled = true;
            this._handleLeak(pid, enemy);
            continue;
          }

          // Otherwise try to respawn at a valid path
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
              if (this.onLaneEvent) {
                this.onLaneEvent(pid, 'enemy_respawned', {
                  enemyId: enemy.id,
                  col: c,
                  row: 0,
                });
              }
              console.log(`[stalled] Respawned ${enemy.type} (id:${enemy.id}) to top of lane ${pid} at col ${c}`);
              break;
            }
          }
          if (!respawned) {
            console.log(`[stalled] No path for ${enemy.type} (id:${enemy.id}) in lane ${pid} — treating as leak`);
            enemy.alive = false;
            enemy.deathHandled = true;
            this._handleLeak(pid, enemy);
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

      // Immediately broadcast leak damage so clients update HP without waiting for next tick
      if (this.onLaneEvent) {
        this.onLaneEvent(fromPlayerId, 'leak_damage', {
          enemyType: enemy.type,
          damage: leakDamage,
          sharedHp: Math.round(this.sharedHp),
          maxHp: this.maxHp,
        });
      }
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
          this._sendEarlyProcessed = true;
          console.log(`[wave] Game started by player ${playerId}`);
          return { success: true, bonus: 0 };
        }
        // Between waves — skip countdown, bonus to ALL + $25 extra to the grabber
        // Guard against multiple players sending early in the same countdown
        if (this._betweenWaveTimer > 0 && !this._sendEarlyProcessed) {
          this._sendEarlyProcessed = true;
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
          const grabberLane = this.lanes.get(playerId);
          grabberLane.cash += grabberBonus;
          grabberLane.totalEarned += grabberBonus;

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

  resetDeltaTracking() {
    this._previousState = null;
  }
}

module.exports = { GameInstance };
