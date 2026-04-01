import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useSocket } from '../context/SocketContext';

function StatusBanner({ children, tone = 'info' }) {
  const tones = {
    info: { bg: 'rgba(59, 130, 246, 0.14)', color: '#bfdbfe' },
    warn: { bg: 'rgba(250, 204, 21, 0.14)', color: '#fde68a' },
    danger: { bg: 'rgba(239, 68, 68, 0.14)', color: '#fecaca' },
  };

  const style = tones[tone] || tones.info;
  return (
    <div style={{ padding: '14px 18px', borderRadius: '16px', background: style.bg, color: style.color, fontWeight: 700 }}>
      {children}
    </div>
  );
}

export default function PresenterScreen() {
  const { roomId } = useParams();
  const socket = useSocket();
  const [gameState, setGameState] = useState('WAITING');
  const [playlist, setPlaylist] = useState(null);
  const [playedSongs, setPlayedSongs] = useState([]);
  const [currentSong, setCurrentSong] = useState(null);
  const [playersProgress, setPlayersProgress] = useState([]);
  const [lineWinnerName, setLineWinnerName] = useState(null);
  const [winner, setWinner] = useState(null);
  const [hideSongInfo, setHideSongInfo] = useState(false);
  const [error, setError] = useState(null);
  const [presenterDisconnected, setPresenterDisconnected] = useState(false);
  const [celebration, setCelebration] = useState(null);

  useEffect(() => {
    if (!socket || !roomId) return undefined;

    const normalizedRoomId = roomId.toUpperCase();
    socket.emit('screenJoinRoom', { roomId: normalizedRoomId });

    socket.on('screenRoomState', (state) => {
      setGameState(state.gameState || 'WAITING');
      setPlaylist(state.playlist || null);
      setPlayedSongs(state.playedSongs || []);
      setCurrentSong(state.currentSong || null);
      setPlayersProgress(state.playersProgress || []);
      setLineWinnerName(state.lineWinnerName || null);
      setWinner(state.winner || null);
      setHideSongInfo(!!state.hideSongInfo);
      setPresenterDisconnected(false);
      setError(null);
    });

    socket.on('screenJoinFailed', ({ message }) => {
      setError(message || 'No se pudo conectar a la pantalla publica.');
    });

    socket.on('newSongPlayed', ({ song }) => {
      setCurrentSong(song);
      setPlayedSongs((prev) => [...prev, song]);
      setGameState('PLAYING');
    });

    socket.on('playersProgress', ({ players }) => setPlayersProgress(players));
    socket.on('lineWinner', ({ player }) => {
      setLineWinnerName(player.name);
      setCelebration({ type: 'line', name: player.name });
    });
    socket.on('bingoWinner', ({ player }) => {
      setWinner(player);
      setGameState('FINISHED');
      setCelebration({ type: 'bingo', name: player.name });
    });
    socket.on('hideSongInfoChanged', ({ hideSongInfo: hide }) => setHideSongInfo(!!hide));
    socket.on('presenterDisconnected', () => setPresenterDisconnected(true));
    socket.on('presenterReconnected', () => setPresenterDisconnected(false));
    socket.on('roomDestroyed', () => setError('La sala ya no esta disponible.'));

    return () => {
      socket.off('screenRoomState');
      socket.off('screenJoinFailed');
      socket.off('newSongPlayed');
      socket.off('playersProgress');
      socket.off('lineWinner');
      socket.off('bingoWinner');
      socket.off('hideSongInfoChanged');
      socket.off('presenterDisconnected');
      socket.off('presenterReconnected');
      socket.off('roomDestroyed');
    };
  }, [roomId, socket]);

  useEffect(() => {
    if (!celebration) return undefined;
    const timer = window.setTimeout(() => setCelebration(null), celebration.type === 'bingo' ? 4800 : 2600);
    return () => window.clearTimeout(timer);
  }, [celebration]);

  const sortedPlayers = useMemo(
    () => [...playersProgress].sort((a, b) => (b.markedCount || 0) - (a.markedCount || 0)).slice(0, 6),
    [playersProgress]
  );

  const closestPlayers = useMemo(() => {
    return sortedPlayers
      .map((player) => ({
        ...player,
        remaining: Math.max((player.cardSize || 16) - (player.markedCount || 0), 0),
      }))
      .filter((player) => player.remaining > 0 && player.remaining <= 2);
  }, [sortedPlayers]);

  return (
    <div className="screen-shell">
      <div className="screen-backdrop" />
      {celebration && (
        <div className={`screen-celebration screen-celebration--${celebration.type}`}>
          <div className="screen-celebration__confetti" />
          <div className="screen-celebration__card">
            <div className="screen-celebration__eyebrow">
              {celebration.type === 'bingo' ? 'Bingo cantado' : 'Linea cantada'}
            </div>
            <div className="screen-celebration__title">
              {celebration.type === 'bingo' ? 'BINGO' : 'LINEA'}
            </div>
            <div className="screen-celebration__name">{celebration.name}</div>
          </div>
        </div>
      )}
      <div className="screen-layout">
        <section className="screen-main glass-panel">
          <div className="screen-topbar">
            <div>
              <div className="screen-label">Pantalla publica</div>
              <h1 className="screen-room">Sala {roomId?.toUpperCase()}</h1>
            </div>
            <div className="screen-pill">{hideSongInfo ? 'Modo ciego' : 'Modo visible'}</div>
          </div>

          <div className="screen-status-stack">
            {presenterDisconnected && (
              <StatusBanner tone="warn">El presentador se esta reconectando. La partida sigue protegida.</StatusBanner>
            )}
            {error && <StatusBanner tone="danger">{error}</StatusBanner>}
          </div>

          {lineWinnerName && gameState !== 'FINISHED' && (
            <div className="screen-highlight">LINEA: {lineWinnerName}</div>
          )}
          {winner && (
            <div className="screen-highlight screen-highlight--winner">BINGO: {winner.name}</div>
          )}
          {!winner && closestPlayers.length > 0 && (
            <div className="screen-highlight" style={{ background: 'linear-gradient(135deg, #2563eb, #7c3aed)' }}>
              {closestPlayers[0].name} esta a {closestPlayers[0].remaining} {closestPlayers[0].remaining === 1 ? 'cancion' : 'canciones'} del bingo
            </div>
          )}

          <div className="screen-song-card">
            <div className="screen-cover">
              {hideSongInfo ? (
                <div className="screen-cover__blind">?</div>
              ) : currentSong?.imageUrl ? (
                <img src={currentSong.imageUrl} alt={currentSong.name} />
              ) : (
                <div className="screen-cover__blind">♪</div>
              )}
            </div>

            <div className="screen-song-meta">
              {currentSong ? (
                hideSongInfo ? (
                  <>
                    <div className="screen-kicker">Adivina la cancion</div>
                    <h2 className="screen-song-title">Sonando ahora mismo</h2>
                    <p className="screen-song-subtitle">Tema {playedSongs.length} de {playlist?.tracks?.length || playlist?.length || '?'}</p>
                  </>
                ) : (
                  <>
                    <div className="screen-kicker">Sonando ahora</div>
                    <h2 className="screen-song-title">{currentSong.name}</h2>
                    <p className="screen-song-subtitle">{currentSong.artist}</p>
                  </>
                )
              ) : (
                <>
                  <div className="screen-kicker">Preparando la partida</div>
                  <h2 className="screen-song-title">Esperando la primera cancion</h2>
                  <p className="screen-song-subtitle">Todo listo para empezar el bingo musical.</p>
                </>
              )}
            </div>
          </div>

          <div className="screen-history">
            <div className="screen-section-title">Historial</div>
            <div className="screen-history-list">
              {playedSongs.length === 0 && <div className="screen-history-item">Aun no ha salido ninguna cancion.</div>}
              {playedSongs.slice().reverse().slice(0, 8).map((song, index) => (
                <div key={`${song.id}-${index}`} className="screen-history-item">
                  {hideSongInfo ? `Cancion #${playedSongs.length - index}` : `${song.name} · ${song.artist}`}
                </div>
              ))}
            </div>
          </div>
        </section>

        <aside className="screen-side glass-panel">
          <div className="screen-stat">
            <div className="screen-stat__label">Jugadores</div>
            <div className="screen-stat__value">{playersProgress.length}</div>
          </div>
          <div className="screen-stat">
            <div className="screen-stat__label">Canciones jugadas</div>
            <div className="screen-stat__value">{playedSongs.length}</div>
          </div>
          <div className="screen-stat">
            <div className="screen-stat__label">Playlist</div>
            <div className="screen-stat__value screen-stat__value--small">{playlist?.name || 'Lista en directo'}</div>
          </div>

          <div className="screen-ranking">
            <div className="screen-section-title">Ranking en vivo</div>
            <div className="screen-ranking-list">
              {sortedPlayers.length === 0 && <div className="screen-history-item">Sin progreso todavia.</div>}
              {sortedPlayers.map((player) => {
                const percentage = Math.round(((player.markedCount || 0) / (player.cardSize || 16)) * 100);
                return (
                  <div key={player.id} className="screen-ranking-card">
                    <div className="screen-ranking-card__row">
                      <span className="screen-ranking-card__name">{player.name}</span>
                      <span className="screen-ranking-card__count">{player.markedCount}/{player.cardSize || 16}</span>
                    </div>
                    <div className="screen-ranking-card__bar">
                      <div className="screen-ranking-card__fill" style={{ width: `${percentage}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
