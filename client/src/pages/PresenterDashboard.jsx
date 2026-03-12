import React, { useState, useEffect, useRef } from 'react';
import { useSocket } from '../context/SocketContext';
import { useNavigate } from 'react-router-dom';

// Spotify Client ID (Hardcoded for frontend PKCE flow purely for the player)
const SPOTIFY_CLIENT_ID = 'cba7c38ccc6e48e8ad01a3177e95f7ab'; 
// Spotify requires explicit loopback IP (127.0.0.1) instead of localhost for HTTP development
const isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const SPOTIFY_REDIRECT_URI = isLocalDev 
  ? 'http://127.0.0.1:5173/presenter/dashboard' 
  : `${window.location.origin}/presenter/dashboard`;

// PKCE Helper Functions
const generateRandomString = (length) => {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const values = crypto.getRandomValues(new Uint8Array(length));
  return values.reduce((acc, x) => acc + possible[x % possible.length], "");
}

const sha256 = async (plain) => {
  const encoder = new TextEncoder()
  const data = encoder.encode(plain)
  return window.crypto.subtle.digest('SHA-256', data)
}

const base64encode = (input) => {
  return btoa(String.fromCharCode(...new Uint8Array(input)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export default function PresenterDashboard() {
  const socket = useSocket();
  const navigate = useNavigate();

  const [spotifyToken, setSpotifyToken] = useState(null);
  const [deviceId, setDeviceId] = useState(null);
  const [playerLoading, setPlayerLoading] = useState(false);
  const playerRef = useRef(null);

  const [roomId, setRoomId] = useState('');
  const [playlistUrl, setPlaylistUrl] = useState('');
  const [gameState, setGameState] = useState('SETUP'); 
  const [players, setPlayers] = useState([]);
  const [playlist, setPlaylist] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [playedSongs, setPlayedSongs] = useState([]);
  const [currentSong, setCurrentSong] = useState(null);
  const [winner, setWinner] = useState(null);

  // --- SPOTIFY PKCE AUTH FLOW ---
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    let code = urlParams.get('code');
    let storedToken = window.localStorage.getItem('spotify_presenter_token');

    const exchangeToken = async (code) => {
      let codeVerifier = window.localStorage.getItem('code_verifier');
      try {
        const payload = {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            client_id: SPOTIFY_CLIENT_ID,
            grant_type: 'authorization_code',
            code,
            redirect_uri: SPOTIFY_REDIRECT_URI,
            code_verifier: codeVerifier,
          }),
        }
        const body = await fetch('https://accounts.spotify.com/api/token', payload);
        const response = await body.json();
        
        if (response.access_token) {
          window.localStorage.setItem('spotify_presenter_token', response.access_token);
          setSpotifyToken(response.access_token);
          // Clean up URL
          window.history.replaceState({}, document.title, window.location.pathname);
        } else {
          setError('Failed to exchange auth code. Refresh and try again.');
        }
      } catch (err) {
        console.error("Token exchange err", err);
      }
    };

    if (code && !storedToken) {
      // We are returning from Spotify Auth
      exchangeToken(code);
    } else if (storedToken) {
      setSpotifyToken(storedToken);
    }
  }, []);

  const handleSpotifyLogin = async () => {
    const codeVerifier  = generateRandomString(64);
    window.localStorage.setItem('code_verifier', codeVerifier);
    const hashed = await sha256(codeVerifier);
    const codeChallenge = base64encode(hashed);

    const scope = 'streaming user-read-email user-read-private user-modify-playback-state';
    const authUrl = new URL("https://accounts.spotify.com/authorize")

    window.localStorage.removeItem('spotify_presenter_token'); // Clear old token
    
    authUrl.search = new URLSearchParams({
      response_type: 'code',
      client_id: SPOTIFY_CLIENT_ID,
      scope,
      code_challenge_method: 'S256',
      code_challenge: codeChallenge,
      redirect_uri: SPOTIFY_REDIRECT_URI,
    }).toString();

    window.location.href = authUrl.toString();
  };
  // --------------------------------

  // Initialize Spotify Web Playback SDK if we have a token
  useEffect(() => {
    if (!spotifyToken || spotifyToken === 'skipped') return;

    setPlayerLoading(true);
    // Remove existing script if any to prevent duplicates during hot reloads
    const existingScript = document.getElementById('spotify-player-script');
    if (existingScript) existingScript.remove();

    const script = document.createElement('script');
    script.id = 'spotify-player-script';
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    script.async = true;
    document.body.appendChild(script);

    window.onSpotifyWebPlaybackSDKReady = () => {
      const player = new window.Spotify.Player({
        name: 'Musical Bingo Player',
        getOAuthToken: cb => { cb(spotifyToken); },
        volume: 0.8
      });

      player.addListener('ready', ({ device_id }) => {
        console.log('Ready with Device ID', device_id);
        setDeviceId(device_id);
        setPlayerLoading(false);
      });

      player.addListener('not_ready', ({ device_id }) => {
        console.log('Device ID has gone offline', device_id);
      });

      player.addListener('initialization_error', ({ message }) => { console.error("Init err:", message); setPlayerLoading(false); });
      player.addListener('authentication_error', ({ message }) => { 
        console.error("Auth err:", message); 
        window.localStorage.removeItem('spotify_presenter_token');
        setSpotifyToken(null);
        setPlayerLoading(false);
        setError("Spotify session expired. Please log in again.");
      });
      player.addListener('account_error', ({ message }) => { console.error("Account err:", message); setPlayerLoading(false); });

      player.connect();
      playerRef.current = player;
    };

    return () => {
      if (playerRef.current) {
        playerRef.current.disconnect();
      }
    };
  }, [spotifyToken]);

  // Socket Events
  useEffect(() => {
    if (!socket) return;
    socket.on('roomCreated', ({ roomId }) => { setRoomId(roomId); setGameState('WAITING'); });
    socket.on('playerJoined', ({ players }) => setPlayers(players));
    socket.on('playerLeft', ({ players }) => setPlayers(players));
    socket.on('gameStartedPresenter', ({ players }) => { setPlayers(players); setGameState('PLAYING'); });
    socket.on('bingoWinner', ({ player }) => { setWinner(player); setGameState('FINISHED'); });
    socket.on('error', (err) => { setError(err); setLoading(false); });
    return () => {
      socket.off('roomCreated'); socket.off('playerJoined'); socket.off('playerLeft');
      socket.off('gameStartedPresenter'); socket.off('bingoWinner'); socket.off('error');
    };
  }, [socket]);

  const handleCreateRoom = async () => {
    if (!playlistUrl) return setError('Please enter a Spotify Playlist URL');
    let pid = playlistUrl;
    const match = playlistUrl.match(/playlist\/([a-zA-Z0-9]+)/);
    if (match) pid = match[1];

    setLoading(true); setError(null);
    try {
      const defaultBackendUrl = `http://${window.location.hostname}:3001`;
      const backendUrl = import.meta.env.VITE_BACKEND_URL || defaultBackendUrl;
      const res = await fetch(`${backendUrl}/api/spotify/playlist/${pid}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch playlist');
      if (data.tracks.length < 16) throw new Error('Playlist needs at least 16 songs.');
      setPlaylist(data);
      const newRoomId = Math.random().toString(36).substring(2, 6).toUpperCase();
      socket.emit('createRoom', { roomId: newRoomId });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleStartGame = () => {
    if (players.length === 0) return setError('Wait for at least 1 player to join');
    socket.emit('startGame', { roomId, playlist: playlist.tracks });
  };

  const playSongOnSpotify = async (uri) => {
    if (!spotifyToken || !deviceId) return;
    try {
      await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${spotifyToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ uris: [uri] })
      });
    } catch (err) {
      console.error('Failed to play full track on Spotify:', err);
    }
  };

  const playNextSong = async () => {
    if (!playlist) return;
    const remaining = playlist.tracks.filter(t => !playedSongs.find(ps => ps.id === t.id));
    if (remaining.length === 0) return alert('No more songs in playlist!');

    const randomTrack = remaining[Math.floor(Math.random() * remaining.length)];
    setCurrentSong(randomTrack);
    setPlayedSongs(prev => [...prev, randomTrack]);
    socket.emit('playNextSong', { roomId, song: randomTrack });

    // --- PLAYBACK LOGIC ---
    
    // We attempt remote playback, but we won't block the UI.
    try {
      const playEndpoint = deviceId 
        ? `https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`
        : `https://api.spotify.com/v1/me/player/play`;

      if (spotifyToken && spotifyToken !== 'skipped') {
        const res = await fetch(playEndpoint, {
          method: 'PUT',
          body: JSON.stringify({ uris: [randomTrack.uri] }),
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${spotifyToken}` },
        });

        if (res.status === 404) {
          console.warn('No active Spotify device found. Ensure Spotify app is open.');
          // If remote play fails, we'll let the fallback 30s audio player show up in the UI
        }
      }
    } catch (e) {
      console.error('Playback command failed:', e);
    }
  };

  if (!spotifyToken) {
    return (
      <div className="glass-panel" style={{ maxWidth: '600px', margin: '15vh auto', textAlign: 'center' }}>
        <h2>Host a Game</h2>
        {error && <div style={{ color: '#ff4d4d', marginBottom: '1rem' }}>{error}</div>}
        <p style={{ margin: '2rem 0', color: 'var(--text-muted)' }}>
          Para reproducir las canciones enteras durante el juego, necesitas iniciar sesión con una cuenta de Spotify Premium. 
          Si no tienes, puedes saltar este paso, pero solo se escucharán fragmentos de 30 segundos de las canciones.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <button onClick={handleSpotifyLogin} style={{ background: '#1DB954' }}>
            Iniciar sesión con Spotify Premium
          </button>
          <button className="secondary" onClick={() => setSpotifyToken('skipped')}>
            Continuar sin Premium (solo Previews 30s)
          </button>
        </div>
      </div>
    );
  }

  if (gameState === 'SETUP') {
    return (
      <div className="glass-panel" style={{ maxWidth: '600px', margin: '10vh auto' }}>
        <h2>Configure Room</h2>
        {playerLoading && <div style={{ color: '#1DB954', marginBottom: '1rem' }}>Initializing Spotify Web Player...</div>}
        {deviceId && <div style={{ color: '#1DB954', marginBottom: '1rem' }}>✓ Spotify Premium Player Ready!</div>}
        {error && <div style={{ color: '#ff4d4d', marginBottom: '1rem', padding: '10px', background: 'rgba(255,0,0,0.1)', borderRadius: '8px' }}>{error}</div>}
        
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', margin: '1.5rem 0 0.5rem 0', color: 'var(--text-muted)' }}>
            Spotify Playlist URL
          </label>
          <input 
            type="text" 
            placeholder="https://open.spotify.com/playlist/..." 
            value={playlistUrl}
            onChange={(e) => setPlaylistUrl(e.target.value)}
          />
        </div>
        
        <button onClick={handleCreateRoom} disabled={loading} style={{ width: '100%', margin: '1.5rem 0' }}>
          {loading ? 'Fetching Playlist...' : 'Create Room'}
        </button>
      </div>
    );
  }

  if (gameState === 'WAITING') {
    return (
      <div className="glass-panel" style={{ maxWidth: '800px', margin: '5vh auto', textAlign: 'center' }}>
        <h2 className="text-gradient">Room Details</h2>
        <div style={{ margin: '2rem 0', padding: '2rem', background: 'var(--glass-bg)', borderRadius: '15px' }}>
          <p style={{ fontSize: '1.2rem', color: 'var(--text-muted)' }}>Players join at URL with PIN:</p>
          <h1 style={{ fontSize: '5rem', letterSpacing: '5px', margin: '10px 0' }}>{roomId}</h1>
        </div>
        
        <div style={{ background: 'var(--glass-bg)', padding: '1.5rem', borderRadius: '15px', marginBottom: '2rem' }}>
          <h3>Waiting Room ({players.length})</h3>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center', marginTop: '1rem', minHeight: '50px' }}>
            {players.length === 0 && <p style={{ color: 'var(--text-muted)' }}>Waiting for players to join...</p>}
            {players.map(p => (
              <span key={p.id} style={{ background: 'var(--primary-color)', padding: '8px 15px', borderRadius: '50px' }}>{p.name}</span>
            ))}
          </div>
        </div>

        {error && <div style={{ color: '#ff4d4d', marginBottom: '1rem' }}>{error}</div>}
        <button onClick={handleStartGame} style={{ fontSize: '1.2rem', padding: '15px 40px' }}>Start Game</button>
      </div>
    );
  }

  if (gameState === 'PLAYING') {
    const isMobile = window.innerWidth <= 768;
    return (
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr', 
        gap: '1rem', 
        height: isMobile ? 'auto' : 'calc(100vh - 120px)', 
        minHeight: 0 
      }}>
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
          <h2 style={{ fontSize: isMobile ? '1.2rem' : undefined }}>🎤 Presenter Controls</h2>
          
          <div style={{ flex: isMobile ? 'none' : 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--glass-bg)', borderRadius: '15px', padding: '1rem', margin: '1rem 0', overflowY: 'auto' }}>
            {currentSong ? (
              <>
                <div style={{ width: isMobile ? '140px' : '200px', height: isMobile ? '140px' : '200px', marginBottom: '1rem', borderRadius: '15px', overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.5)', flexShrink: 0 }}>
                  {currentSong.imageUrl ? (
                    <img src={currentSong.imageUrl} alt="Album" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <div style={{ width: '100%', height: '100%', background: 'var(--primary-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '3rem' }}>🎵</div>
                  )}
                </div>
                <h2 style={{ textAlign: 'center', marginBottom: '5px', fontSize: isMobile ? '1.1rem' : '1.5rem' }}>{currentSong.name}</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: isMobile ? '0.9rem' : '1.2rem', marginBottom: '0.5rem' }}>{currentSong.artist}</p>
                
                {/* 
                  Mantenemos el reproductor de 30s como fallback SIEMPRE en móvil o si no hay SDK activo.
                */}
                {currentSong.previewUrl && (
                  <div style={{ width: '100%', maxWidth: '340px', marginTop: '12px' }}>
                    <audio key={currentSong.id} controls src={currentSong.previewUrl} autoPlay style={{ width: '100%' }} />
                    <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '5px' }}>
                      {spotifyToken !== 'skipped' ? '💡 Sonando preview de 30s. Si tienes Spotify abierto, debería cambiar allí.' : '🔊 Sonando preview de 30s.'}
                    </p>
                  </div>
                )}

                {(!currentSong.previewUrl && (!deviceId || spotifyToken === 'skipped')) && (
                  <div style={{ color: '#ff8a00', marginTop: '10px', textAlign: 'center', fontSize: '0.85rem' }}>
                    ⚠️ No hay preview disponible.
                  </div>
                )}
                
                {spotifyToken && spotifyToken !== 'skipped' && (
                  <div style={{ marginTop: '15px', padding: '10px', background: 'rgba(29, 185, 84, 0.1)', borderRadius: '10px', width: '100%' }}>
                    <div style={{ color: '#1DB954', fontSize: '0.85rem', fontWeight: 'bold' }}>
                      {deviceId ? '🟢 Reproduciendo en este navegador' : '📱 Intentando control remoto...'}
                    </div>
                    {!deviceId && (
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '5px' }}>
                        Si no cambia la canción, abre la App de Spotify en tu móvil y dale al Play.
                      </p>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1rem' }}>
                <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>🎵</div>
                <h2 style={{ fontSize: isMobile ? '1.1rem' : '1.5rem' }}>Listo para empezar</h2>
                <p style={{ fontSize: '0.9rem' }}>Pulsa "Siguiente Canción" para sacar una canción</p>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '10px', flexShrink: 0 }}>
             <button onClick={playNextSong} style={{ flex: 1, padding: isMobile ? '15px' : '20px', fontSize: isMobile ? '1.1rem' : '1.5rem' }}>
              {currentSong ? '⏭ Siguiente Canción' : '▶ Empezar'}
             </button>
             {deviceId && spotifyToken !== 'skipped' && playerRef.current && (
                <button className="secondary" onClick={() => playerRef.current.togglePlay()} style={{ padding: isMobile ? '15px' : '20px', fontSize: '1.5rem' }}>⏯</button>
             )}
          </div>
        </div>

        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', minHeight: isMobile ? 'auto' : 0, overflow: 'hidden', maxHeight: isMobile ? '300px' : undefined }}>
          <h3 style={{ flexShrink: 0, fontSize: isMobile ? '1rem' : undefined }}>🏠 PIN: <strong style={{ letterSpacing: '3px', color: 'white' }}>{roomId}</strong></h3>
          
          <h3 style={{ flexShrink: 0, fontSize: isMobile ? '0.9rem' : undefined, marginTop: '0.5rem' }}>Historial ({playedSongs.length})</h3>
          <div style={{ flex: 1, overflowY: 'auto', background: 'var(--glass-bg)', borderRadius: '10px', padding: '8px', minHeight: 0 }}>
            {playedSongs.slice().reverse().map((song, i) => (
              <div key={i} style={{ padding: '6px 8px', borderBottom: '1px solid var(--glass-border)', fontSize: '0.85rem' }}>
                <strong>{song.name}</strong>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{song.artist}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (gameState === 'FINISHED') {
    return (
      <div className="glass-panel" style={{ maxWidth: '600px', margin: '15vh auto', textAlign: 'center' }}>
        <h1 style={{ fontSize: '4rem', color: 'var(--accent-color)', marginBottom: '1rem' }}>BINGO! 🎉</h1>
        <h2>Winner: <span className="text-gradient">{winner?.name}</span></h2>
        <p style={{ margin: '2rem 0', color: 'var(--text-muted)' }}>
          They successfully marked all required songs.
        </p>
        <button onClick={() => window.location.reload()}>Play Again</button>
      </div>
    );
  }

  return null;
}
