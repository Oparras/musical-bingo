import React, { useState, useEffect, useRef, useCallback } from 'react';
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

const getBackendUrl = () => {
  const defaultBackendUrl = `http://${window.location.hostname}:3001`;
  return import.meta.env.VITE_BACKEND_URL || defaultBackendUrl;
};

const extractPlaylistId = (value) => {
  if (!value) return '';
  const trimmedValue = value.trim();
  const match = trimmedValue.match(/playlist\/([a-zA-Z0-9]+)/);
  return match ? match[1] : trimmedValue;
};

const getTrackCountTone = (trackCount) => {
  if (trackCount > 200) {
    return {
      label: 'Larga',
      color: '#ef4444',
      background: 'rgba(239, 68, 68, 0.16)',
      border: 'rgba(239, 68, 68, 0.45)'
    };
  }

  if (trackCount >= 100) {
    return {
      label: 'Media',
      color: '#facc15',
      background: 'rgba(250, 204, 21, 0.14)',
      border: 'rgba(250, 204, 21, 0.4)'
    };
  }

  return {
    label: 'Compacta',
    color: '#4ade80',
    background: 'rgba(74, 222, 128, 0.14)',
    border: 'rgba(74, 222, 128, 0.4)'
  };
};

export default function PresenterDashboard() {
  const socket = useSocket();
  const navigate = useNavigate();

  const [spotifyToken, setSpotifyToken] = useState(null);
  const [deviceId, setDeviceId] = useState(null);
  const [playerLoading, setPlayerLoading] = useState(false);
  const playerRef = useRef(null);

  const [roomId, setRoomId] = useState('');
  const [playlistUrl, setPlaylistUrl] = useState('');
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [presetPlaylists, setPresetPlaylists] = useState([]);
  const [presetLoading, setPresetLoading] = useState(false);
  const [gameState, setGameState] = useState('SETUP'); 
  const [players, setPlayers] = useState([]);
  const [playlist, setPlaylist] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [playedSongs, setPlayedSongs] = useState([]);
  const [currentSong, setCurrentSong] = useState(null);
  const [winner, setWinner] = useState(null);
  const [hideSongInfo, setHideSongInfo] = useState(false);
  const [presenterAuth, setPresenterAuth] = useState(false);
  const [authInput, setAuthInput] = useState('');
  const [playersProgress, setPlayersProgress] = useState([]);
  const [lineWinnerName, setLineWinnerName] = useState(null);

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

  useEffect(() => {
    if (!spotifyToken) return;

    const loadPresetPlaylists = async () => {
      setPresetLoading(true);
      try {
        const res = await fetch(`${getBackendUrl()}/api/spotify/preset-playlists`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load preset playlists');
        setPresetPlaylists(data.playlists || []);
      } catch (err) {
        console.error('Preset playlists load error:', err);
        setError((currentError) => currentError || 'No se pudieron cargar las playlists predefinidas.');
      } finally {
        setPresetLoading(false);
      }
    };

    loadPresetPlaylists();
  }, [spotifyToken]);

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
    if (!spotifyToken) return;

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
    socket.on('gameStartedPresenter', ({ players }) => {
      setPlayers(players);
      setGameState('PLAYING');
      // Init progress table with all players at 0
      setPlayersProgress(players.map(p => ({ id: p.id, name: p.name, markedCount: 0, cardSize: 16, hasLine: false, hasBingo: false })));
    });
    socket.on('bingoWinner', ({ player }) => { setWinner(player); setGameState('FINISHED'); });
    socket.on('error', (err) => { setError(err); setLoading(false); });
    socket.on('playersProgress', ({ players }) => {
      setPlayersProgress(players);
    });
    socket.on('lineWinner', ({ player }) => {
      setLineWinnerName(player.name);
      setPlayersProgress(prev => prev.map(p =>
        p.name === player.name ? { ...p, hasLine: true } : p
      ));
    });
    return () => {
      socket.off('roomCreated'); socket.off('playerJoined'); socket.off('playerLeft');
      socket.off('gameStartedPresenter'); socket.off('bingoWinner'); socket.off('error');
      socket.off('playersProgress'); socket.off('lineWinner');
    };
  }, [socket]);

  const handleCreateRoom = async () => {
    const pid = selectedPresetId || extractPlaylistId(playlistUrl);
    if (!pid) return setError('Please enter a Spotify Playlist URL or choose a preset playlist.');

    setLoading(true); setError(null);
    try {
      const backendUrl = getBackendUrl();
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

      if (spotifyToken) {
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

  // --- PRIVATE ACCESS GATE ---
  if (!presenterAuth && !window.localStorage.getItem('presenter_verified')) {
    const handleAuth = (e) => {
      e.preventDefault();
      if (authInput === '300395') {
        setPresenterAuth(true);
        window.localStorage.setItem('presenter_verified', 'true');
      } else {
        alert('Código incorrecto. Acceso denegado.');
      }
    };

    return (
      <div className="glass-panel" style={{ maxWidth: '400px', margin: '20vh auto', textAlign: 'center' }}>
        <h2 style={{ marginBottom: '1.5rem' }}>🔐 Acceso Privado</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: '2rem', fontSize: '0.9rem' }}>
          Solo el personal autorizado puede crear salas de Bingo. Introduzca el código de Maestro de Ceremonias.
        </p>
        <form onSubmit={handleAuth}>
          <input 
            type="password" 
            placeholder="Código de acceso" 
            value={authInput}
            onChange={(e) => setAuthInput(e.target.value)}
            style={{ textAlign: 'center', fontSize: '1.5rem', letterSpacing: '5px', marginBottom: '1.5rem' }}
          />
          <button type="submit" style={{ width: '100%' }}>Verificar Identidad</button>
          <button className="secondary" onClick={() => navigate('/')} style={{ width: '100%', marginTop: '10px' }}>Volver</button>
        </form>
      </div>
    );
  }

  if (!spotifyToken) {
    return (
      <div className="glass-panel" style={{ maxWidth: '600px', margin: '15vh auto', textAlign: 'center' }}>
        <h2>Host a Game</h2>
        {error && <div style={{ color: '#ff4d4d', marginBottom: '1rem' }}>{error}</div>}
        <p style={{ margin: '2rem 0', color: 'var(--text-muted)' }}>
          Para que la aplicación funcione y reproduzca la música automáticamente, es obligatorio iniciar sesión con una cuenta de Spotify Premium.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <button onClick={handleSpotifyLogin} style={{ background: '#1DB954' }}>
            Iniciar sesión con Spotify Premium
          </button>
          <button className="secondary" onClick={() => navigate('/')} style={{ marginTop: '10px', opacity: 0.7 }}>
            🔙 Volver al Inicio
          </button>
        </div>
      </div>
    );
  }

  if (gameState === 'SETUP') {
    return (
      <div className="glass-panel" style={{ maxWidth: '600px', margin: '10vh auto', position: 'relative' }}>
        <button 
          className="secondary" 
          onClick={() => navigate('/')} 
          style={{ position: 'absolute', top: '15px', right: '15px', padding: '5px 15px', fontSize: '0.8rem' }}
        >
          Salir
        </button>
        <h2>Configure Room</h2>
        {playerLoading && <div style={{ color: '#1DB954', marginBottom: '1rem' }}>Initializing Spotify Web Player...</div>}
        {deviceId && <div style={{ color: '#1DB954', marginBottom: '1rem' }}>✓ Spotify Premium Player Ready!</div>}
        {error && <div style={{ color: '#ff4d4d', marginBottom: '1rem', padding: '10px', background: 'rgba(255,0,0,0.1)', borderRadius: '8px' }}>{error}</div>}
        
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', margin: '1.5rem 0 0.5rem 0', color: 'var(--text-muted)' }}>
            Spotify Playlist URL manual
          </label>
          <input 
            type="text" 
            placeholder="https://open.spotify.com/playlist/..." 
            value={playlistUrl}
            onChange={(e) => {
              setPlaylistUrl(e.target.value);
              setSelectedPresetId('');
            }}
          />
        </div>
        
        <button onClick={handleCreateRoom} disabled={loading} style={{ width: '100%', margin: '1.5rem 0' }}>
          {loading ? 'Fetching Playlist...' : 'Create Room'}
        </button>

        <div style={{ marginTop: '1.25rem' }}>
          <label style={{ display: 'block', margin: '0 0 0.75rem 0', color: 'var(--text-muted)' }}>
            O elige una playlist predefinida
          </label>

          {presetLoading ? (
            <div style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
              Cargando playlists predefinidas...
            </div>
          ) : (
            <div className="preset-playlist-grid">
              {presetPlaylists.map((preset) => {
                const tone = getTrackCountTone(preset.trackCount);
                const isSelected = selectedPresetId === preset.id;

                return (
                  <button
                    key={preset.id}
                    type="button"
                    className={`preset-playlist-card${isSelected ? ' selected' : ''}`}
                    onClick={() => {
                      setSelectedPresetId(preset.id);
                      setPlaylistUrl(preset.url);
                      setError(null);
                    }}
                  >
                    <div className="preset-playlist-card__image">
                      {preset.image ? (
                        <img src={preset.image} alt={preset.name} />
                      ) : (
                        <div className="preset-playlist-card__fallback">Playlist</div>
                      )}
                    </div>
                    <div className="preset-playlist-card__content">
                      <div className="preset-playlist-card__title">{preset.name}</div>
                      <div className="preset-playlist-card__meta">
                        <span
                          className="preset-playlist-card__badge"
                          style={{
                            color: tone.color,
                            background: tone.background,
                            borderColor: tone.border
                          }}
                        >
                          {tone.label}
                        </span>
                        <span>{preset.trackCount} canciones</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (gameState === 'WAITING') {
    return (
      <div className="glass-panel" style={{ maxWidth: '800px', margin: '5vh auto', textAlign: 'center', position: 'relative' }}>
        <button 
          className="secondary" 
          onClick={() => navigate('/')} 
          style={{ position: 'absolute', top: '20px', right: '20px', padding: '8px 20px' }}
        >
          Abandonar Partida
        </button>
        <h2 className="text-gradient">Detalles de la Sala</h2>
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', gap: '10px' }}>
            <button 
              className="secondary" 
              onClick={() => { if(confirm('¿Seguro que quieres salir? Se cerrará la partida.')) navigate('/') }}
              style={{ padding: '8px 15px', fontSize: '0.8rem', borderRadius: '10px' }}
            >
              🚪 Salir
            </button>
            <h2 style={{ fontSize: isMobile ? '1.1rem' : undefined, margin: 0, flex: 1, textAlign: 'center' }}>🎤 Panel</h2>
            <button 
              className="secondary" 
              onClick={() => setHideSongInfo(!hideSongInfo)}
              style={{ padding: '8px 15px', fontSize: '0.8rem', borderRadius: '10px' }}
            >
              {hideSongInfo ? '👁️ Info' : '🙈 Ciego'}
            </button>
          </div>
          
          <div style={{ flex: isMobile ? 'none' : 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--glass-bg)', borderRadius: '15px', padding: '1.5rem', margin: '0.5rem 0', overflowY: 'auto' }}>
            {currentSong ? (
              <>
                <div style={{ width: isMobile ? '140px' : '200px', height: isMobile ? '140px' : '200px', marginBottom: '1rem', borderRadius: '15px', overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.5)', flexShrink: 0, position: 'relative' }}>
                  {hideSongInfo ? (
                    <div style={{ width: '100%', height: '100%', background: 'linear-gradient(45deg, #1e1b4b, #311936)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '5rem' }}>❓</div>
                  ) : currentSong.imageUrl ? (
                    <img src={currentSong.imageUrl} alt="Album" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <div style={{ width: '100%', height: '100%', background: 'var(--primary-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '3rem' }}>🎵</div>
                  )}
                </div>

                <div style={{ textAlign: 'center', minHeight: '80px' }}>
                  {hideSongInfo ? (
                    <>
                      <h2 style={{ marginBottom: '5px', fontSize: isMobile ? '1.5rem' : '2.2rem', color: 'var(--accent-color)' }}>¡Adivina la canción! 🎧</h2>
                      <p style={{ color: 'var(--text-muted)' }}>Canción #{playedSongs.length} de {playlist?.tracks.length}</p>
                    </>
                  ) : (
                    <>
                      <h2 style={{ marginBottom: '5px', fontSize: isMobile ? '1.1rem' : '1.8rem' }}>{currentSong.name}</h2>
                      <p style={{ color: 'var(--text-muted)', fontSize: isMobile ? '0.9rem' : '1.3rem', marginBottom: '0.5rem' }}>{currentSong.artist}</p>
                    </>
                  )}
                </div>
                
                {spotifyToken && (
                  <div style={{ marginTop: '10px', fontSize: '0.8rem', color: '#1DB954' }}>
                    {deviceId ? '🟢 Conectado a Spotify Web' : '📱 Controlando Spotify (Remoto)'}
                  </div>
                )}
              </>
            ) : (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1rem' }}>
                <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>🎲</div>
                <h2 style={{ fontSize: isMobile ? '1.1rem' : '1.8rem' }}>¿Todo listo?</h2>
                <p>Pulsa abajo para sacar la primera canción</p>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '10px', flexShrink: 0 }}>
             <button onClick={playNextSong} style={{ flex: 1, padding: isMobile ? '15px' : '25px', fontSize: isMobile ? '1.1rem' : '1.7rem' }}>
              {currentSong ? '⏭ Siguiente Canción' : '▶ Empezar Juego'}
             </button>
             
             {/* Big play/pause button for Premium formats */}
             {(deviceId && playerRef.current) && (
                <button className="secondary" onClick={() => playerRef.current.togglePlay()} style={{ padding: isMobile ? '15px' : '20px', fontSize: '1.5rem' }}>⏯</button>
             )}
          </div>
        </div>

        {/* RIGHT PANEL: PIN + Analytics + History */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', minHeight: 0, overflow: 'hidden' }}>

          {/* PIN */}
          <div className="glass-panel" style={{ padding: '12px', textAlign: 'center', flexShrink: 0 }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '2px' }}>PIN de la Sala</div>
            <div style={{ fontSize: '2.8rem', fontWeight: '800', color: 'white', letterSpacing: '5px' }}>{roomId}</div>
          </div>

          {/* LINE WINNER BANNER */}
          {lineWinnerName && (
            <div style={{
              background: 'linear-gradient(135deg, #ff8a00, #e52e71)',
              borderRadius: '12px',
              padding: '10px 16px',
              textAlign: 'center',
              fontWeight: '700',
              fontSize: '0.9rem',
              flexShrink: 0,
              animation: 'lineWinnerPop 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards',
            }}>
              📢 LÍNEA: {lineWinnerName}
            </div>
          )}

          {/* ANALYTICS PANEL */}
          <div className="glass-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden', padding: '12px' }}>
            <h3 style={{ flexShrink: 0, margin: '0 0 10px 0', fontSize: '0.95rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px' }}>
              📊 Progreso ({playersProgress.length} jugadores)
            </h3>
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', minHeight: 0 }}>
              {playersProgress.length === 0 && (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', marginTop: '1rem' }}>Sin datos aún...</p>
              )}
                  {[...playersProgress]
                    .sort((a, b) => b.markedCount - a.markedCount)
                    .map(p => {
                      const pct = Math.round((p.markedCount / (p.cardSize || 16)) * 100);
                      const remaining = (p.cardSize || 16) - p.markedCount;
                      const isOffline = p.isConnected === false;
                      
                      let alertColor = '#4ade80'; // green
                      let alertLabel = '';
                      if (remaining <= 1) { alertColor = '#f97316'; alertLabel = '🔥 ¡1 canción!'; }
                      else if (remaining <= 2) { alertColor = '#fb923c'; alertLabel = '🔥 ¡Muy cerca!'; }
                      else if (remaining <= 4) { alertColor = '#facc15'; alertLabel = '⚡ ¡A tiro!'; }
                      else if (pct >= 50) { alertColor = '#60a5fa'; alertLabel = ''; }
                      else { alertColor = 'rgba(255,255,255,0.2)'; alertLabel = ''; }

                      return (
                        <div key={p.id} style={{
                          background: isOffline ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.05)',
                          borderRadius: '10px',
                          padding: '8px 10px',
                          border: `1px solid ${isOffline ? 'rgba(255,0,0,0.2)' : (remaining <= 4 ? alertColor + '88' : 'var(--glass-border)')}`,
                          transition: 'all 0.3s ease',
                          opacity: isOffline ? 0.6 : 1,
                        }}>
                          {/* Name row */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
                            <div style={{ 
                              fontWeight: '700', 
                              fontSize: '0.85rem', 
                              overflow: 'hidden', 
                              textOverflow: 'ellipsis', 
                              whiteSpace: 'nowrap', 
                              flex: 1,
                              color: isOffline ? 'var(--text-muted)' : 'white'
                            }}>
                              {isOffline && '💤 '}{p.name}
                            </div>
                            <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexShrink: 0, marginLeft: '6px' }}>
                              {isOffline && (
                                <span style={{ color: '#ef4444', fontSize: '0.65rem', fontWeight: '800', marginRight: '4px' }}>OFFLINE</span>
                              )}
                              {p.hasLine && (
                                <span style={{ background: 'linear-gradient(135deg,#ff8a00,#e52e71)', borderRadius: '6px', padding: '1px 6px', fontSize: '0.7rem', fontWeight: '700' }}>LÍNEA</span>
                              )}
                              {p.hasBingo && (
                                <span style={{ background: 'linear-gradient(135deg,#ff007f,#ff8a00)', borderRadius: '6px', padding: '1px 6px', fontSize: '0.7rem', fontWeight: '700' }}>BINGO</span>
                              )}
                              {alertLabel && !isOffline && (
                                <span style={{ color: alertColor, fontSize: '0.72rem', fontWeight: '700' }}>{alertLabel}</span>
                              )}
                              <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{p.markedCount}/{p.cardSize || 16}</span>
                            </div>
                          </div>
                          {/* Progress bar */}
                          <div style={{ height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '99px', overflow: 'hidden' }}>
                            <div style={{
                              height: '100%',
                              width: `${pct}%`,
                              background: isOffline
                                ? 'linear-gradient(90deg, #444, #666)'
                                : remaining <= 2
                                ? 'linear-gradient(90deg, #f97316, #facc15)'
                                : remaining <= 4
                                ? 'linear-gradient(90deg, #60a5fa, #a78bfa)'
                                : 'linear-gradient(90deg, var(--primary-color), var(--secondary-color))',
                              borderRadius: '99px',
                              transition: 'width 0.4s ease',
                            }} />
                          </div>
                        </div>
                      );
                    })
                  }
            </div>
          </div>

          {/* SONG HISTORY */}
          <div className="glass-panel" style={{ flexShrink: 0, maxHeight: isMobile ? '180px' : '200px', overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: '12px' }}>
            <h3 style={{ flexShrink: 0, margin: '0 0 8px 0', fontSize: '0.85rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px' }}>
              {hideSongInfo ? 'Historial (Oculto)' : `Historial (${playedSongs.length})`}
            </h3>
            <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
              {playedSongs.slice().reverse().map((song, i) => (
                <div key={i} style={{ padding: '5px 8px', borderBottom: '1px solid var(--glass-border)', fontSize: '0.8rem', opacity: hideSongInfo ? 0.3 : 1 }}>
                  {hideSongInfo ? (
                    <div style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Canción #{playedSongs.length - i} (Oculta)</div>
                  ) : (
                    <>
                      <strong>{song.name}</strong>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{song.artist}</div>
                    </>
                  )}
                </div>
              ))}
            </div>
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
        <div style={{ display: 'flex', gap: '15px', justifyContent: 'center' }}>
          <button onClick={() => window.location.reload()}>Jugar otra vez</button>
          <button className="secondary" onClick={() => navigate('/')}>Ir al Inicio</button>
        </div>
      </div>
    );
  }

  return null;
}
