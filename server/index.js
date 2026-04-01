const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const spotifyApi = require('./spotifyApi');
const presetPlaylists = require('./presetPlaylists');

app.get('/api/spotify/login-url', (req, res) => {
  try {
    const url = spotifyApi.getAuthorizationUrl();
    res.json({ url });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/spotify/playlist/:id', async (req, res) => {
  try {
    const playlistId = req.params.id;
    const playlistData = await spotifyApi.getPlaylist(playlistId);
    res.json(playlistData);
  } catch (error) {
    console.error('Spotify API Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/spotify/preset-playlists', async (req, res) => {
  try {
    const playlists = await Promise.all(
      presetPlaylists.map(async (preset) => {
        const playlistData = await spotifyApi.getPlaylist(preset.id);
        return {
          id: preset.id,
          url: preset.url,
          name: playlistData.name,
          image: playlistData.images?.[0]?.url || null,
          trackCount: playlistData.tracks.length
        };
      })
    );

    res.json({ playlists });
  } catch (error) {
    console.error('Preset playlists error:', error.message);
    res.status(500).json({ error: 'Failed to fetch preset playlists' });
  }
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const gameManager = require('./gameManager');
const { checkWin } = require('./bingoUtils');

gameManager.setRoomExpiredHandler((roomId) => {
  io.to(roomId).emit('roomDestroyed');
});

gameManager.setSongRevealHandler((roomId, song) => {
  io.to(roomId).emit('newSongPlayed', { song });
  const room = gameManager.rooms.get(roomId);
  if (room) {
    io.to(roomId).emit('screenRoomState', gameManager.getPresenterState(room));
  }
});

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // ---> Presenter Events <---
  socket.on('createRoom', async ({ presenterSessionId }) => {
    const room = await gameManager.createRoom(null, socket.id, presenterSessionId);
    socket.join(room.id);
    socket.emit('roomCreated', { roomId: room.id });
  });

  socket.on('reconnectPresenter', async ({ roomId, presenterSessionId }) => {
    const result = await gameManager.reconnectPresenter(roomId, presenterSessionId, socket.id);
    if (result?.error) {
      return socket.emit('presenterReconnectFailed', { message: result.error });
    }

    socket.join(roomId);
    socket.emit('presenterRoomState', gameManager.getPresenterState(result.room));
    io.to(roomId).emit('presenterReconnected');
  });

  socket.on('closeRoom', async ({ roomId, presenterSessionId }) => {
    const result = await gameManager.closeRoom(roomId, presenterSessionId);
    if (result?.error) return socket.emit('error', result.error);
    io.to(roomId).emit('roomDestroyed');
  });

  socket.on('screenJoinRoom', async ({ roomId }) => {
    const room = await gameManager.getRoom(roomId);
    if (!room) {
      return socket.emit('screenJoinFailed', { message: 'Room not found' });
    }

    socket.join(roomId);
    socket.emit('screenRoomState', gameManager.getPresenterState(room));
  });

  socket.on('startGame', async ({ roomId, playlist }) => {
    const room = await gameManager.startGame(roomId, playlist);
    if (room.error) return socket.emit('error', room.error);

    room.players.forEach(p => {
      if (p.socketId) {
        io.to(p.socketId).emit('gameStarted', { card: p.card });
      }
    });

    socket.emit('gameStartedPresenter', { players: room.players });
    io.to(roomId).emit('screenRoomState', gameManager.getPresenterState(room));
  });

  socket.on('playNextSong', async ({ roomId, song, countdownMs = 1800 }) => {
    const result = await gameManager.scheduleNextSong(roomId, song, countdownMs);
    if (result?.error) return socket.emit('error', result.error);

    io.to(roomId).emit('songCountdownStarted', {
      song,
      countdownMs,
      revealAt: result.revealAt,
    });
  });

  socket.on('setHideSongInfo', async ({ roomId, hideSongInfo }) => {
    const room = await gameManager.setHideSongInfo(roomId, hideSongInfo);
    if (!room) return;
    io.to(roomId).emit('hideSongInfoChanged', { hideSongInfo: room.hideSongInfo });
  });

  // ---> Player Events <---
  socket.on('joinRoom', async ({ roomId, playerName, playerId }) => {
    const pId = playerId || Math.random().toString(36).substring(2, 9);

    const result = await gameManager.joinRoom(roomId, {
      id: pId,
      name: playerName,
      socketId: socket.id,
      isReconnecting: !!playerId
    });

    if (result.error) {
      return socket.emit('joinError', { message: result.error });
    }

    socket.join(roomId);
    socket.emit('joinSuccess', {
      player: result.player,
      roomId,
      reconnect: !!result.reconnect,
      lineAttempts: result.player.lineAttempts ?? 3,
      bingoAttempts: result.player.bingoAttempts ?? 3
    });

    if (result.room.status === 'PLAYING') {
      socket.emit('gameStarted', {
        card: result.player.card,
        markedIndexes: result.player.markedIndexes || [],
        currentSong: result.room.currentSong,
        hasLine: result.player.hasLine,
        hasBingo: result.player.hasBingo,
        roomLineClaimed: result.room.lineLocked,
        lineAttempts: result.player.lineAttempts ?? 3,
        bingoAttempts: result.player.bingoAttempts ?? 3
      });
    }

    io.to(roomId).emit('playerJoined', { player: result.player, players: result.room.players });
    io.to(roomId).emit('screenRoomState', gameManager.getPresenterState(result.room));
  });

  socket.on('updateProgress', async ({ roomId, playerId, markedIndexes }) => {
    const rId = roomId ? roomId.toUpperCase() : '';
    const room = await gameManager.getRoom(rId);
    if (!room) return;

    await gameManager.updatePlayerMarked(rId, playerId, markedIndexes);

    const progressData = gameManager.getPlayersProgress(room);
    io.to(rId).emit('playersProgress', { players: progressData });
  });

  socket.on('claimWin', async ({ roomId, playerId, markedIndexes, type }) => {
    const rId = roomId ? roomId.toUpperCase() : '';
    const room = await gameManager.getRoom(rId);
    if (!room) return;

    const player = room.players.find(p => p.id === playerId);
    if (!player) return;

    // ── FIX: Si el jugador ya tiene línea/bingo válido, no procesar de nuevo ──
    if (type === 'LINE' && player.hasLine) {
      socket.emit('winInvalid', { reason: 'ALREADY_CLAIMED', type });
      return;
    }
    if (type === 'BINGO' && player.hasBingo) {
      socket.emit('winInvalid', { reason: 'ALREADY_CLAIMED', type });
      return;
    }

    // ── FIX: Línea ya reclamada por otro jugador ──────────────────────────────
    if (type === 'LINE' && room.lineLocked) {
      socket.emit('winInvalid', { reason: 'LINE_ALREADY_TAKEN', type });
      return;
    }

    // ── Check intentos ────────────────────────────────────────────────────────
    const attempts = type === 'LINE' ? (player.lineAttempts ?? 3) : (player.bingoAttempts ?? 3);
    if (attempts <= 0) {
      socket.emit('winInvalid', { reason: 'OUT_OF_ATTEMPTS', type });
      return;
    }

    const marks = Array.isArray(markedIndexes) ? markedIndexes.map(Number) : [];
    const result = checkWin(player.card, room.playedSongs, marks, type);

    if (result.success) {
      await gameManager.setWinState(rId, playerId, type);
      if (type === 'BINGO') {
        io.to(rId).emit('bingoWinner', { player });
      } else {
        io.to(rId).emit('lineWinner', { player });
      }
    } else {
      // Restar intento
      if (type === 'LINE') player.lineAttempts = (player.lineAttempts ?? 3) - 1;
      else player.bingoAttempts = (player.bingoAttempts ?? 3) - 1;

      // Persistir intentos si está habilitado
      if (gameManager.persistenceEnabled) {
        const supabase = gameManager.supabase;
        if (supabase) {
          supabase.from('players').update({
            line_attempts: player.lineAttempts,
            bingo_attempts: player.bingoAttempts
          }).eq('id', playerId).then(({ error }) => {
            if (error) console.error('Error persisting attempts:', error);
          });
        }
      }

      socket.emit('winInvalid', {
        reason: result.reason,
        invalidIndexes: result.invalidIndexes,
        type,
        attemptsLeft: type === 'LINE' ? player.lineAttempts : player.bingoAttempts
      });
    }
  });

  socket.on('disconnect', async () => {
    const result = await gameManager.disconnectPlayer(socket.id);
    if (result) {
      if (result.presenterDisconnected) {
        io.to(result.roomId).emit('presenterDisconnected', {
          reconnectDeadline: result.reconnectDeadline
        });
      } else {
        io.to(result.roomId).emit('playerLeft', {
          playerId: result.player.id,
          players: result.room.players
        });
        io.to(result.roomId).emit('screenRoomState', gameManager.getPresenterState(result.room));
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);

  const selfUrl = process.env.RENDER_EXTERNAL_URL || process.env.BACKEND_URL;
  if (selfUrl) {
    setInterval(async () => {
      try {
        await fetch(`${selfUrl}/health`);
      } catch (err) { }
    }, 4 * 60 * 1000);
  }
});
