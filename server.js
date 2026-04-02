// MARK: - Impossible Tower Defense — Multiplayer Socket Server
// Authoritative game server for co-op multiplayer (2-4 players).

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

  // MARK: - Auth
  socket.on('auth', (data, ack) => {
    playerId = data.playerId;
    username = data.username;
    console.log(`[auth] ${username} (${playerId})`);
    if (ack) ack({ success: true });
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

  // MARK: - Start Game
  socket.on('start_game', (data, ack) => {
    if (!playerId) return ack?.({ success: false, reason: 'not_authenticated' });

    const room = roomManager.getPlayerRoom(playerId);
    if (!room) return ack?.({ success: false, reason: 'not_in_room' });
    if (room.hostId !== playerId) return ack?.({ success: false, reason: 'not_host' });
    if (room.players.size < 2) return ack?.({ success: false, reason: 'need_more_players' });

    if (!room.startGame()) {
      return ack?.({ success: false, reason: 'start_failed' });
    }

    // Set up game callbacks
    room.game.onStateUpdate = (state) => {
      io.to(room.code).emit('game_state', state);
    };

    room.game.onGameOver = (results) => {
      room.state = 'finished';
      io.to(room.code).emit('game_over', results);
      console.log(`[game:over] Room ${room.code} — Wave ${results.waveReached}`);
    };

    console.log(`[game:start] Room ${room.code} — ${room.players.size} players`);
    io.to(room.code).emit('game_started', { playerIds: Array.from(room.players.keys()) });
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
  socket.on('chat_message', (data) => {
    if (!playerId) return;
    const room = roomManager.getPlayerRoom(playerId);
    if (!room) return;

    io.to(room.code).emit('chat_message', {
      playerId,
      username,
      message: data.message.substring(0, 200), // Cap at 200 chars
      timestamp: Date.now(),
    });
  });

  // MARK: - Disconnect
  socket.on('disconnect', () => {
    console.log(`[disconnect] ${username || socket.id}`);
    if (playerId) {
      const room = roomManager.getPlayerRoom(playerId);
      if (room) {
        const code = room.code;
        roomManager.leaveRoom(playerId);

        const updatedRoom = roomManager.getRoom(code);
        if (updatedRoom) {
          io.to(code).emit('lobby_update', updatedRoom.tolobbyState());
          io.to(code).emit('player_disconnected', { playerId, username });
        }
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
