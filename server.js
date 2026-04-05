// MARK: - Impossible Tower Defense — Multiplayer Socket Server
// Authoritative game server for co-op multiplayer (2-4 players).

require('dotenv').config();
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const { RoomManager } = require('./game/RoomManager');
const { Enemy } = require('./game/Enemy');

// Laravel API config (use localhost if same VPS, otherwise external URL)
const IS_LOCALHOST = process.env.LARAVEL_API_URL === undefined;
const LARAVEL_API = IS_LOCALHOST ? 'http://localhost:8000/api' : process.env.LARAVEL_API_URL || 'https://imptowerdef.on-forge.com/api';

// Cache for player stats (TTL: 60s)
const statsCache = new Map();
const STATS_CACHE_TTL = 60000;

// Cache for group best (TTL: 30s)
const groupBestCache = new Map();
const GROUP_BEST_CACHE_TTL = 30000;

// CACHED CONFIG — initialized once at startup, not destructured on every tick
const CONFIG = {
  waves: {},
  enemies: {},
  bunkers: {},
  grid: {},
  player: {},
};

// Initialize cached config from config object
function initCachedConfig() {
  if (config.waves) CONFIG.waves = config.waves;
  if (config.enemies) CONFIG.enemies = config.enemies;
  if (config.bunkers) CONFIG.bunkers = config.bunkers;
  if (config.grid) CONFIG.grid = config.grid;
  if (config.player) CONFIG.player = config.player;
}

// Helper: get cached player stats
async function getCachedPlayerStats(playerIds) {
  const now = Date.now();
  const cached = statsCache.get('mp_players');

  if (cached && now - cached.timestamp < STATS_CACHE_TTL) {
    return cached.data;
  }

  return await fetchAndCacheStats(playerIds);
}

async function fetchAndCacheStats(playerIds) {
  const encodedIds = playerIds.join(',');
  try {
    const res = await fetch(`${LARAVEL_API}/mp/lobby-players?player_ids=${encodedIds}`);
    const data = await res.json();
    statsCache.set('mp_players', { data, timestamp: Date.now() });
    return data;
  } catch (err) {
    console.error('[cache] Failed to fetch stats:', err.message);
    return null;
  }
}

// Helper: get cached group best
async function getCachedGroupBest(playerIds) {
  const now = Date.now();
  const key = playerIds.sort().join(',');
  const cached = groupBestCache.get(key);

  if (cached && now - cached.timestamp < GROUP_BEST_CACHE_TTL) {
    return cached.data;
  }

  try {
    const res = await fetch(`${LARAVEL_API}/mp/group-best`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player_ids: playerIds }),
    });
    const data = await res.json();
    groupBestCache.set(key, { data, timestamp: now });
    return data;
  } catch (err) {
    console.error('[cache] Failed to fetch group best:', err.message);
    return null;
  }
}
const SERVER_KEY = process.env.GAME_SERVER_KEY || '';

// Profanity filter (same list as Laravel CleanUsername rule)
function containsProfanity(text) {
  const banned = [
    'nigger','nigga','nigg3r','n1gger','n1gga','faggot','fagg0t','f4ggot','tranny','retard','r3tard',
    'spic','chink','kike','wetback','coon','gook','beaner','towelhead','raghead',
    'fuck','fuk','fck','f_ck','fuq','shit','sh1t','sht','ass','a55','arse','bitch','b1tch','btch',
    'cunt','c_nt','cock','c0ck','dick','d1ck','penis','vagina','pussy','puss','tits','t1ts','boob',
    'whore','wh0re','hoe','slut','cum','jizz','porn','p0rn','nude','nud3','rape','r4pe','molest','pedo','paedo',
    'kill','murder','suicide','kms','kys',
    'nazi','n4zi','hitler','h1tler','holocaust','kkk','jihad','terrorist','bomb',
  ];
  const lower = text.toLowerCase();
  const normalized = lower.replace(/0/g,'o').replace(/1/g,'i').replace(/3/g,'e').replace(/4/g,'a').replace(/5/g,'s').replace(/7/g,'t').replace(/@/g,'a').replace(/\$/g,'s');
  return banned.some(w => lower.includes(w) || normalized.includes(w));
}

