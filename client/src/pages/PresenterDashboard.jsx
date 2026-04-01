import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSocket } from '../context/SocketContext';
import { useNavigate } from 'react-router-dom';

// Spotify Client ID (Hardcoded for frontend PKCE flow purely for the player)
const SPOTIFY_CLIENT_ID = 'cba7c38ccc6e48e8ad01a3177e95f7ab'; 
// Spotify requires explicit loopback IP (127.0.0.1) instead of localhost for HTTP development
const isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const SPOTIFY_REDIRECT_URI = isLocalDev 
  ? 'http://127.0.0.1:5173/presenter/dashboard' 
  : `${window.location.origin}/presenter/dashboard`;
const PRESENTER_SESSION_KEY = 'bingo_presenter_session_id';
const PRESENTER_ROOM_KEY = 'bingo_presenter_room_id';
const SPOTIFY_ACCESS_TOKEN_KEY = 'spotify_presenter_token';
const SPOTIFY_REFRESH_TOKEN_KEY = 'spotify_presenter_refresh_token';
const SPOTIFY_EXPIRES_AT_KEY = 'spotify_presenter_expires_at';

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

const ensurePresenterSessionId = () => {
  let sessionId = window.localStorage.getItem(PRESENTER_SESSION_KEY);
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    window.localStorage.setItem(PRESENTER_SESSION_KEY, sessionId);
  }
  return sessionId;
};

