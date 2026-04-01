const { generateBingoCard } = require('./bingoUtils');
const supabase = require('./supabaseClient');

class GameManager {
  constructor() {
    this.rooms = new Map(); // Keep in-memory for speed, but sync with DB
    this.persistenceEnabled = !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
    this.presenterReconnectGraceMs = 3 * 60 * 1000;
    this.roomExpiredHandler = null;
  }

  setRoomExpiredHandler(handler) {
    this.roomExpiredHandler = handler;
  }

  async roomExists(roomId) {
    if (this.rooms.has(roomId)) return true;
    if (!this.persistenceEnabled) return false;

    try {
      const { data, error } = await supabase
        .from('rooms')
        .select('id')
        .eq('id', roomId)
        .maybeSingle();

      if (error) {
        console.error('Supabase Error (roomExists):', error);
        return false;
      }

      return !!data;
    } catch (err) {
      console.error('Supabase Error (roomExists):', err);
      return false;
    }
  }

  async generateRoomId(length = 4) {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    for (let attempt = 0; attempt < 25; attempt += 1) {
      let roomId = '';
      for (let i = 0; i < length; i += 1) {
        roomId += alphabet[Math.floor(Math.random() * alphabet.length)];
      }

      const exists = await this.roomExists(roomId);
      if (!exists) {
        return roomId;
      }
    }

    throw new Error('Failed to generate a unique room ID');
  }

  getValidMarkedCount(room, player) {
    if (!room || !player || !Array.isArray(player.markedIndexes) || !Array.isArray(player.card)) {
      return 0;
    }

    const playedSet = new Set((room.playedSongs || []).map((songId) => String(songId)));
    return player.markedIndexes.reduce((count, index) => {
      const cardSong = player.card?.[index];
      if (!cardSong?.songId) return count;
      return playedSet.has(String(cardSong.songId)) ? count + 1 : count;
    }, 0);
  }

  getPlayersProgress(room) {
    return room.players.map((player) => ({
      id: player.id,
      name: player.name,
      markedCount: this.getValidMarkedCount(room, player),
      cardSize: 16,
      isConnected: player.isConnected,
      hasLine: player.hasLine,
      hasBingo: player.hasBingo
    }));
  }

  getConnectedPlayers(room) {
    if (!room || !Array.isArray(room.players)) return [];
    return room.players.filter((player) => player.isConnected !== false);
  }

  getPresenterState(room) {
    return {
      roomId: room.id,
      gameState: room.status === 'PLAYING' ? 'PLAYING' : room.status === 'FINISHED' ? 'FINISHED' : 'WAITING',
      roomStatus: room.status,
      players: room.players,
      playlist: room.playlist || null,
      playedSongs: Array.isArray(room.playedSongsDetailed) ? room.playedSongsDetailed : [],
      currentSong: room.currentSong || null,
      winner: room.players.find((player) => player.hasBingo) || null,
      lineWinnerName: room.players.find((player) => player.hasLine)?.name || null,
      playersProgress: this.getPlayersProgress(room),
      hideSongInfo: !!room.hideSongInfo,
      presenterConnected: room.presenterConnected !== false,
      presenterReconnectDeadline: room.presenterReconnectDeadline || null
    };
  }

  schedulePresenterRoomExpiry(room) {
    if (room.destroyTimeout) {
      clearTimeout(room.destroyTimeout);
    }

    room.presenterReconnectDeadline = Date.now() + this.presenterReconnectGraceMs;
    room.destroyTimeout = setTimeout(() => {
      this.rooms.delete(room.id);
      if (typeof this.roomExpiredHandler === 'function') {
        this.roomExpiredHandler(room.id);
      }
    }, this.presenterReconnectGraceMs);
  }

  clearPresenterRoomExpiry(room) {
    if (room.destroyTimeout) {
      clearTimeout(room.destroyTimeout);
      room.destroyTimeout = null;
    }
    room.presenterReconnectDeadline = null;
  }

  async createRoom(roomId, presenterSocketId, presenterSessionId) {
    const finalRoomId = roomId || await this.generateRoomId();
    const roomData = {
      id: finalRoomId,
      presenter: presenterSocketId,
      presenterSessionId,
      presenterConnected: true,
      presenterReconnectDeadline: null,
      destroyTimeout: null,
      status: 'WAITING',
      hideSongInfo: false,
      players: [],
      playedSongs: [],
      playedSongsDetailed: [],
      currentSong: null,
    };
    
    this.rooms.set(finalRoomId, roomData);

    if (this.persistenceEnabled) {
      try {
        await supabase
          .from('players')
          .delete()
          .eq('room_id', finalRoomId);

        const { error } = await supabase
          .from('rooms')
          .upsert({ 
            id: finalRoomId, 
            status: 'WAITING', 
            host_id: presenterSocketId,
            line_locked: false,
            playlist_data: [],
            played_songs_ids: [],
            current_song: null
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
            presenter: dbRoom.host_id,
            presenterConnected: true,
            presenterSessionId: null,
            presenterReconnectDeadline: null,
            destroyTimeout: null,
            playlist: dbRoom.playlist_data || [],
            playedSongs: dbRoom.played_songs_ids || [],
            playedSongsDetailed: [],
            currentSong: dbRoom.current_song,
            lineLocked: dbRoom.line_locked,
            hideSongInfo: false,
            players: (dbPlayers || []).map(p => ({
              id: p.id,
              name: p.nickname,
              socketId: p.socket_id,
              isConnected: p.is_connected,
              card: p.card_data || [],
              markedIndexes: p.marked_cells || [],
              hasLine: p.has_line,
              hasBingo: p.has_bingo,
              markedCount: 0,
              lineAttempts: p.line_attempts ?? 3,
              bingoAttempts: p.bingo_attempts ?? 3
            }))
          };
          room.players = room.players.map((player) => ({
            ...player,
            markedCount: this.getValidMarkedCount(room, player),
          }));
          this.rooms.set(roomId, room);
          return room;
        }
      } catch (err) {
        console.error('Supabase Error (getRoom):', err);
      }
    }
    return null;
  }

