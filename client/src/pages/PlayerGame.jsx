import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSocket } from '../context/SocketContext';
import { useParams, useNavigate } from 'react-router-dom';

// ---- Toast / Popup component ----
function Toast({ toasts }) {
  if (toasts.length === 0) return null;
  return (
    <div style={{
      position: 'fixed',
      top: '5%',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 2147483647, // Max z-index to guarantee visibility
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      alignItems: 'center',
      pointerEvents: 'none',
      width: '95vw',
      maxWidth: '600px',
    }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          background: t.type === 'success'
            ? 'linear-gradient(135deg, #00c851, #007E33)'
            : t.type === 'winner'
            ? 'linear-gradient(135deg, #ff8a00, #e52e71)'
            : t.type === 'error'
            ? 'linear-gradient(135deg, #ef4444, #b91c1c)'
            : 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
          color: 'white',
          padding: '20px 24px',
          borderRadius: '16px',
          fontWeight: '800',
          fontSize: 'clamp(1rem, 4.5vw, 1.3rem)',
          boxShadow: '0 10px 40px rgba(0,0,0,0.6)',
          animation: 'toastIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards',
          textAlign: 'center',
          lineHeight: 1.4,
          pointerEvents: 'none',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255,255,255,0.2)',
        }}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

// ---- Full-screen winner overlay ----
function WinnerOverlay({ message, emoji, onClose }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.75)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        animation: 'overlayIn 0.3s ease forwards',
        cursor: 'pointer',
      }}
    >
      <div style={{
        textAlign: 'center',
        animation: 'popIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards',
      }}>
        <div style={{ fontSize: 'clamp(4rem, 20vw, 8rem)', marginBottom: '1rem', filter: 'drop-shadow(0 0 30px rgba(255,165,0,0.8))' }}>
          {emoji}
        </div>
        <h1 style={{
          fontSize: 'clamp(2rem, 8vw, 4rem)',
          background: 'linear-gradient(135deg, #ff8a00, #e52e71)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          fontWeight: '900',
          marginBottom: '1rem',
          textShadow: 'none',
        }}>
          {message}
        </h1>
        <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '1rem' }}>Toca para cerrar</p>
      </div>

      {/* Confetti dots */}
      {[...Array(20)].map((_, i) => (
        <div key={i} style={{
          position: 'absolute',
          width: `${Math.random() * 12 + 6}px`,
          height: `${Math.random() * 12 + 6}px`,
          borderRadius: '50%',
          background: ['#ff8a00', '#e52e71', '#00c851', '#2196F3', '#FFD700', '#ff007f'][i % 6],
          top: `${Math.random() * 100}%`,
          left: `${Math.random() * 100}%`,
          animation: `confetti ${Math.random() * 2 + 1}s ease-in-out ${Math.random() * 0.5}s infinite alternate`,
          opacity: 0.8,
        }} />
      ))}
    </div>
  );
}

let toastCounter = 0;