function censorProfanity(text) {
  const banned = [
    'nigger','nigga','nigg3r','n1gger','n1gga','faggot','fagg0t','f4ggot','tranny','retard','r3tard',
    'spic','chink','kike','wetback','coon','gook','beaner','towelhead','raghead',
    'fuck','fuk','fck','f_ck','fuq','shit','sh1t','sht','ass','a55','arse','bitch','b1tch','btch',
    'cunt','c_nt','cock','c0ck','dick','d1ck','penis','vagina','pussy','puss','tits','t1ts','boob',
    'whore','wh0re','hoe','slut','cum','jizz','porn','p0rn','nude','nud3','rape','r4pe','molest','pedo','paedo',
    'kill','murder','suicide','kms','kys',
    'nazi','n4zi','hitler','h1tler','holocaust','kkk','jihad','terrorist','bomb',
  ];
  let result = text;
  for (const word of banned) {
    const regex = new RegExp(word, 'gi');
    result = result.replace(regex, '*'.repeat(word.length));
  }
  return result;
}

// Load shared game config (must be before server setup)
const configPath = path.join(__dirname, 'game-config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

// Set wanderer weights on Enemy prototype
Enemy.setWandererWeights(config);

// Initialize cached config
initCachedConfig();

const PORT = process.env.PORT || 3001;

// Track peak concurrent players
let peakConcurrentPlayers = 0;
let currentConnections = 0;

const server = http.createServer((req, res) => {
  // Health check endpoint
  if (req.url === '/health') {
    const rooms = [];
    for (const [code, room] of roomManager.rooms) {
      rooms.push({
        code,
        state: room.state,
        players: Array.from(room.players.values()).map(p => p.username),
        playerCount: room.players.size,
      });
    }
    
    // Include cache stats
    const cacheInfo = {
      playerStatsCacheSize: statsCache.size,
      groupBestCacheSize: groupBestCache.size,
      cacheTTL: STATS_CACHE_TTL,
    };

    const mem = process.memoryUsage();
    const totalPlayers = Array.from(roomManager.rooms.values()).reduce((sum, r) => sum + r.players.size, 0);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      roomCount: roomManager.rooms.size,
      rooms,
      activePlayers: totalPlayers,
      peakConcurrentPlayers,
      uptimeSeconds: Math.floor(process.uptime()),
      memory: {
        rss: Math.round(mem.rss / 1024 / 1024),
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
      },
      cache: cacheInfo,
    }));
    return;
  }
  
  // 404 for everything else
  res.writeHead(404);
  res.end();
});

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingInterval: 10000,
  pingTimeout: 5000,
});

const roomManager = new RoomManager(config);

// Cleanup stale rooms every 5 minutes
setInterval(() => roomManager.cleanup(), 5 * 60 * 1000);

