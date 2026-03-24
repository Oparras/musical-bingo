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
  socket.on('createRoom', ({ roomId }) => {
    gameManager.createRoom(roomId, socket.id);
    socket.join(roomId);
    console.log(`Room ${roomId} created by ${socket.id}`);
    socket.emit('roomCreated', { roomId });
  });

  socket.on('startGame', ({ roomId, playlist }) => {
    const room = gameManager.startGame(roomId, playlist);
    if (room.error) return socket.emit('error', room.error);

    // Send each player their unique card
    room.players.forEach(p => {
      io.to(p.socketId).emit('gameStarted', { card: p.card });
    });
    
    // Notify presenter of the final list and status update
    socket.emit('gameStartedPresenter', { players: room.players });
  });

  socket.on('playNextSong', ({ roomId, song }) => {
    const room = gameManager.getRoom(roomId);
    if (!room) return;
    
    room.playedSongs.push(song.id);
    room.currentSong = song;
    
    io.to(roomId).emit('newSongPlayed', { song });
  });

  // ---> Player Events <---
  socket.on('joinRoom', ({ roomId, playerName }) => {
    const playerId = Math.random().toString(36).substring(2, 9);
    const result = gameManager.joinRoom(roomId, { id: playerId, name: playerName, socketId: socket.id });
    
    if (result.error) {
      return socket.emit('joinError', { message: result.error });
    }

    socket.join(roomId);
    socket.emit('joinSuccess', { player: result.player, roomId });
    
    // Notify room (Presenter) that a new player joined
    io.to(roomId).emit('playerJoined', { player: result.player, players: result.room.players });
  });

  // Player sends their current marked indexes so server can track progress
  socket.on('updateProgress', ({ roomId, markedIndexes }) => {
    const rId = roomId ? roomId.toUpperCase() : '';
    const room = gameManager.getRoom(rId);
    if (!room) return;

    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) return;

    // Update the player's marked songs count for analytics
    player.markedCount = Array.isArray(markedIndexes) ? markedIndexes.length : 0;

    // Broadcast updated progress to presenter
    const presenterSocket = room.presenter;
    const progressData = room.players.map(p => ({
      id: p.id,
      name: p.name,
      markedCount: p.markedCount || 0,
      cardSize: 16,
      hasLine: p.hasLine || false,
      hasBingo: p.hasBingo || false,
    }));
    io.to(presenterSocket).emit('playersProgress', { players: progressData });
  });

  socket.on('claimWin', ({ roomId, markedIndexes, type }) => {
    const rId = roomId ? roomId.toUpperCase() : '';
    const room = gameManager.getRoom(rId);
    
    if (!room) {
      console.log(`[ClaimWin] Room not found: ${rId}`);
      return;
    }

    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) return;

    console.log(`[ClaimWin] ${player.name} claiming ${type} in ${rId}. Marks:`, markedIndexes);

    // --- Anti-duplicate checks ---
    if (type === 'LINE') {
      // If this player already has a line, reject silently
      if (player.hasLine) {
        console.log(`[ClaimWin] ${player.name} already has LINE - ignoring duplicate`);
        socket.emit('winInvalid', { reason: 'ALREADY_CLAIMED_LINE', type });
        return;
      }
      // If room already has a line winner and we are in strict mode, reject
      // (we allow multiple line winners but prevent same player spamming)
      if (room.lineLocked) {
        console.log(`[ClaimWin] Line already locked in room ${rId} - ignoring`);
        socket.emit('winInvalid', { reason: 'LINE_ALREADY_CLAIMED', type });
        return;
      }
    }

    if (type === 'BINGO') {
      if (player.hasBingo) {
        console.log(`[ClaimWin] ${player.name} already has BINGO - ignoring duplicate`);
        return;
      }
    }

    const marks = Array.isArray(markedIndexes) ? markedIndexes.map(Number) : [];
    const result = checkWin(player.card, room.playedSongs, marks, type);

    console.log(`[ClaimWin] Validation Result for ${player.name}:`, result);

    if (result.success) {
      if (type === 'BINGO') {
        player.hasBingo = true;
        room.status = 'FINISHED';
        io.to(rId).emit('bingoWinner', { player });
      } else {
        // LINE: mark player as having a line, lock room line so nobody else can claim
        player.hasLine = true;
        room.lineLocked = true;

        // Notify ALL players (so everyone gets the popup)
        io.to(rId).emit('lineWinner', { player });

        // After 30 seconds, unlock line so next round can happen (optional reset)
        // room.lineLocked stays true until game ends or presenter resets
      }
    } else {
      socket.emit('winInvalid', { 
        reason: result.reason, 
        invalidIndexes: result.invalidIndexes,
        type
      });
    }
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    const result = gameManager.removePlayer(socket.id);
    if (result) {
      if (result.roomDestroyed) {
        io.to(result.roomId).emit('roomDestroyed');
      } else {
        io.to(result.roomId).emit('playerLeft', { players: result.room.players });
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
