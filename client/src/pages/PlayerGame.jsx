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
      zIndex: 2147483647, 
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

  const [hasClaimedLine, setHasClaimedLine] = useState(false);
  const [hasClaimedBingo, setHasClaimedBingo] = useState(false);
  const [roomLineClaimed, setRoomLineClaimed] = useState(false);
  const [lineSubmitting, setLineSubmitting] = useState(false);
  const [bingoSubmitting, setBingoSubmitting] = useState(false);
  
  const [lineAttempts, setLineAttempts] = useState(3);
  const [bingoAttempts, setBingoAttempts] = useState(3);

  const [toasts, setToasts] = useState([]);
  const [overlay, setOverlay] = useState(null);

  const addToast = useCallback((message, type = 'info', duration = 4000) => {
    const id = ++toastCounter;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration);
  }, []);

  const showOverlay = useCallback((message, emoji) => {
    setOverlay({ message, emoji });
  }, []);

  useEffect(() => {
    const style = document.createElement('style');
    style.id = 'player-game-animations';
    if (!document.getElementById('player-game-animations')) {
      style.textContent = `
        @keyframes toastIn {
          from { opacity: 0; transform: translateY(-20px) scale(0.9); }
          to   { opacity: 1; transform: translateY(0)    scale(1); }
        }
        @keyframes overlayIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes popIn {
          from { opacity: 0; transform: scale(0.5) rotate(-5deg); }
          to   { opacity: 1; transform: scale(1) rotate(0deg); }
        }
        .claim-btn-pulse { animation: pulse 1.5s infinite; }
        @keyframes pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(255,138,0,0.7); }
          50%  { box-shadow: 0 0 0 12px rgba(255,138,0,0); }
        }
      `;
      document.head.appendChild(style);
    }
  }, []);

  // Update progress to server
  useEffect(() => {
    if (!socket || gameState !== 'PLAYING') return;
    const playerId = localStorage.getItem('bingo_playerId');
    if (!playerId) return;

    const timer = setTimeout(() => {
      socket.emit('updateProgress', {
        roomId: roomId.toUpperCase(),
        playerId,
        markedIndexes: Array.from(markedIndexes),
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [markedIndexes, socket, roomId, gameState]);

  // Socket handlers
  useEffect(() => {
    if (!socket) return;

    const onJoinSuccess = ({ lineAttempts, bingoAttempts }) => {
      setLineAttempts(lineAttempts ?? 3);
      setBingoAttempts(bingoAttempts ?? 3);
    };

    const onGameStarted = ({ card, markedIndexes, hasLine, hasBingo, roomLineClaimed, lineAttempts, bingoAttempts }) => {
      setCard(card);
      setGameState('PLAYING');
      setHasClaimedLine(hasLine || false);
      setHasClaimedBingo(hasBingo || false);
      setRoomLineClaimed(roomLineClaimed || false);
      setLineAttempts(lineAttempts ?? 3);
      setBingoAttempts(bingoAttempts ?? 3);
      if (markedIndexes) setMarkedIndexes(new Set(markedIndexes));
    };

    const onLineWinner = ({ player }) => {
      const isMine = socket.id === player.socketId;
      setRoomLineClaimed(true);
      if (isMine) {
        setHasClaimedLine(true);
        setLineSubmitting(false);
        showOverlay(`¡HAS CANTADO LÍNEA! 🎉`, '📢');
      } else {
        showOverlay(`¡LÍNEA! 🎉\n${player.name}`, '🔔');
      }
      addToast(`📢 ${player.name} cantó LÍNEA!`, 'winner', 6000);
    };

    const onBingoWinner = ({ player }) => {
      setWinner(player);
      setGameState('GAME_OVER');
    };

    const onWinInvalid = ({ reason, invalidIndexes, type, attemptsLeft }) => {
      setLineSubmitting(false);
      setBingoSubmitting(false);

      if (type === 'LINE') setLineAttempts(attemptsLeft ?? 0);
      else setBingoAttempts(attemptsLeft ?? 0);

      if (reason === 'OUT_OF_ATTEMPTS') {
        addToast(`🚫 Te has quedado sin intentos para el ${type}.`, 'error', 6000);
        return;
      }

      if (reason === 'INVALID_MARKS') {
        addToast(`🚫 ¡Canciones mal marcadas detectadas! Se han desmarcado automáticamente.`, 'error', 6000);
        if (invalidIndexes) {
          setMarkedIndexes(prev => {
            const next = new Set(prev);
            invalidIndexes.forEach(idx => next.delete(idx));
            return next;
          });
        }
      } else {
        addToast(`🎯 ¡Todavía no está completo! Te quedan ${attemptsLeft} intentos.`, 'error', 4000);
      }
    };

    socket.on('joinSuccess', onJoinSuccess);
    socket.on('gameStarted', onGameStarted);
    socket.on('lineWinner', onLineWinner);
    socket.on('bingoWinner', onBingoWinner);
    socket.on('winInvalid', onWinInvalid);
    socket.on('roomDestroyed', () => navigate('/'));

    return () => {
      socket.off('joinSuccess', onJoinSuccess);
      socket.off('gameStarted', onGameStarted);
      socket.off('lineWinner', onLineWinner);
      socket.off('bingoWinner', onBingoWinner);
      socket.off('winInvalid', onWinInvalid);
      socket.off('roomDestroyed');
    };
  }, [socket, navigate, addToast, showOverlay]);

  const toggleMark = (index) => {
    if (gameState !== 'PLAYING') return;
    setMarkedIndexes(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const checkGeometry = () => {
    let hasLine = false;
    let hasBingo = markedIndexes.size === 16;
    if (markedIndexes.size >= 4) {
      const isMarked = (idx) => markedIndexes.has(idx);
      for (let r = 0; r < 4; r++) {
        let row = true;
        for (let c = 0; c < 4; c++) if (!isMarked(r * 4 + c)) row = false;
        if (row) hasLine = true;
      }
      for (let c = 0; c < 4; c++) {
        let col = true;
        for (let r = 0; r < 4; r++) if (!isMarked(r * 4 + c)) col = false;
        if (col) hasLine = true;
      }
      let d1 = true, d2 = true;
      for (let i = 0; i < 4; i++) {
        if (!isMarked(i * 4 + i)) d1 = false;
        if (!isMarked(i * 4 + (3 - i))) d2 = false;
      }
      if (d1 || d2) hasLine = true;
    }
    return { localLine: hasLine, localBingo: hasBingo };
  };

  const { localLine, localBingo } = checkGeometry();

  const claimLine = () => {
    if (hasClaimedLine) {
      addToast('✅ Ya has cantado línea.', 'info');
      return;
    }
    if (lineAttempts <= 0) {
      addToast('🚫 No te quedan intentos de línea.', 'error');
      return;
    }
    if (!localLine) {
      addToast('❌ No tienes una línea completa todavía.', 'error');
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
  };

  const claimBingo = () => {
    if (hasClaimedBingo) {
      addToast('✅ Ya has cantado bingo.', 'info');
      return;
    }
    if (bingoAttempts <= 0) {
      addToast('🚫 No te quedan intentos de bingo.', 'error');
      return;
    }
    if (!localBingo) {
      addToast('❌ Te faltan canciones para el bingo.', 'error');
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
  };

  if (gameState === 'WAITING') {
    return (
      <div className="glass-panel" style={{ maxWidth: '400px', margin: '15vh auto', textAlign: 'center' }}>
        <h2>¡Ya estás dentro! 🎉</h2>
        <p>Esperando a que el presentador inicie...</p>
        <div style={{ padding: '10px 20px', background: 'var(--glass-bg)', borderRadius: '50px' }}>
          PIN: <strong>{roomId}</strong>
        </div>
      </div>
    );
  }

  if (gameState === 'PLAYING') {
    return (
      <div style={{ maxWidth: '600px', margin: '0 auto', padding: '10px' }}>
        <Toast toasts={toasts} />
        {overlay && <WinnerOverlay message={overlay.message} emoji={overlay.emoji} onClose={() => setOverlay(null)} />}
        
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
          <h3 style={{ margin: 0 }}>Sala: {roomId}</h3>
          <div style={{ color: 'var(--accent-color)', fontWeight: 'bold' }}>{markedIndexes.size} / 16</div>
        </div>

        {hasClaimedLine && (
          <div style={{ background: 'var(--success-color)', borderRadius: '10px', padding: '8px', marginBottom: '10px', textAlign: 'center' }}>
            ✅ ¡LÍNEA CANTADA! 🎉
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '15px' }}>
          {card.map((song, i) => {
            const isMarked = markedIndexes.has(i);
            return (
              <div
                key={i}
                onClick={() => toggleMark(i)}
                style={{
                  aspectRatio: '1',
                  background: isMarked ? 'linear-gradient(135deg, var(--primary-color), var(--secondary-color))' : 'var(--glass-bg)',
                  borderRadius: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '5px',
                  cursor: 'pointer',
                  textAlign: 'center',
                  fontSize: '0.75rem',
                  fontWeight: '700',
                  border: isMarked ? 'none' : '1px solid var(--glass-border)',
                  position: 'relative',
                  overflow: 'hidden',
                  userSelect: 'none',
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                {/* Background Image Effect */}
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
                    fontSize: '2rem', opacity: 0.2, zIndex: 0,
                  }}>✓</div>
                )}
                
                <div style={{ 
                  zIndex: 1, 
                  WebkitLineClamp: 3, 
                  display: '-webkit-box', 
                  WebkitBoxOrient: 'vertical', 
                  overflow: 'hidden',
                  padding: '4px',
                  textShadow: isMarked ? '0 1px 2px rgba(0,0,0,0.5)' : 'none'
                }}>
                  {song.name}
                </div>
                <div style={{ zIndex: 1, fontSize: '0.6rem', opacity: 0.8, fontWeight: '300' }}>
                  {song.artist}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={claimLine}
            className={(canClaimLine && !hasClaimedLine) ? 'claim-btn-pulse' : ''}
            style={{ 
              flex: 1, 
              padding: '15px', 
              fontSize: '1.1rem',
              borderRadius: '12px',
              border: 'none',
              color: 'white',
              cursor: (hasClaimedLine || lineAttempts <= 0) ? 'not-allowed' : 'pointer',
              opacity: (hasClaimedLine || lineAttempts <= 0) ? 0.5 : 1,
              background: (hasClaimedLine || lineAttempts <= 0) ? '#444' : 'linear-gradient(90deg, #ff8a00, #e52e71)',
              transition: 'all 0.2s ease'
            }}
          >
            {hasClaimedLine ? '✅ LÍNEA' : lineAttempts <= 0 ? '🚫 BLOQUEADO' : `📢 LÍNEA (${lineAttempts})`}
          </button>
          <button
            onClick={claimBingo}
            className={(canClaimBingo && !hasClaimedBingo) ? 'claim-btn-pulse' : ''}
            style={{ 
              flex: 1.2, 
              padding: '15px', 
              fontSize: '1.1rem',
              borderRadius: '12px',
              border: 'none',
              color: 'white',
              cursor: (hasClaimedBingo || bingoAttempts <= 0) ? 'not-allowed' : 'pointer',
              opacity: (hasClaimedBingo || bingoAttempts <= 0) ? 0.5 : 1,
              background: (hasClaimedBingo || bingoAttempts <= 0) ? '#444' : 'linear-gradient(90deg, #ff007f, #ff8a00)',
              transition: 'all 0.2s ease'
            }}
          >
            {hasClaimedBingo ? '✅ BINGO' : bingoAttempts <= 0 ? '🚫 BLOQUEADO' : `🎉 BINGO (${bingoAttempts})`}
          </button>
        </div>
      </div>
    );
  }

  if (gameState === 'GAME_OVER') {
    return (
      <div className="glass-panel" style={{ maxWidth: '500px', margin: '15vh auto', textAlign: 'center' }}>
        <h1>GANADOR: {winner?.name} 🎉</h1>
        <button onClick={() => navigate('/')} style={{ marginTop: '20px', width: '100%' }}>Volver al Inicio</button>
      </div>
    );
  }

  return null;
}