io.on('connection', (socket) => {
  let playerId = null;
  let username = null;

  currentConnections++;
  if (currentConnections > peakConcurrentPlayers) {
    peakConcurrentPlayers = currentConnections;
  }
  console.log(`[connect] ${socket.id}`);
  broadcastAdminStats();

  // MARK: - Auth (with reconnection)
  socket.on('auth', (data, ack) => {
    playerId = data.playerId;
    username = data.username;
    console.log(`[auth] ${username} (${playerId})`);

    // Check if player was in a room (reconnection)
    const existingRoom = roomManager.getPlayerRoom(playerId);
    if (existingRoom) {
      // Update socket ID
      const playerInfo = existingRoom.players.get(playerId);
      if (playerInfo) {
        playerInfo.socketId = socket.id;
      }
      socket.join(existingRoom.code);
      console.log(`[reconnect] ${username} rejoined room ${existingRoom.code}`);

      if (ack) ack({
        success: true,
        reconnected: true,
        roomCode: existingRoom.code,
        roomState: existingRoom.state,
      });

      // Send current state
      if (existingRoom.state === 'lobby') {
        socket.emit('lobby_update', existingRoom.tolobbyState());
      } else if (existingRoom.state === 'playing' && existingRoom.game) {
        socket.emit('game_started', { playerIds: Array.from(existingRoom.players.keys()) });
        socket.emit('game_state', existingRoom.game.getState());
      }

      // Cancel disconnect timer if any
      if (existingRoom._disconnectTimers?.has(playerId)) {
        clearTimeout(existingRoom._disconnectTimers.get(playerId));
        existingRoom._disconnectTimers.delete(playerId);
        console.log(`[reconnect] Cancelled disconnect timer for ${username}`);
      }

      // Notify others
      io.to(existingRoom.code).emit('player_reconnected', { playerId, username });
      return;
    }

    if (ack) ack({ success: true, reconnected: false });
  });

  // MARK: - Lobby Browser
  socket.on('join_lobby_browser', (data, ack) => {
    socket.join('lobby-browser');
    // Send current open lobbies
    const lobbies = [];
    for (const [code, room] of roomManager.rooms) {
      if (room.state === 'lobby' && room.players.size < 4 && room.isPublic) {
        lobbies.push({
          code,
          hostUsername: room.players.get(room.hostId)?.username || '???',
          playerCount: room.players.size,
          maxPlayers: 4,
          players: Array.from(room.players.values()).map(p => p.username),
          isPublic: room.isPublic,
        });
      }
    }
    socket.emit('lobbies_list', lobbies);
    ack?.({ success: true });
  });

  socket.on('leave_lobby_browser', () => {
    socket.leave('lobby-browser');
  });

  // Helper: broadcast lobby update to browser channel
  function broadcastLobbyBrowser(event, data) {
    io.to('lobby-browser').emit(event, data);
  }

  function getLobbyInfo(room) {
    return {
      code: room.code,
      hostUsername: room.players.get(room.hostId)?.username || '???',
      playerCount: room.players.size,
      maxPlayers: 4,
      players: Array.from(room.players.values()).map(p => p.username),
      isPublic: room.isPublic,
    };
  }

  // MARK: - Create Room
  socket.on('create_room', async (data, ack) => {
    if (!playerId) return ack?.({ success: false, reason: 'not_authenticated' });

    const room = roomManager.createRoom(playerId, username, socket.id);
    socket.join(room.code);
    console.log(`[room:create] ${username} created room ${room.code}`);

    ack?.({ success: true, code: room.code });
    io.to(room.code).emit('lobby_update', room.tolobbyState());
    
    // Pre-fetch lobby data for all players in room (one batch request)
    const playerIds = Array.from(room.players.keys()).map(id => parseInt(id));
    await fetchAndCacheStats(playerIds);
    
    // Fetch group best for existing players
    const existingPlayerIds = playerIds.filter(pid => room.players.get(pid)?.ready); // existing players
    if (existingPlayerIds.length > 0) {
      await getCachedGroupBest(existingPlayerIds);
    }
    
    broadcastLobbyBrowser('lobby_created', getLobbyInfo(room));
  });

  // MARK: - Join Room
  socket.on('join_room', async (data, ack) => {
    if (!playerId) return ack?.({ success: false, reason: 'not_authenticated' });

    const result = roomManager.joinRoom(data.code, playerId, username, socket.id);
    if (!result.success) {
      return ack?.(result);
    }

    socket.join(data.code.toUpperCase());
    console.log(`[room:join] ${username} joined room ${data.code.toUpperCase()}`);

    ack?.({ success: true, code: data.code.toUpperCase() });
    io.to(data.code.toUpperCase()).emit('lobby_update', result.room.tolobbyState());
    
    // Pre-fetch data for joined player
    const playerIds = Array.from(result.room.players.keys()).map(id => parseInt(id));
    await fetchAndCacheStats(playerIds);
    
    broadcastLobbyBrowser('lobby_updated', getLobbyInfo(result.room));
  });

  // MARK: - Leave Room
  socket.on('leave_room', (data, ack) => {
    if (!playerId) return;
    const room = roomManager.getPlayerRoom(playerId);
    if (room) {
      const code = room.code;
      roomManager.leaveRoom(playerId);
      socket.leave(code);
      console.log(`[room:leave] ${username} left room ${code}`);

      // Update remaining players
      const updatedRoom = roomManager.getRoom(code);
      if (updatedRoom) {
        // If return votes are pending and all remaining have voted, trigger return
        if (updatedRoom._returnVotes) {
          updatedRoom._returnVotes.delete(playerId);
          const allVoted = Array.from(updatedRoom.players.keys()).every(pid => updatedRoom._returnVotes.has(pid));
          if (allVoted && updatedRoom.players.size > 0) {
            if (updatedRoom.game) { updatedRoom.game.stop(); updatedRoom.game = null; }
            updatedRoom.state = 'lobby';
            updatedRoom._returnVotes = null;
            for (const [, info] of updatedRoom.players) info.ready = false;
            io.to(code).emit('returned_to_lobby', {});
            io.to(code).emit('lobby_update', updatedRoom.tolobbyState());
          }
        }
        io.to(code).emit('lobby_update', updatedRoom.tolobbyState());
        broadcastLobbyBrowser('lobby_updated', getLobbyInfo(updatedRoom));
      } else {
        broadcastLobbyBrowser('lobby_closed', { code });
      }
    }
    ack?.({ success: true });
  });

  // MARK: - Toggle Ready
  socket.on('toggle_ready', (data, ack) => {
    if (!playerId) return ack?.({ success: false, reason: 'not_authenticated' });

    const room = roomManager.getPlayerRoom(playerId);
    if (!room) return ack?.({ success: false, reason: 'not_in_room' });
    if (room.state !== 'lobby') return ack?.({ success: false, reason: 'game_in_progress' });

    room.toggleReady(playerId);
    const lobbyState = room.tolobbyState();
    io.to(room.code).emit('lobby_update', lobbyState);
    console.log(`[room:ready] ${username} toggled ready in room ${room.code} (${lobbyState.readyCount}/${room.players.size})`);

    // Auto-start if all 4 slots filled and everyone ready
    if (room.players.size === 4 && room.allReady) {
      console.log(`[room:autostart] All 4 players ready in room ${room.code}`);
      if (room.startGame()) {
        setupGameCallbacks(room);
        io.to(room.code).emit('game_started', { playerIds: Array.from(room.players.keys()) });
      }
    }

    ack?.({ success: true, ready: room.players.get(playerId)?.ready });
  });

  // MARK: - Toggle Lobby Visibility (host only)
  socket.on('toggle_visibility', (data, ack) => {
    if (!playerId) return ack?.({ success: false, reason: 'not_authenticated' });
    const room = roomManager.getPlayerRoom(playerId);
    if (!room) return ack?.({ success: false, reason: 'not_in_room' });
    if (room.hostId !== playerId) return ack?.({ success: false, reason: 'not_host' });
    if (room.state !== 'lobby') return ack?.({ success: false, reason: 'game_in_progress' });

    room.isPublic = !room.isPublic;
    io.to(room.code).emit('lobby_update', room.tolobbyState());
    console.log(`[room:visibility] ${username} set room ${room.code} to ${room.isPublic ? 'public' : 'private'}`);

    if (room.isPublic) {
      broadcastLobbyBrowser('lobby_created', getLobbyInfo(room));
    } else {
      broadcastLobbyBrowser('lobby_closed', { code: room.code });
    }

    ack?.({ success: true, isPublic: room.isPublic });
  });

  // MARK: - Request Slot (change position/color)
  socket.on('request_slot', (data, ack) => {
    if (!playerId) return ack?.({ success: false });
    const room = roomManager.getPlayerRoom(playerId);
    if (!room || room.state !== 'lobby') return ack?.({ success: false });

    const targetSlot = data.slotIndex;
    if (targetSlot < 0 || targetSlot > 3) return ack?.({ success: false });

    // Check if slot is taken
    const occupant = Array.from(room.players.entries()).find(([, info]) => info.colorIndex === targetSlot);
    if (occupant) return ack?.({ success: false, reason: 'slot_taken' });

    // Move player to new slot
    const playerInfo = room.players.get(playerId);
    if (playerInfo) {
      playerInfo.colorIndex = targetSlot;
      io.to(room.code).emit('lobby_update', room.tolobbyState());
      console.log(`[room:slot] ${username} moved to slot ${targetSlot} in room ${room.code}`);
    }
    ack?.({ success: true });
  });

  // Helper: set up game callbacks for a room
  function setupGameCallbacks(room) {
    // Reset delta tracking for new game
    if (room.game) {
      room.game.resetDeltaTracking();
    }

    room.game.onStateUpdate = (state) => {
      io.to(room.code).emit('game_state', state);
    };

    // Discrete lane events — sent immediately for responsive UI
    room.game.onLaneEvent = (playerId, event, data) => {
      io.to(room.code).emit('lane_event', { playerId, event, ...data });
    };

    room.game.onGameOver = async (results) => {
      room.state = 'finished';
      io.to(room.code).emit('game_over', results);
      console.log(`[game:over] Room ${room.code} — Wave ${results.waveReached}`);

      try {
        const playerData = [];
        for (const [pid, stats] of Object.entries(results.players)) {
          playerData.push({
            player_id: parseInt(pid),
            total_kills: stats.totalKills,
            total_leaked: stats.totalLeaked,
            total_earned: stats.totalEarned,
            bunkers_built: stats.bunkersBuilt,
            troops_purchased: stats.troopsPurchased,
            troops_upgraded: stats.troopsUpgraded,
          });
        }

        const body = JSON.stringify({
          room_code: results.roomId,
          mode: 'cooperative',
          wave_reached: results.waveReached,
          shared_hp_remaining: Math.max(0, results.sharedHp),
          duration_seconds: results.durationSeconds,
          status: 'completed',
          players: playerData,
        });

        const resp = await fetch(`${LARAVEL_API}/mp/results`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Server-Key': SERVER_KEY,
            'Accept-Encoding': 'gzip',
            'Connection': IS_LOCALHOST ? 'keep-alive' : undefined,
          },
          body,
        });

        const data = await resp.json();
        console.log(`[api] Results submitted — Game #${data.game_id}, Group best: Wave ${data.group_best_wave}`);
        io.to(room.code).emit('group_best_updated', { bestWave: data.group_best_wave });

        // Notify admin dashboard
        broadcastAdminGame({
          type: 'mp',
          name: room.game?._playerNames ? Object.values(room.game._playerNames).join(', ') : 'Unknown',
          wave_reached: results.waveReached,
          total_kills: playerData.reduce((s, p) => s + p.total_kills, 0),
          bunkers_built: playerData.reduce((s, p) => s + p.bunkers_built, 0),
          total_earned: playerData.reduce((s, p) => s + p.total_earned, 0),
          duration: results.durationSeconds,
          time_ago: 'just now',
        });
        broadcastAdminStats();
      } catch (err) {
        console.error(`[api] Failed to submit results:`, err.message);
      }
    };

    // Store player names for chat announcements
    room.game._playerNames = {};
    for (const [pid, info] of room.players) {
      room.game._playerNames[pid] = info.username;
    }

    // Wire up chat announcements from game events
    room.game.onChatAnnounce = (message) => {
      io.to(room.code).emit('chat_message', {
        playerId: 'system',
        username: 'System',
        message,
        timestamp: Date.now(),
      });
    };

    console.log(`[game:start] Room ${room.code} — ${room.players.size} players`);
    io.to(room.code).emit('game_started', { playerIds: Array.from(room.players.keys()) });
    broadcastLobbyBrowser('lobby_started', { code: room.code });
  }

  // MARK: - Start Game (any player, after countdown)
  socket.on('start_game', (data, ack) => {
    if (!playerId) return ack?.({ success: false, reason: 'not_authenticated' });

    const room = roomManager.getPlayerRoom(playerId);
    if (!room) return ack?.({ success: false, reason: 'not_in_room' });
    if (room.state === 'playing') return ack?.({ success: true }); // Already started by another client's countdown
    if (room.players.size < 2) return ack?.({ success: false, reason: 'need_more_players' });

    if (!room.startGame()) {
      return ack?.({ success: false, reason: 'start_failed' });
    }

    setupGameCallbacks(room);
    ack?.({ success: true });
  });

  // MARK: - Pause / Resume
  socket.on('pause_game', (data, ack) => {
    if (!playerId) return ack?.({ success: false });
    const room = roomManager.getPlayerRoom(playerId);
    if (!room || !room.game) return ack?.({ success: false });

    room.game.paused = true;
    room.game.pausedBy = playerId;
    room.game.pausedByUsername = username;
    // Actually pause the tick loop
    if (room.game._tickInterval) {
      clearInterval(room.game._tickInterval);
      room.game._tickInterval = null;
    }

    io.to(room.code).emit('game_paused', {
      pausedBy: playerId,
      pausedByUsername: username,
    });
    console.log(`[game:pause] ${username} paused room ${room.code}`);
    ack?.({ success: true });
  });

  socket.on('resume_game', (data, ack) => {
    if (!playerId) return ack?.({ success: false });
    const room = roomManager.getPlayerRoom(playerId);
    if (!room || !room.game) return ack?.({ success: false });
    // Only the player who paused can resume
    if (room.game.pausedBy !== playerId) return ack?.({ success: false, reason: 'not_pauser' });

    room.game.paused = false;
    room.game.pausedBy = null;
    room.game.pausedByUsername = null;
    // Restart the tick loop
    if (!room.game._tickInterval) {
      room.game._tickInterval = setInterval(() => {
        room.game._tick();
      }, room.game._tickRate);
    }

    io.to(room.code).emit('game_resumed', {});
    console.log(`[game:resume] ${username} resumed room ${room.code}`);
    ack?.({ success: true });
  });

  // MARK: - Return to Lobby (individual choice)
  socket.on('return_to_lobby', (data, ack) => {
    if (!playerId) return;
    const room = roomManager.getPlayerRoom(playerId);
    if (!room) return;

    // Track who wants to return
    if (!room._returnVotes) room._returnVotes = new Set();
    room._returnVotes.add(playerId);

    console.log(`[room:return] ${username} voted to return in room ${room.code} (${room._returnVotes.size}/${room.players.size})`);

    // Check if all remaining players have voted
    const allVoted = Array.from(room.players.keys()).every(pid => room._returnVotes.has(pid));

    if (allVoted) {
      // Stop the game if running
      if (room.game) {
        room.game.stop();
        room.game = null;
      }

      // Reset room to lobby state
      room.state = 'lobby';
      room._returnVotes = null;
      for (const [pid, info] of room.players) {
        info.ready = false;
      }

      io.to(room.code).emit('returned_to_lobby', {});
      io.to(room.code).emit('lobby_update', room.tolobbyState());
      console.log(`[room:lobby] All players returned room ${room.code} to lobby`);
      broadcastLobbyBrowser('lobby_returned', getLobbyInfo(room));
    } else {
      // Let others know this player is waiting
      io.to(room.code).emit('player_return_vote', {
        playerId,
        username,
        votedCount: room._returnVotes.size,
        totalCount: room.players.size,
      });
    }

    ack?.({ success: true });
  });

  // MARK: - Game Action
  socket.on('game_action', (action, ack) => {
    if (!playerId) return ack?.({ success: false, reason: 'not_authenticated' });

    const room = roomManager.getPlayerRoom(playerId);
    if (!room || !room.game) return ack?.({ success: false, reason: 'not_in_game' });

    const result = room.game.handleAction(playerId, action);
    ack?.(result);
  });

  // MARK: - Spectate (admin only, ghost mode)
  socket.on('spectate', (data, ack) => {
    const code = (data.code || '').toUpperCase();
    const room = roomManager.getRoom(code);
    if (!room) return ack?.({ success: false, reason: 'room_not_found' });

    // Join the room channel to receive game_state broadcasts — but don't add to players
    socket.join(code);
    console.log(`[spectate] Ghost joined room ${code}`);

    // Send current game state immediately
    if (room.game) {
      socket.emit('game_state', room.game.getState());
    }

    ack?.({ success: true, state: room.state });
  });

  // MARK: - Admin Dashboard (live updates)
  socket.on('join_admin', (data, ack) => {
    socket.join('admin-dashboard');
    socket.emit('admin_stats', getAdminStats());
    console.log(`[admin] Dashboard client connected`);
    ack?.({ success: true });
  });

  // MARK: - Get Group Best (cached)
  socket.on('get_group_best', async (data, ack) => {
    if (!playerId) return ack?.({ success: false, reason: 'not_authenticated' });

    const room = roomManager.getPlayerRoom(playerId);
    if (!room) return ack?.({ success: false, reason: 'not_in_room' });

    const playerIds = Array.from(room.players.keys()).map(id => parseInt(id));
    
    // Use cached version
    const result = await getCachedGroupBest(playerIds);
    
    ack?.({ success: true, data: result || { has_history: false, best_wave: 0 } });
  });

  // MARK: - Chat
  socket.on('chat_message', async (data) => {
    if (!playerId) return;
    const room = roomManager.getPlayerRoom(playerId);
    if (!room) return;

    const msg = (data.message || '').substring(0, 200);

    // Handle /name command (host only)
    if (msg.startsWith('/name ')) {
      if (room.hostId !== playerId) {
        socket.emit('chat_message', {
          playerId: 'system',
          username: 'System',
          message: 'Only the host can rename the team.',
          timestamp: Date.now(),
        });
        return;
      }

      const newName = msg.substring(6).trim();

      if (newName.length < 2 || newName.length > 30) {
        socket.emit('chat_message', {
          playerId: 'system',
          username: 'System',
          message: 'Team name must be 2-30 characters.',
          timestamp: Date.now(),
        });
        return;
      }

      // Check profanity
      if (containsProfanity(newName)) {
        socket.emit('chat_message', {
          playerId: 'system',
          username: 'System',
          message: 'That team name is not allowed.',
          timestamp: Date.now(),
        });
        return;
      }

      // Update via Laravel API
      try {
        const playerIds = Array.from(room.players.keys()).map(id => parseInt(id));
        const resp = await fetch(`${LARAVEL_API}/mp/rename-team`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Server-Key': SERVER_KEY,
            'Accept-Encoding': 'gzip',
            'Connection': IS_LOCALHOST ? 'keep-alive' : undefined,
          },
          body: JSON.stringify({ player_ids: playerIds, team_name: newName }),
        });
        const result = await resp.json();

        if (result.success) {
          io.to(room.code).emit('chat_message', {
            playerId: 'system',
            username: 'System',
            message: `Team renamed to "${result.team_name}"`,
            timestamp: Date.now(),
          });
          io.to(room.code).emit('team_name_updated', { teamName: result.team_name });
          console.log(`[room:rename] Room ${room.code} renamed to "${result.team_name}"`);
        } else {
          socket.emit('chat_message', {
            playerId: 'system',
            username: 'System',
            message: result.message || 'Could not rename team.',
            timestamp: Date.now(),
          });
        }
      } catch (err) {
        socket.emit('chat_message', {
          playerId: 'system',
          username: 'System',
          message: 'Failed to rename team. Try again.',
          timestamp: Date.now(),
        });
      }
      return;
    }

    const playerInfo = room.players.get(playerId);
    io.to(room.code).emit('chat_message', {
      playerId,
      username,
      colorIndex: playerInfo?.colorIndex ?? 0,
      message: censorProfanity(msg),
      timestamp: Date.now(),
    });
  });

  // MARK: - Disconnect (with reconnection grace period)
  socket.on('disconnect', () => {
    currentConnections = Math.max(0, currentConnections - 1);
    console.log(`[disconnect] ${username || socket.id}`);
    broadcastAdminStats();
    if (!playerId) return;

    const room = roomManager.getPlayerRoom(playerId);
    if (!room) return;

    const code = room.code;

    if (room.state === 'playing') {
      // Game in progress — remove player but keep their lane running
      // Lane continues: enemies spawn, move, leak to other players
      io.to(code).emit('player_disconnected', { playerId, username });
      console.log(`[disconnect] ${username} disconnected during game in room ${code} — lane stays active`);
      // Remove from room players but DON'T remove their lane from the game
      room.players.delete(playerId);
      roomManager.playerRooms.delete(playerId);
    } else {
      // In lobby — give 30 seconds to reconnect (switching apps to share code etc.)
      io.to(code).emit('player_disconnected', { playerId, username, gracePeriod: 120 });
      console.log(`[disconnect] ${username} has 120s to reconnect to lobby ${code}`);

      const disconnectTimer = setTimeout(() => {
        const currentRoom = roomManager.getPlayerRoom(playerId);
        if (currentRoom && currentRoom.code === code) {
          const playerInfo = currentRoom.players.get(playerId);
          if (playerInfo && playerInfo.socketId === socket.id) {
            console.log(`[disconnect] ${username} timed out from lobby ${code}`);
            roomManager.leaveRoom(playerId);
            const updatedRoom = roomManager.getRoom(code);
            if (updatedRoom) {
              io.to(code).emit('lobby_update', updatedRoom.tolobbyState());
              io.to(code).emit('player_left', { playerId, username });
            }
          }
        }
      }, 120000);

      if (!room._disconnectTimers) room._disconnectTimers = new Map();
      room._disconnectTimers.set(playerId, disconnectTimer);
    }
  });
});

