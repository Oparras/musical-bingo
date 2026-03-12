const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

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
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const gameManager = require('./gameManager');
const { checkBingo } = require('./bingoUtils');

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

  socket.on('claimBingo', ({ roomId }) => {
    const room = gameManager.getRoom(roomId);
    if (!room) return;

    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) return;

    const isBingoValid = checkBingo(player.card, room.playedSongs);

    if (isBingoValid) {
      room.status = 'FINISHED';
      io.to(roomId).emit('bingoWinner', { player });
    } else {
      socket.emit('bingoFalseAlarm');
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
});
