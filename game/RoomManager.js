// MARK: - Room Manager
// Manages lobbies and game instances. Handles room codes, player join/leave.

const { GameInstance } = require('./GameInstance');

class Room {
  constructor(code, hostId, config) {
    this.code = code;
    this.hostId = hostId;
    this.players = new Map(); // playerId -> { username, socketId }
    this.game = null;
    this.config = config;
    this.state = 'lobby'; // lobby | playing | finished
    this.isPublic = true;  // public by default, host can toggle
    this.createdAt = Date.now();
  }

  addPlayer(playerId, username, socketId) {
    if (this.players.size >= 4) return false;
    if (this.state !== 'lobby') return false;
    // Find first open slot
    const takenSlots = new Set(Array.from(this.players.values()).map(p => p.colorIndex));
    let slot = 0;
    while (takenSlots.has(slot) && slot < 4) slot++;
    this.players.set(playerId, { username, socketId, ready: false, colorIndex: slot });
    return true;
  }

  toggleReady(playerId) {
    const player = this.players.get(playerId);
    if (!player) return false;
    player.ready = !player.ready;
    return true;
  }

  get allReady() {
    if (this.players.size < 2) return false;
    for (const p of this.players.values()) {
      if (!p.ready) return false;
    }
    return true;
  }

  get readyCount() {
    let count = 0;
    for (const p of this.players.values()) {
      if (p.ready) count++;
    }
    return count;
  }

  removePlayer(playerId) {
    this.players.delete(playerId);
    if (this.game) {
      this.game.removePlayer(playerId);
    }
    // If host leaves, assign new host
    if (playerId === this.hostId && this.players.size > 0) {
      this.hostId = this.players.keys().next().value;
    }
  }

  startGame() {
    if (this.state !== 'lobby') return false;
    if (this.players.size < 2) return false;

    this.state = 'playing';
    this.game = new GameInstance(this.code, this.config);

    for (const [pid] of this.players) {
      this.game.addPlayer(pid);
    }

    this.game.start();
    return true;
  }

  get isEmpty() {
    return this.players.size === 0;
  }

  tolobbyState() {
    const players = [];
    for (const [pid, info] of this.players) {
      players.push({
        playerId: pid,
        username: info.username,
        isHost: pid === this.hostId,
        ready: info.ready || false,
        colorIndex: info.colorIndex ?? 0,
      });
    }
    return {
      code: this.code,
      hostId: this.hostId,
      state: this.state,
      players,
      maxPlayers: 4,
      readyCount: this.readyCount,
      allReady: this.allReady,
      isPublic: this.isPublic,
    };
  }
}

class RoomManager {
  constructor(config) {
    this.config = config;
    this.rooms = new Map(); // code -> Room
    this.playerRooms = new Map(); // playerId -> code
  }

  generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I/O/0/1 to avoid confusion
    let code;
    do {
      code = '';
      for (let i = 0; i < 6; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
      }
    } while (this.rooms.has(code));
    return code;
  }

  createRoom(playerId, username, socketId) {
    // Leave existing room first
    this.leaveRoom(playerId);

    const code = this.generateCode();
    const room = new Room(code, playerId, this.config);
    room.addPlayer(playerId, username, socketId);
    this.rooms.set(code, room);
    this.playerRooms.set(playerId, code);
    return room;
  }

  joinRoom(code, playerId, username, socketId) {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) return { success: false, reason: 'room_not_found' };
    if (room.state !== 'lobby') return { success: false, reason: 'game_in_progress' };
    if (room.players.size >= 4) return { success: false, reason: 'room_full' };

    // Leave existing room first
    this.leaveRoom(playerId);

    if (!room.addPlayer(playerId, username, socketId)) {
      return { success: false, reason: 'join_failed' };
    }

    this.playerRooms.set(playerId, code.toUpperCase());
    return { success: true, room };
  }

  leaveRoom(playerId) {
    const code = this.playerRooms.get(playerId);
    if (!code) return;

    const room = this.rooms.get(code);
    if (room) {
      room.removePlayer(playerId);
      if (room.isEmpty) {
        if (room.game) room.game.stop();
        this.rooms.delete(code);
      }
    }
    this.playerRooms.delete(playerId);
  }

  getRoom(code) {
    return this.rooms.get(code.toUpperCase()) || null;
  }

  getPlayerRoom(playerId) {
    const code = this.playerRooms.get(playerId);
    if (!code) return null;
    return this.rooms.get(code) || null;
  }

  // Cleanup stale rooms (no activity for 30 min)
  cleanup() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (room.isEmpty || (room.state === 'finished' && now - room.createdAt > 30 * 60 * 1000)) {
        if (room.game) room.game.stop();
        this.rooms.delete(code);
      }
    }
  }
}

module.exports = { RoomManager, Room };
