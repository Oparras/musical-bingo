const { generateBingoCard } = require('./bingoUtils');
const supabase = require('./supabaseClient');

class GameManager {
  constructor() {
    this.rooms = new Map(); // Keep in-memory for speed, but sync with DB
    this.persistenceEnabled = !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
  }

  async createRoom(roomId, presenterSocketId) {
    const roomData = {
      id: roomId,
      presenter: presenterSocketId,
      status: 'WAITING',
      players: [],
      playedSongs: [],
      currentSong: null,
    };
    
    this.rooms.set(roomId, roomData);

    if (this.persistenceEnabled) {
      try {
        const { error } = await supabase
          .from('rooms')
          .upsert({ 
            id: roomId, 
            status: 'WAITING', 
            host_id: presenterSocketId,
            line_locked: false 
          });
        if (error) console.error('Supabase Error (createRoom):', error.message);
      } catch (err) {
        console.error('Supabase Error (createRoom):', err);
      }
    }

    return roomData;
  }

  async getRoom(roomId) {
    let room = this.rooms.get(roomId);
    if (room) return room;

    if (this.persistenceEnabled) {
      try {
        const { data: dbRoom, error: roomError } = await supabase
          .from('rooms')
          .select('*')
          .eq('id', roomId)
          .single();

        if (dbRoom) {
          const { data: dbPlayers, error: playersError } = await supabase
            .from('players')
            .select('*')
            .eq('room_id', roomId);

          room = {
            id: dbRoom.id,
            status: dbRoom.status,
            host_id: dbRoom.host_id,
            playlist: dbRoom.playlist_data || [],
            playedSongs: dbRoom.played_songs_ids || [],
            currentSong: dbRoom.current_song,
            lineLocked: dbRoom.line_locked,
            players: (dbPlayers || []).map(p => ({
              id: p.id,
              name: p.nickname,
              socketId: p.socket_id,
              isConnected: p.is_connected,
              card: p.card_data || [],
              markedIndexes: p.marked_cells || [],
              hasLine: p.has_line,
              hasBingo: p.has_bingo,
              markedCount: (p.marked_cells || []).length
            }))
          };
          this.rooms.set(roomId, room);
          return room;
        }
      } catch (err) {
        console.error('Supabase Error (getRoom):', err);
      }
    }
    return null;
  }

  async joinRoom(roomId, player) {
    const room = await this.getRoom(roomId);
    if (!room) return { error: 'Room not found' };

    // 1. Check if player already exists in this room (reconnection)
    let existingPlayer = room.players.find(p => p.id === player.id);
    
    if (existingPlayer) {
      existingPlayer.socketId = player.socketId;
      existingPlayer.isConnected = true;
      
      if (this.persistenceEnabled) {
        try {
          await supabase
            .from('players')
            .update({ is_connected: true, socket_id: player.socketId, last_seen: new Date().toISOString() })
            .eq('id', player.id);
        } catch (err) {
          console.error('Supabase Error (joinRoom reconnect):', err);
        }
      }
      return { room, player: existingPlayer, reconnect: true };
    }

    // 2. If it's a NEW player join (no playerId provided in the original request), check room status
    if (room.status !== 'WAITING' && !player.isReconnecting) {
      return { error: 'Game already in progress' };
    }

    // Check if name is taken by another player
    if (room.players.find(p => p.name.toLowerCase() === player.name.toLowerCase())) {
      return { error: 'Name already taken in this room' };
    }

    // 3. Initialize new session if not found in list (Late joiner or hydrate miss)
    let newPlayer = existingPlayer;
    if (!newPlayer) {
      newPlayer = {
        id: player.id || Math.random().toString(36).substring(2, 9),
        name: player.name,
        socketId: player.socketId,
        isConnected: true,
        card: [], 
        markedIndexes: [],
        hasLine: false,
        hasBingo: false,
        markedCount: 0
      };
      
      // If joining late while game has started, assign a card as fallback 
      if (room.status !== 'WAITING' && room.playlist && room.playlist.length > 0) {
        try {
          newPlayer.card = generateBingoCard(room.playlist, 16);
        } catch (err) {
          console.error('Late joiner card generation error:', err);
        }
      }
      room.players.push(newPlayer);
    }

    if (this.persistenceEnabled) {
      try {
        const { error } = await supabase
          .from('players')
          .upsert({
            id: player.id,
            room_id: roomId,
            nickname: player.name,
            socket_id: player.socketId,
            is_connected: true,
            last_seen: new Date().toISOString()
          });
        if (error) console.error('Supabase Error (joinRoom):', error.message);
      } catch (err) {
        console.error('Supabase Error (joinRoom):', err);
      }
    }

    return { room, player: newPlayer };
  }