export default function PresenterDashboard() {
  const socket = useSocket();
  const navigate = useNavigate();

  const [spotifyToken, setSpotifyToken] = useState(null);
  const [spotifyExpiresAt, setSpotifyExpiresAt] = useState(null);
  const [deviceId, setDeviceId] = useState(null);
  const [playerLoading, setPlayerLoading] = useState(false);
  const playerRef = useRef(null);
  const refreshTimeoutRef = useRef(null);
  const presenterSessionIdRef = useRef(ensurePresenterSessionId());
  const presenterReconnectAttemptedRef = useRef(false);

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
  const [publicBlindMode, setPublicBlindMode] = useState(false);
  const [presenterAuth, setPresenterAuth] = useState(false);
  const [authInput, setAuthInput] = useState('');
  const [playersProgress, setPlayersProgress] = useState([]);
  const [lineWinnerName, setLineWinnerName] = useState(null);
  const [spotifyWarning, setSpotifyWarning] = useState(null);
  const [presenterDisconnectedUntil, setPresenterDisconnectedUntil] = useState(null);
  const [countdownValue, setCountdownValue] = useState(null);
  const [pendingSong, setPendingSong] = useState(null);
  const connectedWaitingPlayers = useMemo(
    () => players.filter((player) => player?.isConnected !== false),
    [players]
  );

  const persistSpotifySession = useCallback((response) => {
    if (!response?.access_token) return;

    const expiresAt = Date.now() + ((response.expires_in || 3600) - 60) * 1000;
    window.localStorage.setItem(SPOTIFY_ACCESS_TOKEN_KEY, response.access_token);
    window.localStorage.setItem(SPOTIFY_EXPIRES_AT_KEY, String(expiresAt));
    if (response.refresh_token) {
      window.localStorage.setItem(SPOTIFY_REFRESH_TOKEN_KEY, response.refresh_token);
    }

    setSpotifyToken(response.access_token);
    setSpotifyExpiresAt(expiresAt);
    setSpotifyWarning(null);
  }, []);

  const clearSpotifySession = useCallback(() => {
    window.localStorage.removeItem(SPOTIFY_ACCESS_TOKEN_KEY);
    window.localStorage.removeItem(SPOTIFY_REFRESH_TOKEN_KEY);
    window.localStorage.removeItem(SPOTIFY_EXPIRES_AT_KEY);
    setSpotifyToken(null);
    setSpotifyExpiresAt(null);
  }, []);

  const hydratePresenterState = useCallback((state) => {
    if (!state) return;

    setRoomId(state.roomId || '');
    setPlayers(state.players || []);
    setPlaylist(state.playlist || null);
    setPlayedSongs(state.playedSongs || []);
    setCurrentSong(state.currentSong || null);
    setWinner(state.winner || null);
    setLineWinnerName(state.lineWinnerName || null);
    setPlayersProgress(state.playersProgress || []);
    setPublicBlindMode(!!state.hideSongInfo);
    setGameState(state.gameState || 'WAITING');
    setPendingSong(state.pendingSong || null);

    if (state.pendingSongRevealAt) {
      const secondsLeft = Math.max(1, Math.ceil((state.pendingSongRevealAt - Date.now()) / 1000));
      setCountdownValue(secondsLeft);
    } else {
      setCountdownValue(null);
    }

    if (state.roomId) {
      window.localStorage.setItem(PRESENTER_ROOM_KEY, state.roomId);
    }
  }, []);

  const refreshSpotifyToken = useCallback(async () => {
    const refreshToken = window.localStorage.getItem(SPOTIFY_REFRESH_TOKEN_KEY);
    if (!refreshToken) {
      throw new Error('No refresh token available');
    }

    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: SPOTIFY_CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });

    const data = await response.json();
    if (!response.ok || !data.access_token) {
      throw new Error(data.error_description || data.error || 'Failed to refresh Spotify token');
    }

    persistSpotifySession({
      ...data,
      refresh_token: data.refresh_token || refreshToken,
    });

    return data.access_token;
  }, [persistSpotifySession]);

  // --- SPOTIFY PKCE AUTH FLOW ---
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const storedToken = window.localStorage.getItem(SPOTIFY_ACCESS_TOKEN_KEY);
    const storedExpiry = Number(window.localStorage.getItem(SPOTIFY_EXPIRES_AT_KEY) || 0);

    const exchangeToken = async (code) => {
      const codeVerifier = window.localStorage.getItem('code_verifier');
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
          persistSpotifySession(response);
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
    } else if (storedToken && storedExpiry > Date.now()) {
      setSpotifyToken(storedToken);
      setSpotifyExpiresAt(storedExpiry);
    } else if (window.localStorage.getItem(SPOTIFY_REFRESH_TOKEN_KEY)) {
      refreshSpotifyToken().catch((err) => {
        console.error('Spotify refresh on load failed', err);
        clearSpotifySession();
      });
    }
  }, [clearSpotifySession, persistSpotifySession, refreshSpotifyToken]);

  useEffect(() => {
    if (!spotifyExpiresAt) return undefined;

    const timeoutMs = Math.max(5000, spotifyExpiresAt - Date.now() - 90 * 1000);
    refreshTimeoutRef.current = window.setTimeout(() => {
      refreshSpotifyToken().catch((err) => {
        console.error('Scheduled Spotify refresh failed', err);
        setSpotifyWarning('La sesión de Spotify ha caducado. Puedes volver a iniciarla sin cerrar la sala.');
        clearSpotifySession();
      });
    }, timeoutMs);

    return () => {
      if (refreshTimeoutRef.current) {
        window.clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
    };
  }, [clearSpotifySession, refreshSpotifyToken, spotifyExpiresAt]);

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

    clearSpotifySession();
    
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
      player.addListener('authentication_error', async ({ message }) => { 
        console.error("Auth err:", message);
        setPlayerLoading(false);
        try {
          await refreshSpotifyToken();
          setSpotifyWarning('La sesión de Spotify se renovó automáticamente.');
        } catch (err) {
          console.error('Spotify token recovery failed:', err);
          clearSpotifySession();
          setSpotifyWarning('Spotify pidió volver a iniciar sesión, pero la sala sigue viva para que puedas reconectar.');
        }
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
  }, [clearSpotifySession, refreshSpotifyToken, spotifyToken]);

  // Socket Events
  useEffect(() => {
    if (!socket) return;
    const onSocketConnect = () => {
      presenterReconnectAttemptedRef.current = false;
      const savedRoomId = window.localStorage.getItem(PRESENTER_ROOM_KEY);
      const presenterSessionId = presenterSessionIdRef.current;
      if (!savedRoomId || !presenterSessionId || presenterReconnectAttemptedRef.current) return;

      presenterReconnectAttemptedRef.current = true;
      socket.emit('reconnectPresenter', {
        roomId: savedRoomId,
        presenterSessionId,
      });
    };

    const onSocketDisconnect = () => {
      presenterReconnectAttemptedRef.current = false;
    };

    socket.on('connect', onSocketConnect);
    socket.on('disconnect', onSocketDisconnect);
    socket.on('roomCreated', ({ roomId }) => {
      setRoomId(roomId);
      setGameState('WAITING');
      setPresenterDisconnectedUntil(null);
      setPendingSong(null);
      setCountdownValue(null);
      window.localStorage.setItem(PRESENTER_ROOM_KEY, roomId);
    });
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
    socket.on('presenterRoomState', (state) => {
      hydratePresenterState(state);
      setPresenterDisconnectedUntil(null);
      setError(null);
    });
    socket.on('presenterReconnectFailed', ({ message }) => {
      window.localStorage.removeItem(PRESENTER_ROOM_KEY);
      setError(message || 'No se pudo recuperar la sala del presentador.');
    });
    socket.on('presenterDisconnected', ({ reconnectDeadline }) => {
      setPresenterDisconnectedUntil(reconnectDeadline || null);
    });
    socket.on('presenterReconnected', () => {
      setPresenterDisconnectedUntil(null);
    });
    socket.on('hideSongInfoChanged', ({ hideSongInfo: hide }) => {
      setPublicBlindMode(!!hide);
    });
    socket.on('songCountdownStarted', ({ song, revealAt }) => {
      setPendingSong(song);
      const secondsLeft = Math.max(1, Math.ceil((revealAt - Date.now()) / 1000));
      setCountdownValue(secondsLeft);
    });
    socket.on('newSongPlayed', async ({ song }) => {
      setCurrentSong(song);
      setPlayedSongs((prev) => [...prev, song]);
      setPendingSong(null);
      setCountdownValue(null);

      if (song?.uri && spotifyToken) {
        try {
          const playEndpoint = deviceId
            ? `https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`
            : 'https://api.spotify.com/v1/me/player/play';

          await fetch(playEndpoint, {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${spotifyToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ uris: [song.uri] })
          });
        } catch (err) {
          console.error('Playback command failed:', err);
        }
      }
    });
    socket.on('roomDestroyed', () => {
      window.localStorage.removeItem(PRESENTER_ROOM_KEY);
      setRoomId('');
      setPlayers([]);
      setPlaylist(null);
      setPlayedSongs([]);
      setCurrentSong(null);
      setPlayersProgress([]);
      setLineWinnerName(null);
      setWinner(null);
      setPresenterDisconnectedUntil(null);
      setPendingSong(null);
      setCountdownValue(null);
      setGameState('SETUP');
      setError('La sala del presentador expiró por desconexión prolongada.');
    });
    socket.on('lineWinner', ({ player }) => {
      setLineWinnerName(player.name);
      setPlayersProgress(prev => prev.map(p =>
        p.name === player.name ? { ...p, hasLine: true } : p
      ));
    });
    return () => {
      socket.off('connect', onSocketConnect);
      socket.off('disconnect', onSocketDisconnect);
      socket.off('roomCreated'); socket.off('playerJoined'); socket.off('playerLeft');
      socket.off('gameStartedPresenter'); socket.off('bingoWinner'); socket.off('error');
      socket.off('playersProgress'); socket.off('lineWinner');
      socket.off('presenterRoomState'); socket.off('presenterReconnectFailed');
      socket.off('presenterDisconnected'); socket.off('presenterReconnected');
      socket.off('hideSongInfoChanged');
      socket.off('songCountdownStarted');
      socket.off('newSongPlayed');
      socket.off('roomDestroyed');
    };
  }, [deviceId, hydratePresenterState, socket, spotifyToken]);

  useEffect(() => {
    if (!pendingSong || countdownValue === null) return undefined;

    if (countdownValue <= 1) {
      const timer = window.setTimeout(() => setCountdownValue(0), 350);
      return () => window.clearTimeout(timer);
    }

    const timer = window.setTimeout(() => {
      setCountdownValue((prev) => (prev === null ? null : prev - 1));
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [countdownValue, pendingSong]);

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
      setPlayedSongs([]);
      setCurrentSong(null);
      setPendingSong(null);
      setCountdownValue(null);
      setWinner(null);
      setLineWinnerName(null);
      socket.emit('createRoom', {
        presenterSessionId: presenterSessionIdRef.current,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleStartGame = () => {
    if (connectedWaitingPlayers.length === 0) {
      return setError('Wait for at least 1 connected player to join');
    }
    socket.emit('startGame', { roomId, playlist: playlist.tracks });
  };

  const openPresenterScreen = () => {
    if (!roomId) return;
    window.open(`/presenter/screen/${roomId}`, '_blank', 'noopener,noreferrer');
  };

  const toggleBlindMode = () => {
    const nextValue = !publicBlindMode;
    setPublicBlindMode(nextValue);
    if (socket && roomId) {
      socket.emit('setHideSongInfo', { roomId, hideSongInfo: nextValue });
    }
  };

  const playNextSong = async () => {
    if (!playlist || countdownValue !== null) return;
    const remaining = playlist.tracks.filter(t => !playedSongs.find(ps => ps.id === t.id));
    if (remaining.length === 0) return alert('No more songs in playlist!');

    const randomTrack = remaining[Math.floor(Math.random() * remaining.length)];
    socket.emit('playNextSong', { roomId, song: randomTrack, countdownMs: 1800 });
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

  if (!spotifyToken && gameState === 'SETUP') {
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
        {spotifyWarning && (
          <div style={{ marginBottom: '1rem', padding: '12px', borderRadius: '12px', background: 'rgba(250, 204, 21, 0.12)', color: '#fde68a' }}>
            {spotifyWarning}
          </div>
        )}
        {!spotifyToken && (
          <div style={{ marginBottom: '1rem', padding: '12px', borderRadius: '12px', background: 'rgba(239, 68, 68, 0.12)', color: '#fecaca' }}>
            Spotify no está conectado ahora mismo. La sala sigue activa y puedes volver a iniciar sesión sin echar a los jugadores.
            <div style={{ marginTop: '10px' }}>
              <button onClick={handleSpotifyLogin} style={{ background: '#1DB954' }}>Reconectar Spotify</button>
            </div>
          </div>
        )}
        <div style={{ margin: '2rem 0', padding: '2rem', background: 'var(--glass-bg)', borderRadius: '15px' }}>
          <p style={{ fontSize: '1.2rem', color: 'var(--text-muted)' }}>Players join at URL with PIN:</p>
          <h1 style={{ fontSize: '5rem', letterSpacing: '5px', margin: '10px 0' }}>{roomId}</h1>
        </div>
        
        <div style={{ background: 'var(--glass-bg)', padding: '1.5rem', borderRadius: '15px', marginBottom: '2rem' }}>
          <h3>Waiting Room ({connectedWaitingPlayers.length})</h3>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center', marginTop: '1rem', minHeight: '50px' }}>
            {connectedWaitingPlayers.length === 0 && <p style={{ color: 'var(--text-muted)' }}>Waiting for players to join...</p>}
            {connectedWaitingPlayers.map(p => (
              <span key={p.id} style={{ background: 'var(--primary-color)', padding: '8px 15px', borderRadius: '50px' }}>{p.name}</span>
            ))}
          </div>
        </div>

        {error && <div style={{ color: '#ff4d4d', marginBottom: '1rem' }}>{error}</div>}
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={handleStartGame} style={{ fontSize: '1.2rem', padding: '15px 40px' }}>Start Game</button>
          <button className="secondary" onClick={openPresenterScreen} style={{ fontSize: '1rem', padding: '15px 30px' }}>
            Abrir pantalla TV
          </button>
        </div>
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
          {(spotifyWarning || !spotifyToken || presenterDisconnectedUntil) && (
            <div style={{ marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {spotifyWarning && (
                <div style={{ padding: '12px', borderRadius: '12px', background: 'rgba(250, 204, 21, 0.12)', color: '#fde68a' }}>
                  {spotifyWarning}
                </div>
              )}
              {!spotifyToken && (
                <div style={{ padding: '12px', borderRadius: '12px', background: 'rgba(239, 68, 68, 0.12)', color: '#fecaca' }}>
                  Spotify se desconectó, pero la partida sigue viva. Puedes volver a iniciar sesión y retomar el control.
                  <div style={{ marginTop: '10px' }}>
                    <button onClick={handleSpotifyLogin} style={{ background: '#1DB954' }}>Reconectar Spotify</button>
                  </div>
                </div>
              )}
              {presenterDisconnectedUntil && (
                <div style={{ padding: '12px', borderRadius: '12px', background: 'rgba(59, 130, 246, 0.12)', color: '#bfdbfe' }}>
                  El servidor ha dejado margen para que el presentador se reconecte antes de cerrar la sala.
                </div>
              )}
            </div>
          )}
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
              onClick={openPresenterScreen}
              style={{ padding: '8px 15px', fontSize: '0.8rem', borderRadius: '10px' }}
            >
              TV
            </button>
            <button 
              className="secondary" 
              onClick={toggleBlindMode}
              style={{ padding: '8px 15px', fontSize: '0.8rem', borderRadius: '10px' }}
            >
              {publicBlindMode ? 'TV con info' : 'TV ciega'}
            </button>
          </div>
          
          <div style={{ flex: isMobile ? 'none' : 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--glass-bg)', borderRadius: '15px', padding: '1.5rem', margin: '0.5rem 0', overflowY: 'auto' }}>
            {countdownValue !== null && pendingSong && (
              <div className="presenter-countdown-banner">
                <div className="presenter-countdown-banner__kicker">Siguiente cancion preparada</div>
                <div className="presenter-countdown-banner__title">{pendingSong.name}</div>
                <div className="presenter-countdown-banner__value">{Math.max(countdownValue, 1)}</div>
              </div>
            )}
            {currentSong ? (
              <>
                <div style={{ width: isMobile ? '140px' : '200px', height: isMobile ? '140px' : '200px', marginBottom: '1rem', borderRadius: '15px', overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.5)', flexShrink: 0, position: 'relative' }}>
                  {currentSong.imageUrl ? (
                    <img src={currentSong.imageUrl} alt="Album" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <div style={{ width: '100%', height: '100%', background: 'var(--primary-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '3rem' }}>🎵</div>
                  )}
                </div>

                <div style={{ textAlign: 'center', minHeight: '80px' }}>
                  <>
                    <h2 style={{ marginBottom: '5px', fontSize: isMobile ? '1.1rem' : '1.8rem' }}>{currentSong.name}</h2>
                    <p style={{ color: 'var(--text-muted)', fontSize: isMobile ? '0.9rem' : '1.3rem', marginBottom: '0.5rem' }}>{currentSong.artist}</p>
                  </>
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
             <button onClick={playNextSong} disabled={countdownValue !== null} style={{ flex: 1, padding: isMobile ? '15px' : '25px', fontSize: isMobile ? '1.1rem' : '1.7rem' }}>
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
              {`Historial (${playedSongs.length})`}
            </h3>
            <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
              {playedSongs.slice().reverse().map((song, i) => (
                <div key={i} style={{ padding: '5px 8px', borderBottom: '1px solid var(--glass-border)', fontSize: '0.8rem' }}>
                  <>
                    <strong>{song.name}</strong>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{song.artist}</div>
                  </>
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
