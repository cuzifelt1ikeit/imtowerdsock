// MARK: - Impossible Tower Defense — Multiplayer Socket Server
// Authoritative game server for co-op multiplayer (2-4 players).

require('dotenv').config();
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const { RoomManager } = require('./game/RoomManager');
const { Enemy } = require('./game/Enemy');

// Load shared game config
const configPath = path.join(__dirname, 'game-config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

// Set wanderer weights on Enemy prototype
Enemy.setWandererWeights(config);

// Laravel API config
const LARAVEL_API = process.env.LARAVEL_API_URL || 'https://imptowerdef.on-forge.com/api';
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

const PORT = process.env.PORT || 3001;
const server = http.createServer((req, res) => {
  // Health check endpoint
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', rooms: roomManager.rooms.size }));
    return;
  }
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

  console.log(`[connect] ${socket.id}`);

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

  // MARK: - Create Room
  socket.on('create_room', (data, ack) => {
    if (!playerId) return ack?.({ success: false, reason: 'not_authenticated' });

    const room = roomManager.createRoom(playerId, username, socket.id);
    socket.join(room.code);
    console.log(`[room:create] ${username} created room ${room.code}`);

    ack?.({ success: true, code: room.code });
    io.to(room.code).emit('lobby_update', room.tolobbyState());
  });

  // MARK: - Join Room
  socket.on('join_room', (data, ack) => {
    if (!playerId) return ack?.({ success: false, reason: 'not_authenticated' });

    const result = roomManager.joinRoom(data.code, playerId, username, socket.id);
    if (!result.success) {
      return ack?.(result);
    }

    socket.join(data.code.toUpperCase());
    console.log(`[room:join] ${username} joined room ${data.code.toUpperCase()}`);

    ack?.({ success: true, code: data.code.toUpperCase() });
    io.to(data.code.toUpperCase()).emit('lobby_update', result.room.tolobbyState());
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
        io.to(code).emit('lobby_update', updatedRoom.tolobbyState());
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

  // Helper: set up game callbacks for a room
  function setupGameCallbacks(room) {
    room.game.onStateUpdate = (state) => {
      io.to(room.code).emit('game_state', state);
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
          },
          body,
        });

        const data = await resp.json();
        console.log(`[api] Results submitted — Game #${data.game_id}, Group best: Wave ${data.group_best_wave}`);
        io.to(room.code).emit('group_best_updated', { bestWave: data.group_best_wave });
      } catch (err) {
        console.error(`[api] Failed to submit results:`, err.message);
      }
    };

    console.log(`[game:start] Room ${room.code} — ${room.players.size} players`);
    io.to(room.code).emit('game_started', { playerIds: Array.from(room.players.keys()) });
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

  // MARK: - Return to Lobby
  socket.on('return_to_lobby', (data, ack) => {
    if (!playerId) return;
    const room = roomManager.getPlayerRoom(playerId);
    if (!room) return;

    // Stop the game if running
    if (room.game) {
      room.game.stop();
      room.game = null;
    }

    // Reset room to lobby state
    room.state = 'lobby';
    for (const [pid, info] of room.players) {
      info.ready = false;
    }

    io.to(room.code).emit('returned_to_lobby', {});
    io.to(room.code).emit('lobby_update', room.tolobbyState());
    console.log(`[room:lobby] ${username} returned room ${room.code} to lobby`);
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
    console.log(`[disconnect] ${username || socket.id}`);
    if (!playerId) return;

    const room = roomManager.getPlayerRoom(playerId);
    if (!room) return;

    const code = room.code;

    if (room.state === 'playing') {
      // Game in progress — give 60 seconds to reconnect
      io.to(code).emit('player_disconnected', { playerId, username, gracePeriod: 60 });
      console.log(`[disconnect] ${username} has 60s to reconnect to room ${code}`);

      const disconnectTimer = setTimeout(() => {
        // Check if they reconnected (socket ID would have changed)
        const currentRoom = roomManager.getPlayerRoom(playerId);
        if (currentRoom && currentRoom.code === code) {
          const playerInfo = currentRoom.players.get(playerId);
          if (playerInfo && playerInfo.socketId === socket.id) {
            // Still the old socket — they didn't reconnect
            console.log(`[disconnect] ${username} timed out, removing from room ${code}`);
            roomManager.leaveRoom(playerId);
            const updatedRoom = roomManager.getRoom(code);
            if (updatedRoom) {
              io.to(code).emit('lobby_update', updatedRoom.tolobbyState());
              io.to(code).emit('player_left', { playerId, username });
            }
          }
        }
      }, 60000);

      // Store timer so we can cancel on reconnect
      if (!room._disconnectTimers) room._disconnectTimers = new Map();
      room._disconnectTimers.set(playerId, disconnectTimer);
    } else {
      // In lobby — remove immediately
      roomManager.leaveRoom(playerId);
      const updatedRoom = roomManager.getRoom(code);
      if (updatedRoom) {
        io.to(code).emit('lobby_update', updatedRoom.tolobbyState());
        io.to(code).emit('player_disconnected', { playerId, username });
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`🏰 Impossible Tower Defense — Socket Server`);
  console.log(`   Port: ${PORT}`);
  console.log(`   Config version: ${config.version}`);
  console.log(`   Ready for connections.`);
});