  async reconnectPresenter(roomId, presenterSessionId, socketId) {
    const room = await this.getRoom(roomId);
    if (!room) return { error: 'Room not found' };
    if (!room.presenterSessionId || room.presenterSessionId !== presenterSessionId) {
      return { error: 'Presenter session not valid' };
    }

    room.presenter = socketId;
    room.presenterConnected = true;
    this.clearPresenterRoomExpiry(room);

    if (this.persistenceEnabled) {
      try {
        await supabase
          .from('rooms')
          .update({ host_id: socketId })
          .eq('id', roomId);
      } catch (err) {
        console.error('Supabase Error (reconnectPresenter):', err);
      }
    }

    return { room };
  }

  async joinRoom(roomId, player) {
    const room = await this.getRoom(roomId);
    if (!room) return { error: 'Room not found' };

    console.log(`[JoinRoom] Attempt: ${player.name} (${player.id}) in ${roomId}. Status: ${room.status}. Reconnecting: ${!!player.isReconnecting}`);

    // 1. Look for existing player in this room record
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

    // 2. If game is in progress and NO playerId provided, error
    if (room.status !== 'WAITING' && !player.isReconnecting) {
      return { error: 'Game already in progress' };
    }

    // 3. Fallback: Initialize new session for this player (Late joiner or hydrate miss)
    let newPlayer = {
      id: player.id || Math.random().toString(36).substring(2, 9),
      name: player.name,
      socketId: player.socketId,
      isConnected: true,
      card: [], 
      markedIndexes: [],
      hasLine: false,
      hasBingo: false,
      markedCount: 0,
      lineAttempts: 3,
      bingoAttempts: 3
    };
    
    // Safety: If joining late while game has started, assign a card so they aren't empty
    if (room.status !== 'WAITING' && room.playlist && room.playlist.length > 0) {
      try {
        newPlayer.card = generateBingoCard(room.playlist, 16);
      } catch (err) {
        console.error('Late joiner card generation error:', err);
      }
    }
    
    room.players.push(newPlayer);

    if (this.persistenceEnabled) {
      try {
        const { error } = await supabase
          .from('players')
          .upsert({
            id: newPlayer.id,
            room_id: roomId,
            nickname: newPlayer.name,
            socket_id: newPlayer.socketId,
            is_connected: true,
            last_seen: new Date().toISOString(),
            card_data: newPlayer.card
          });
        if (error) console.error('Supabase Error (joinRoom persistence):', error.message);
      } catch (err) {
        console.error('Supabase Error (joinRoom persistence):', err);
      }
    }

    return { room, player: newPlayer };
  }

  async updatePlayerMarked(roomId, playerId, markedIndexes) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const player = room.players.find(p => p.id === playerId);
    if (!player) return;

    player.markedIndexes = Array.isArray(markedIndexes) ? markedIndexes : [];
    player.markedCount = this.getValidMarkedCount(room, player);

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
        room.presenterConnected = false;
        room.presenter = null;
        this.schedulePresenterRoomExpiry(room);
        return {
          roomId,
          room,
          presenterDisconnected: true,
          reconnectDeadline: room.presenterReconnectDeadline
        };
      }
    }
    return null;
  }

  async closeRoom(roomId, presenterSessionId) {
    const room = await this.getRoom(roomId);
    if (!room) return { error: 'Room not found' };
    if (room.presenterSessionId && presenterSessionId && room.presenterSessionId !== presenterSessionId) {
      return { error: 'Presenter session not valid' };
    }

    if (room.destroyTimeout) {
      clearTimeout(room.destroyTimeout);
    }
    this.rooms.delete(roomId);

    if (this.persistenceEnabled) {
      try {
        await supabase.from('players').delete().eq('room_id', roomId);
        await supabase.from('rooms').delete().eq('id', roomId);
      } catch (err) {
        console.error('Supabase Error (closeRoom):', err);
      }
    }

    return { roomId };
  }

  async startGame(roomId, playlist) {
    const room = this.rooms.get(roomId);
    if (!room) return { error: 'Room not found' };

    const connectedPlayers = this.getConnectedPlayers(room);
    if (connectedPlayers.length === 0) {
      return { error: 'Wait for at least 1 connected player to join' };
    }

    room.status = 'PLAYING';
    room.playlist = playlist;
    room.playedSongs = [];
    room.playedSongsDetailed = [];
    room.currentSong = null;
    room.hideSongInfo = false;
    
    // Generate unique cards for all players
    const updates = [];
    connectedPlayers.forEach(player => {
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
    room.playedSongsDetailed.push(song);
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

  async setHideSongInfo(roomId, hideSongInfo) {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    room.hideSongInfo = !!hideSongInfo;
    return room;
  }
}

module.exports = new GameManager();
