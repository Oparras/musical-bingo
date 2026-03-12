const { generateBingoCard } = require('./bingoUtils');

class GameManager {
  constructor() {
    this.rooms = new Map(); // roomId -> RoomData
  }

  createRoom(roomId, presenterSocketId) {
    this.rooms.set(roomId, {
      id: roomId,
      presenter: presenterSocketId,
      status: 'WAITING', // WAITING, PLAYING, FINISHED
      players: [],       // { id, name, socketId, card: [], markedSongs: [] }
      playlist: [],      // Array of song objects { id, name, artist, previewUrl, uri }
      playedSongs: [],   // History of played song IDs
      currentSong: null,
    });
    return this.rooms.get(roomId);
  }

  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  joinRoom(roomId, player) {
    const room = this.rooms.get(roomId);
    if (!room) return { error: 'Room not found' };
    if (room.status !== 'WAITING') return { error: 'Game already in progress' };

    if (room.players.find(p => p.name.toLowerCase() === player.name.toLowerCase())) {
      return { error: 'Name already taken in this room' };
    }

    const newPlayer = {
      id: player.id,
      name: player.name,
      socketId: player.socketId,
      card: [], 
      markedSongs: []
    };
    room.players.push(newPlayer);
    return { room, player: newPlayer };
  }

  removePlayer(socketId) {
    for (const [roomId, room] of this.rooms.entries()) {
      const playerIndex = room.players.findIndex(p => p.socketId === socketId);
      if (playerIndex !== -1) {
        const player = room.players[playerIndex];
        room.players.splice(playerIndex, 1);
        return { roomId, player, room };
      }
      if (room.presenter === socketId) {
        this.rooms.delete(roomId);
        return { roomDestroyed: true, roomId };
      }
    }
    return null;
  }

  startGame(roomId, playlist) {
    const room = this.rooms.get(roomId);
    if (!room) return { error: 'Room not found' };

    room.status = 'PLAYING';
    room.playlist = playlist;
    
    // Generate unique cards for all players
    room.players.forEach(player => {
      // Provide a 4x4 card
      try {
        player.card = generateBingoCard(playlist, 16);
      } catch (err) {
        console.error('Failed to generate card for player', player.name, err);
      }
    });

    return room;
  }
}

module.exports = new GameManager();
