const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const spotifyApi = require('./spotifyApi');

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

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const gameManager = require('./gameManager');
const { checkWin } = require('./bingoUtils');

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // ---> Presenter Events <---
  socket.on('createRoom', async ({ roomId }) => {
    await gameManager.createRoom(roomId, socket.id);
    socket.join(roomId);
    socket.emit('roomCreated', { roomId });
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
  });

  socket.on('playNextSong', async ({ roomId, song }) => {
    await gameManager.nextSong(roomId, song);
    io.to(roomId).emit('newSongPlayed', { song });
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
  });

  socket.on('updateProgress', async ({ roomId, playerId, markedIndexes }) => {
    const rId = roomId ? roomId.toUpperCase() : '';
    const room = await gameManager.getRoom(rId);
    if (!room) return;

    await gameManager.updatePlayerMarked(rId, playerId, markedIndexes);

    const progressData = room.players.map(p => ({
      id: p.id,
      name: p.name,
      markedCount: p.markedCount || 0,
      cardSize: 16,
      isConnected: p.isConnected,
      hasLine: p.hasLine,
      hasBingo: p.hasBingo
    }));
    io.to(room.presenter).emit('playersProgress', { players: progressData });
  });

  socket.on('claimWin', async ({ roomId, playerId, markedIndexes, type }) => {
    const rId = roomId ? roomId.toUpperCase() : '';
    const room = await gameManager.getRoom(rId);
    if (!room) return;

    const player = room.players.find(p => p.id === playerId);
    if (!player) return;

    const marks = Array.isArray(markedIndexes) ? markedIndexes.map(Number) : [];
    const result = checkWin(player.card, room.playedSongs, marks, type);

    if (type === 'LINE' && (player.hasLine || room.lineLocked)) {
       if (result.success === false || result.reason !== 'INVALID_MARKS') return;
    }

    // --- Check Attempts ---
    const attempts = type === 'LINE' ? (player.lineAttempts ?? 3) : (player.bingoAttempts ?? 3);
    if (attempts <= 0) {
      socket.emit('winInvalid', { reason: 'OUT_OF_ATTEMPTS', type });
      return;
    }

    if (result.success) {
      await gameManager.setWinState(rId, playerId, type);
      if (type === 'BINGO') {
        io.to(rId).emit('bingoWinner', { player });
      } else {
        io.to(rId).emit('lineWinner', { player });
      }
    } else {
      // Subtract attempt
      if (type === 'LINE') player.lineAttempts = (player.lineAttempts || 3) - 1;
      else player.bingoAttempts = (player.bingoAttempts || 3) - 1;

      // Persist attempts to Supabase
      if (gameManager.persistenceEnabled) {
         supabase.from('players').update({
            line_attempts: player.lineAttempts,
            bingo_attempts: player.bingoAttempts
         }).eq('id', playerId).then(({error}) => {
            if(error) console.error('Error persisting attempts:', error);
         });
      }

      socket.emit('winInvalid', { 
        reason: result.reason, 
        invalidIndexes: result.invalidIndexes, // Restoration of the unmark feature!
        type,
        attemptsLeft: type === 'LINE' ? player.lineAttempts : player.bingoAttempts
      });
    }
  });

  socket.on('disconnect', async () => {
    const result = await gameManager.disconnectPlayer(socket.id);
    if (result) {
      if (result.roomDestroyed) {
        io.to(result.roomId).emit('roomDestroyed');
      } else {
        io.to(result.roomId).emit('playerLeft', { 
          playerId: result.player.id,
          players: result.room.players 
        });
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
      } catch (err) {}
    }, 4 * 60 * 1000);
  }
});