// MARK: - Admin Live Dashboard

function getAdminStats() {
  const mem = process.memoryUsage();
  const totalPlayers = Array.from(roomManager.rooms.values()).reduce((sum, r) => sum + r.players.size, 0);
  const load = require('os').loadavg();
  const cpus = require('os').cpus().length;
  return {
    activeRooms: roomManager.rooms.size,
    activePlayers: totalPlayers,
    peakConcurrentPlayers,
    uptimeSeconds: Math.floor(process.uptime()),
    cpuUsage: Math.round(load[0] * 100 / cpus * 10) / 10,
    memory: {
      rss: Math.round(mem.rss / 1024 / 1024),
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
    },
  };
}

function broadcastAdminStats() {
  io.to('admin-dashboard').emit('admin_stats', getAdminStats());
}

function broadcastAdminGame(game) {
  io.to('admin-dashboard').emit('admin_game', game);
}

// Emit health stats to admin dashboard every 5 minutes
setInterval(() => broadcastAdminStats(), 5 * 60 * 1000);

server.listen(PORT, () => {
  console.log(`🏰 Impossible Tower Defense — Socket Server`);
  console.log(`   Port: ${PORT}`);
  console.log(`   Config version: ${config.version}`);
  console.log(`   Ready for connections.`);
});
