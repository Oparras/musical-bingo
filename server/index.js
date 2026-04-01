const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Health check endpoint (used by UptimeRobot / self-ping to prevent Render sleep)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), rooms: 'in-memory' });
});

const spotifyApi = require('./spotifyApi');

// -> REST API Routes <-
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
    origin: (origin, callback) => {
      // Allow local dev, all vercel.app subdomains, and direct access
      const allowed = !origin || 
        origin.includes('localhost') || 
        origin.includes('127.0.0.1') || 
        origin.includes('vercel.app') ||
        origin.includes('netlify.app') ||
        (process.env.FRONTEND_URL && origin === process.env.FRONTEND_URL);
      callback(null, allowed);
    },
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
    console.log(`Room ${roomId} created by ${socket.id}`);
    socket.emit('roomCreated', { roomId });
  });

  socket.on('startGame', async ({ roomId, playlist }) => {
    const room = await gameManager.startGame(roomId, playlist);
    if (room.error) return socket.emit('error', room.error);

    // Send each player their unique card
    room.players.forEach(p => {
      if (p.socketId) {
        io.to(p.socketId).emit('gameStarted', { card: p.card });
      }
    });
    
    // Notify presenter of the final list and status update
    socket.emit('gameStartedPresenter', { players: room.players });
  });

  socket.on('playNextSong', async ({ roomId, song }) => {
    await gameManager.nextSong(roomId, song);
    io.to(roomId).emit('newSongPlayed', { song });
  });

  // ---> Player Events <---
  socket.on('joinRoom', async ({ roomId, playerName, playerId }) => {
    // If no playerId provided, generate one
    const pId = playerId || Math.random().toString(36).substring(2, 9);
    const result = await gameManager.joinRoom(roomId, { id: pId, name: playerName, socketId: socket.id });
    
    if (result.error) {
      return socket.emit('joinError', { message: result.error });
    }

    socket.join(roomId);
    socket.emit('joinSuccess', { 
      player: result.player, 
      roomId,
      reconnect: !!result.reconnect
    });
    
    // If it's a reconnection during a running game, send them their card and state immediately.
    if (result.room.status === 'PLAYING') {
      socket.emit('gameStarted', { 
        card: result.player.card,
        markedIndexes: result.player.markedIndexes || [],
        currentSong: result.room.currentSong,
        hasLine: result.player.hasLine,
        hasBingo: result.player.hasBingo,
        roomLineClaimed: result.room.lineLocked
      });
    }

    // Notify room (Presenter) that a new player joined
    io.to(roomId).emit('playerJoined', { player: result.player, players: result.room.players });
  });

  // Player sends their current marked indexes so server can track progress
  socket.on('updateProgress', async ({ roomId, playerId, markedIndexes }) => {
    const rId = roomId ? roomId.toUpperCase() : '';
    const room = gameManager.getRoom(rId);
    if (!room) return;

    await gameManager.updatePlayerMarked(rId, playerId, markedIndexes);

    // Broadcast updated progress to presenter
    const presenterSocket = room.presenter;
    const progressData = room.players.map(p => ({
      id: p.id,
      name: p.name,
      markedCount: p.markedCount || 0,
      cardSize: 16,
      hasLine: p.hasLine || false,
      hasBingo: p.hasBingo || false,
      isConnected: p.isConnected
    }));
    io.to(presenterSocket).emit('playersProgress', { players: progressData });
  });

  socket.on('claimWin', async ({ roomId, playerId, markedIndexes, type }) => {
    const rId = roomId ? roomId.toUpperCase() : '';
    const room = gameManager.getRoom(rId);
    
    if (!room) {
      console.log(`[ClaimWin] Room not found: ${rId}`);
      return;
    }

    const player = room.players.find(p => p.id === playerId);
    if (!player) return;

    console.log(`[ClaimWin] ${player.name} claiming ${type} in ${rId}. Marks:`, markedIndexes);

    const marks = Array.isArray(markedIndexes) ? markedIndexes.map(Number) : [];
    const result = checkWin(player.card, room.playedSongs, marks, type);

    // --- Anti-duplicate checks ---
    if (type === 'LINE') {
      if (player.hasLine) {
        socket.emit('winInvalid', { reason: 'ALREADY_CLAIMED_LINE', type });
        return;
      }
      if (room.lineLocked && result.reason !== 'INVALID_MARKS') {
        socket.emit('winInvalid', { reason: 'LINE_ALREADY_CLAIMED', type });
        return;
      }
    }

    if (type === 'BINGO') {
      if (player.hasBingo) return;
    }

    if (result.success) {
      await gameManager.setWinState(rId, playerId, type);
      if (type === 'BINGO') {
        io.to(rId).emit('bingoWinner', { player });
      } else {
        io.to(rId).emit('lineWinner', { player });
      }
    } else {
      socket.emit('winInvalid', { 
        reason: result.reason, 
        invalidIndexes: result.invalidIndexes,
        type
      });
    }
  });

  socket.on('disconnect', async () => {
    console.log(`User disconnected: ${socket.id}`);
    const result = await gameManager.disconnectPlayer(socket.id);
    if (result) {
      if (result.roomDestroyed) {
        // Option: Wait a bit before destroying room too? 
        // For now keep immediate room destruction if presenter leaves.
        io.to(result.roomId).emit('roomDestroyed');
      } else {
        // For players, we broadcast they are "disconnected" but keep them in the list
        io.to(result.roomId).emit('playerLeft', { 
          playerId: result.player.id,
          players: result.room.players 
        });

        // Grace period: if they don't reconnect in 60 seconds, we could remove them 
        // but for persistence it's better to just leave them as "disconnected"
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);

  // --- Keep-alive self-ping (prevents Render free tier from sleeping) ---
  const selfUrl = process.env.RENDER_EXTERNAL_URL || process.env.BACKEND_URL;
  if (selfUrl) {
    const PING_INTERVAL_MS = 4 * 60 * 1000; // every 4 minutes
    setInterval(async () => {
      try {
        const url = `${selfUrl}/health`;
        const res = await fetch(url);
        const data = await res.json();
        console.log(`[Keep-alive] Ping OK at ${data.timestamp}`);
      } catch (err) {
        console.warn('[Keep-alive] Ping failed:', err.message);
      }
    }, PING_INTERVAL_MS);
    console.log(`[Keep-alive] Self-ping active every 4 minutes → ${selfUrl}/health`);
  } else {
    console.log('[Keep-alive] No RENDER_EXTERNAL_URL or BACKEND_URL set - self-ping disabled (local dev)');
  }
});