export default function PlayerGame() {
  const { roomId } = useParams();
  const socket = useSocket();
  const navigate = useNavigate();

  const [gameState, setGameState] = useState('WAITING');
  const [card, setCard] = useState([]);
  const [markedIndexes, setMarkedIndexes] = useState(new Set());
  const [winner, setWinner] = useState(null);

  // Claim state — prevent duplicate submissions
  const [hasClaimedLine, setHasClaimedLine] = useState(false);
  const [hasClaimedBingo, setHasClaimedBingo] = useState(false);
  const [roomLineClaimed, setRoomLineClaimed] = useState(false);
  const [lineSubmitting, setLineSubmitting] = useState(false);
  const [bingoSubmitting, setBingoSubmitting] = useState(false);

  // Toast system
  const [toasts, setToasts] = useState([]);
  const [overlay, setOverlay] = useState(null); // { message, emoji }

  const addToast = useCallback((message, type = 'info', duration = 4000) => {
    const id = ++toastCounter;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration);
  }, []);

  const showOverlay = useCallback((message, emoji) => {
    setOverlay({ message, emoji });
  }, []);

  // Inject animations once
  useEffect(() => {
    const style = document.createElement('style');
    style.id = 'player-game-animations';
    if (!document.getElementById('player-game-animations')) {
      style.textContent = `
        @keyframes toastIn {
          from { opacity: 0; transform: translateY(-20px) scale(0.9); }
          to   { opacity: 1; transform: translateY(0)    scale(1); }
        }
        @keyframes overlayIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes popIn {
          from { opacity: 0; transform: scale(0.5) rotate(-5deg); }
          to   { opacity: 1; transform: scale(1) rotate(0deg); }
        }
        @keyframes confetti {
          from { transform: translateY(0) rotate(0deg); opacity: 0.8; }
          to   { transform: translateY(-40px) rotate(180deg); opacity: 0.3; }
        }
        @keyframes cardPop {
          0%   { transform: scale(1); }
          50%  { transform: scale(0.88); }
          100% { transform: scale(0.95); }
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20%  { transform: translateX(-6px); }
          40%  { transform: translateX(6px); }
          60%  { transform: translateX(-4px); }
          80%  { transform: translateX(4px); }
        }
        @keyframes pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(255,138,0,0.7); }
          50%  { box-shadow: 0 0 0 12px rgba(255,138,0,0); }
        }
        .claim-btn-pulse {
          animation: pulse 1.5s infinite;
        }
      `;
      document.head.appendChild(style);
    }
    return () => {
      const el = document.getElementById('player-game-animations');
      if (el) el.remove();
    };
  }, []);

  // Progress reporter: send marked count to server every time marks change
  const progressReportTimer = useRef(null);
  useEffect(() => {
    if (!socket || gameState !== 'PLAYING') return;
    const playerId = localStorage.getItem('bingo_playerId');
    if (!playerId) return;

    clearTimeout(progressReportTimer.current);
    progressReportTimer.current = setTimeout(() => {
      socket.emit('updateProgress', {
        roomId: roomId.toUpperCase(),
        playerId,
        markedIndexes: Array.from(markedIndexes),
      });
    }, 300);
  }, [markedIndexes, socket, roomId, gameState]);

  // AUTO-RECONNECT: If we land here and we are not in the room yet
  useEffect(() => {
    if (!socket) return;
    
    const checkMembership = () => {
      const savedRoomId = localStorage.getItem('bingo_roomId');
      const savedPlayerId = localStorage.getItem('bingo_playerId');
      const savedPlayerName = localStorage.getItem('bingo_playerName');

      if (savedRoomId === roomId.toUpperCase() && savedPlayerId) {
        // We have a session for this room, let's make sure we are joined
        socket.emit('joinRoom', { 
          roomId: savedRoomId, 
          playerName: savedPlayerName, 
          playerId: savedPlayerId 
        });
      }
    };

    if (socket.connected) {
      checkMembership();
    }
    
    socket.on('connect', checkMembership);
    return () => socket.off('connect', checkMembership);
  }, [socket, roomId]);

  useEffect(() => {
    if (!socket) return;

    socket.on('gameStarted', ({ card, markedIndexes, currentSong, hasLine, hasBingo, roomLineClaimed }) => {
      setCard(card);
      setGameState('PLAYING');
      setHasClaimedLine(hasLine || false);
      setRoomLineClaimed(roomLineClaimed || false);
      setHasClaimedBingo(hasBingo || false);
      
      if (markedIndexes && markedIndexes.length > 0) {
        setMarkedIndexes(new Set(markedIndexes));
      } else {
        setMarkedIndexes(new Set());
      }
    });

    socket.on('bingoWinner', ({ player }) => {
      setWinner(player);
      setGameState('GAME_OVER');
    });

    socket.on('lineWinner', ({ player }) => {
      const isMine = socket.id === player.socketId;
      setRoomLineClaimed(true);
      if (isMine) {
        setHasClaimedLine(true);
        setLineSubmitting(false);
        showOverlay(`¡HAS CANTADO LÍNEA! 🎉\n${player.name}`, '📢');
      } else {
        showOverlay(`¡LÍNEA! 📣\n${player.name} ha cantado línea`, '🔔');
      }
      addToast(`📢 ${player.name} cantó LÍNEA — ¡Seguimos para Bingo!`, 'winner', 6000);
    });

    socket.on('winInvalid', ({ reason, invalidIndexes, type }) => {
      setLineSubmitting(false);
      setBingoSubmitting(false);

      if (reason === 'ALREADY_CLAIMED_LINE') {
        addToast('⚠️ Ya cantaste línea anteriormente', 'error', 3000);
        setHasClaimedLine(true);
        return;
      }
      if (reason === 'LINE_ALREADY_CLAIMED') {
        addToast('⚠️ Alguien ya cantó línea en esta ronda', 'error', 3000);
        return;
      }
      if (reason === 'INVALID_MARKS') {
        if (type === 'LINE' && roomLineClaimed) {
          addToast('📢 ¡La línea ya fue cantada! Y además, tienes canciones marcadas que aún no han sonado. Se desmarcarán.', 'error', 6000);
        } else {
          addToast('🚫 ¡Tienes canciones marcadas que aún no han sonado! Se desmarcarán.', 'error', 5000);
        }
        
        if (invalidIndexes && invalidIndexes.length > 0) {
          setMarkedIndexes(prev => {
            const next = new Set(prev);
            invalidIndexes.forEach(idx => next.delete(idx));
            return next;
          });
        }
      } else {
        const msg = type === 'BINGO'
          ? '🎲 ¡Todavía no tienes el cartón completo! Sigue jugando para el Bingo.'
          : '🎯 ¡Todavía no tienes una línea completa! Revisa bien tu cartón.';
        addToast(msg, 'error', 4000);
      }
    });

    socket.on('roomDestroyed', () => {
      addToast('❌ El presentador cerró la sala.', 'error', 4000);
      setTimeout(() => navigate('/'), 2000);
    });

    return () => {
      socket.off('gameStarted');
      socket.off('bingoWinner');
      socket.off('lineWinner');
      socket.off('winInvalid');
      socket.off('roomDestroyed');
    };
  }, [socket, navigate, addToast, showOverlay]);

  const toggleMark = (index) => {
    if (gameState !== 'PLAYING') return;
    setMarkedIndexes(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const checkLocalGeometry = () => {
    let hasLine = false;
    let hasBingo = markedIndexes.size === 16;
    
    if (markedIndexes.size >= 4) {
      const gridSize = 4;
      const isMarked = (idx) => markedIndexes.has(idx);

      // Rows
      for (let r = 0; r < gridSize; r++) {
        let rowMatch = true;
        for (let c = 0; c < gridSize; c++) {
          if (!isMarked(r * gridSize + c)) rowMatch = false;
        }
        if (rowMatch) hasLine = true;
      }

      // Columns
      for (let c = 0; c < gridSize; c++) {
        let colMatch = true;
        for (let r = 0; r < gridSize; r++) {
          if (!isMarked(r * gridSize + c)) colMatch = false;
        }
        if (colMatch) hasLine = true;
      }

      // Diagonals
      let d1 = true, d2 = true;
      for (let i = 0; i < gridSize; i++) {
        if (!isMarked(i * gridSize + i)) d1 = false;
        if (!isMarked(i * gridSize + (gridSize - 1 - i))) d2 = false;
      }
      if (d1 || d2) hasLine = true;
    }

    return { localLine: hasLine, localBingo: hasBingo };
  };

  const { localLine, localBingo } = checkLocalGeometry();

  const claimLine = () => {
    if (hasClaimedLine) {
      addToast('✅ Ya cantaste línea en esta partida', 'info', 3000);
      return;
    }
    if (!localLine) {
      addToast('❌ Aún no tienes una Línea (4 en raya). Revisa tu cartón.', 'error', 3000);
      return;
    }
    if (lineSubmitting) return;
    
    setLineSubmitting(true);
    socket.emit('claimWin', {
      roomId: roomId.toUpperCase(),
      playerId: localStorage.getItem('bingo_playerId'),
      markedIndexes: Array.from(markedIndexes),
      type: 'LINE',
    });
    // Reset submit lock after 3s if no response
    setTimeout(() => setLineSubmitting(false), 3000);
  };

  const claimBingo = () => {
    if (hasClaimedBingo) return;
    if (!localBingo) {
      addToast('❌ ¡Necesitas marcar las 16 canciones para el Bingo lleno!', 'error', 3000);
      return;
    }
    if (bingoSubmitting) return;
    
    setBingoSubmitting(true);
    socket.emit('claimWin', {
      roomId: roomId.toUpperCase(),
      playerId: localStorage.getItem('bingo_playerId'),
      markedIndexes: Array.from(markedIndexes),
      type: 'BINGO',
    });
    setTimeout(() => setBingoSubmitting(false), 3000);
  };

  // ---- WAITING STATE ----
  if (gameState === 'WAITING') {
    return (
      <div className="glass-panel" style={{ maxWidth: '400px', margin: '15vh auto', textAlign: 'center', position: 'relative' }}>
        <button
          className="secondary"
          onClick={() => navigate('/')}
          style={{ position: 'absolute', top: '10px', right: '10px', padding: '5px 15px', fontSize: '0.8rem' }}
        >
          Atrás
        </button>
        <h2 style={{ marginBottom: '2rem' }}>¡Ya estás dentro! 🎉</h2>
        <p style={{ margin: '2rem 0', color: 'var(--text-muted)', fontSize: '1.2rem' }}>
          Esperando a que el presentador inicie el juego...
        </p>
        <div style={{ padding: '10px 20px', background: 'var(--glass-bg)', display: 'inline-block', borderRadius: '50px' }}>
          PIN de sala: <strong style={{ letterSpacing: '2px' }}>{roomId}</strong>
        </div>
      </div>
    );
  }

  // ---- PLAYING STATE ----
  if (gameState === 'PLAYING') {
    const canClaimLine = !hasClaimedLine && localLine;
    const canClaimBingo = !hasClaimedBingo && localBingo;

    return (
      <>
        <Toast toasts={toasts} />
        {overlay && (
          <WinnerOverlay
            message={overlay.message}
            emoji={overlay.emoji}
            onClose={() => setOverlay(null)}
          />
        )}
        <div style={{ maxWidth: '600px', margin: '0 auto', padding: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <h3 style={{ color: 'var(--text-muted)', margin: 0, fontSize: 'clamp(0.8rem, 3vw, 1.1rem)' }}>
              Sala: {roomId}
            </h3>
            <div style={{ color: 'var(--accent-color)', fontWeight: 'bold', fontSize: 'clamp(0.8rem, 3vw, 1rem)' }}>
              {markedIndexes.size} / 16 ✓
            </div>
          </div>

          {/* LINE claimed badge */}
          {hasClaimedLine && (
            <div style={{
              background: 'linear-gradient(135deg, #00c851, #007E33)',
              borderRadius: '10px',
              padding: '8px 16px',
              marginBottom: '0.75rem',
              textAlign: 'center',
              fontWeight: '700',
              fontSize: '0.9rem',
            }}>
              ✅ ¡Ya cantaste LÍNEA! Ahora ve por el BINGO completo 🎯
            </div>
          )}

          {/* BINGO CARD GRID (4x4) */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 'clamp(4px, 1.5vw, 10px)',
            marginBottom: '0.75rem'
          }}>
            {card.map((song, i) => {
              const isMarked = markedIndexes.has(i);
              return (
                <div
                  key={i}
                  onClick={() => toggleMark(i)}
                  style={{
                    aspectRatio: '1',
                    background: isMarked
                      ? 'linear-gradient(135deg, var(--primary-color), var(--secondary-color))'
                      : 'var(--glass-bg)',
                    border: isMarked ? 'none' : '1px solid var(--glass-border)',
                    borderRadius: 'clamp(6px, 2vw, 12px)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 'clamp(3px, 1vw, 8px)',
                    cursor: 'pointer',
                    transition: 'all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                    transform: isMarked ? 'scale(0.95)' : 'scale(1)',
                    boxShadow: isMarked ? '0 5px 15px rgba(106, 17, 203, 0.4)' : 'var(--glass-shadow)',
                    textAlign: 'center',
                    overflow: 'hidden',
                    position: 'relative',
                    userSelect: 'none',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  {song.imageUrl && !isMarked && (
                    <div style={{
                      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                      backgroundImage: `url(${song.imageUrl})`,
                      backgroundSize: 'cover', backgroundPosition: 'center',
                      opacity: 0.15, borderRadius: 'inherit'
                    }} />
                  )}
                  {isMarked && (
                    <div style={{
                      position: 'absolute', inset: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 'clamp(1.2rem, 5vw, 2rem)', opacity: 0.3, zIndex: 0,
                    }}>✓</div>
                  )}
                  <div style={{
                    fontSize: 'clamp(0.55rem, 2.5vw, 0.8rem)', fontWeight: '800',
                    display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
                    overflow: 'hidden', zIndex: 1,
                    textShadow: isMarked ? '0 1px 2px rgba(0,0,0,0.5)' : 'none',
                    lineHeight: 1.2
                  }}>
                    {song.name}
                  </div>
                  <div style={{
                    fontSize: 'clamp(0.45rem, 2vw, 0.65rem)',
                    color: isMarked ? 'rgba(255,255,255,0.8)' : 'var(--text-muted)',
                    marginTop: '2px', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                    overflow: 'hidden', width: '100%', zIndex: 1, fontWeight: '300'
                  }}>
                    {song.artist}
                  </div>
                </div>
              );
            })}
          </div>

          {/* ACTION BUTTONS */}
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={claimLine}
              disabled={hasClaimedLine || lineSubmitting || !localLine}
              className={canClaimLine && !hasClaimedLine ? 'claim-btn-pulse' : ''}
              style={{
                flex: 1,
                padding: '15px',
                fontSize: '1.2rem',
                background: hasClaimedLine
                  ? 'linear-gradient(90deg, #555, #444)'
                  : lineSubmitting
                  ? 'linear-gradient(90deg, #888, #666)'
                  : localLine
                  ? 'linear-gradient(90deg, #ff8a00, #e52e71)'
                  : 'linear-gradient(90deg, #333, #444)',
                borderRadius: '15px',
                boxShadow: (hasClaimedLine || !localLine) ? 'none' : '0 5px 15px rgba(229, 46, 113, 0.3)',
                WebkitTapHighlightColor: 'transparent',
                opacity: (hasClaimedLine || !localLine) ? 0.6 : 1,
                cursor: (hasClaimedLine || !localLine) ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              {hasClaimedLine ? '✅ LÍNEA' : lineSubmitting ? '⏳ ...' : '📢 ¡LÍNEA!'}
            </button>
            <button
              onClick={claimBingo}
              disabled={hasClaimedBingo || bingoSubmitting || !localBingo}
              className={canClaimBingo && !hasClaimedBingo ? 'claim-btn-pulse' : ''}
              style={{
                flex: 1.5,
                padding: '15px',
                fontSize: '1.2rem',
                background: hasClaimedBingo
                  ? 'linear-gradient(90deg, #555, #444)'
                  : bingoSubmitting
                  ? 'linear-gradient(90deg, #888, #666)'
                  : localBingo
                  ? 'linear-gradient(90deg, #ff007f, #ff8a00)'
                  : 'linear-gradient(90deg, #333, #444)',
                borderRadius: '15px',
                boxShadow: (hasClaimedBingo || !localBingo) ? 'none' : '0 5px 15px rgba(255, 0, 127, 0.3)',
                WebkitTapHighlightColor: 'transparent',
                opacity: (hasClaimedBingo || !localBingo) ? 0.6 : 1,
                cursor: (hasClaimedBingo || !localBingo) ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              {hasClaimedBingo ? '✅ BINGO' : bingoSubmitting ? '⏳ ...' : '🎉 ¡BINGO!'}
            </button>
          </div>
        </div>
      </>
    );
  }

  // ---- GAME OVER STATE ----
  if (gameState === 'GAME_OVER') {
    return (
      <div className="glass-panel" style={{ maxWidth: '500px', margin: '15vh auto', textAlign: 'center' }}>
        {winner?.socketId === socket.id ? (
          <>
            <h1 style={{ fontSize: '3.5rem', color: 'var(--accent-color)' }}>¡HAS GANADO! 🎉</h1>
            <p style={{ fontSize: '1.2rem', margin: '1rem 0' }}>¡Tu oído musical es insuperable!</p>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: '3rem' }}>FIN DEL JUEGO</h1>
            <p style={{ fontSize: '1.2rem', margin: '1rem 0', color: 'var(--text-muted)' }}>
              Ganador: <strong className="text-gradient">{winner?.name}</strong>
            </p>
          </>
        )}
        <button onClick={() => navigate('/')} style={{ marginTop: '2rem', width: '100%' }}>Volver al Inicio</button>
      </div>
    );
  }

  return null;
}