  async updatePlayerMarked(roomId, playerId, markedIndexes) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const player = room.players.find(p => p.id === playerId);
    if (!player) return;

    player.markedCount = Array.isArray(markedIndexes) ? markedIndexes.length : 0;
    player.markedIndexes = markedIndexes; // Store full indexes

    if (this.persistenceEnabled) {
      try {
        await supabase
          .from('players')
          .update({ 
            marked_cells: markedIndexes,
            last_seen: new Date().toISOString()
          })
          .eq('id', playerId);
      } catch (err) {
        console.error('Supabase Error (updatePlayerMarked):', err);
      }
    }
  }

  async setWinState(roomId, playerId, type) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const player = room.players.find(p => p.id === playerId);
    if (!player) return;

    const updates = {};
    if (type === 'LINE') {
      player.hasLine = true;
      room.lineLocked = true;
      updates.has_line = true;
    } else if (type === 'BINGO') {
      player.hasBingo = true;
      room.status = 'FINISHED';
      updates.has_bingo = true;
    }

    if (this.persistenceEnabled) {
      try {
        if (type === 'LINE') {
          await supabase.from('rooms').update({ line_locked: true }).eq('id', roomId);
        } else if (type === 'BINGO') {
          await supabase.from('rooms').update({ status: 'FINISHED' }).eq('id', roomId);
        }
        await supabase.from('players').update(updates).eq('id', playerId);
      } catch (err) {
        console.error('Supabase Error (setWinState):', err);
      }
    }
  }

  async disconnectPlayer(socketId) {
    for (const [roomId, room] of this.rooms.entries()) {
      const playerIndex = room.players.findIndex(p => p.socketId === socketId);
      if (playerIndex !== -1) {
        const player = room.players[playerIndex];
        player.isConnected = false;
        player.lastSeen = Date.now();

        if (this.persistenceEnabled) {
          try {
            await supabase
              .from('players')
              .update({ is_connected: false, last_seen: new Date().toISOString() })
              .eq('id', player.id);
          } catch (err) {
            console.error('Supabase Error (disconnectPlayer):', err);
          }
        }
        
        return { roomId, player, room };
      }
      if (room.presenter === socketId) {
        // Option: Don't destroy immediately, but mark as inactive?
        // For now, let's keep it simple as the original code destroyed it.
        // But if we want persistence, we should probably NOT destroy it.
        // this.rooms.delete(roomId);
        return { roomDestroyed: true, roomId };
      }
    }
    return null;
  }

  async startGame(roomId, playlist) {
    const room = this.rooms.get(roomId);
    if (!room) return { error: 'Room not found' };

    room.status = 'PLAYING';
    room.playlist = playlist;
    
    // Generate unique cards for all players
    const updates = [];
    room.players.forEach(player => {
      try {
        player.card = generateBingoCard(playlist, 16);
        if (this.persistenceEnabled) {
          updates.push(
            supabase
              .from('players')
              .update({ card_data: player.card })
              .eq('id', player.id)
          );
        }
      } catch (err) {
        console.error('Failed to generate card for player', player.name, err);
      }
    });

    if (this.persistenceEnabled) {
      try {
        await Promise.all([
          supabase.from('rooms').update({ 
            status: 'PLAYING',
            playlist_data: playlist 
          }).eq('id', roomId),
          ...updates
        ]);
      } catch (err) {
        console.error('Supabase Error (startGame):', err);
      }
    }

    return room;
  }

  async nextSong(roomId, song) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    
    room.playedSongs.push(song.id);
    room.currentSong = song;

    if (this.persistenceEnabled) {
      try {
        await supabase.from('rooms')
          .update({ 
            current_song: song,
            played_songs_ids: room.playedSongs 
          })
          .eq('id', roomId);
      } catch (err) {
        console.error('Supabase Error (nextSong):', err);
      }
    }
  }
}

module.exports = new GameManager();
