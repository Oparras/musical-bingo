import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSocket } from '../context/SocketContext';
import { useParams, useNavigate } from 'react-router-dom';

// ---- Toast / Popup component ----
function Toast({ toasts }) {
  if (toasts.length === 0) return null;
  return (
    <div style={{
      position: 'fixed', top: '5%', left: '50%', transform: 'translateX(-50%)',
      zIndex: 2147483647, display: 'flex', flexDirection: 'column', gap: '10px',
      alignItems: 'center', pointerEvents: 'none', width: '95vw', maxWidth: '600px',
    }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          background: t.type === 'success' ? 'linear-gradient(135deg, #00c851, #007E33)'
            : t.type === 'winner' ? 'linear-gradient(135deg, #ff8a00, #e52e71)'
              : t.type === 'error' ? 'linear-gradient(135deg, #ef4444, #b91c1c)'
                : 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
          color: 'white', padding: '20px 24px', borderRadius: '16px',
          fontWeight: '800', fontSize: 'clamp(1rem, 4.5vw, 1.3rem)',
          boxShadow: '0 10px 40px rgba(0,0,0,0.6)',
          animation: 'toastIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards',
          textAlign: 'center', lineHeight: 1.4, pointerEvents: 'none',
          backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.2)',
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
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
      backdropFilter: 'blur(8px)', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', zIndex: 10000,
      animation: 'overlayIn 0.3s ease forwards', cursor: 'pointer',
    }}>
      <div style={{ textAlign: 'center', animation: 'popIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards' }}>
        <div style={{ fontSize: 'clamp(4rem, 20vw, 8rem)', marginBottom: '1rem', filter: 'drop-shadow(0 0 30px rgba(255,165,0,0.8))' }}>
          {emoji}
        </div>
        <h1 style={{
          fontSize: 'clamp(2rem, 8vw, 4rem)',
          background: 'linear-gradient(135deg, #ff8a00, #e52e71)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          fontWeight: '900', marginBottom: '1rem', textShadow: 'none',
        }}>
          {message}
        </h1>
        <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '1rem' }}>Toca para cerrar</p>
      </div>
    </div>
  );
}

let toastCounter = 0;

// Keys para localStorage
const LS_ROOM = 'bingo_roomId';
const LS_PLAYER = 'bingo_playerId';
const LS_NAME = 'bingo_playerName';
const LS_CARD = (roomId, playerId) => `bingo_card_${roomId}_${playerId}`;
const LS_MARKED = (roomId, playerId) => `bingo_marked_${roomId}_${playerId}`;
const LS_STATE = (roomId, playerId) => `bingo_state_${roomId}_${playerId}`;

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

  // Inject animations
  useEffect(() => {
    if (!document.getElementById('player-game-animations')) {
      const style = document.createElement('style');
      style.id = 'player-game-animations';
      style.textContent = `
        @keyframes toastIn {
          from { opacity: 0; transform: translateY(-20px) scale(0.9); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
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

  // ── FIX: Cargar estado desde localStorage al montar ──────────────────────
  useEffect(() => {
    const playerId = localStorage.getItem(LS_PLAYER);
    if (!playerId || !roomId) return;

    const savedCard = localStorage.getItem(LS_CARD(roomId, playerId));
    const savedMarked = localStorage.getItem(LS_MARKED(roomId, playerId));
    const savedState = localStorage.getItem(LS_STATE(roomId, playerId));

    if (savedCard) {
      try {
        const parsedCard = JSON.parse(savedCard);
        if (parsedCard && parsedCard.length > 0) {
          setCard(parsedCard);
          setGameState('PLAYING'); // Mostrar cartón inmediatamente, no esperar al servidor
        }
      } catch (e) { /* ignorar */ }
    }

    if (savedMarked) {
      try {
        const parsedMarked = JSON.parse(savedMarked);
        setMarkedIndexes(new Set(parsedMarked));
      } catch (e) { /* ignorar */ }
    }

    if (savedState) {
      try {
        const s = JSON.parse(savedState);
        if (s.hasClaimedLine) setHasClaimedLine(s.hasClaimedLine);
        if (s.hasClaimedBingo) setHasClaimedBingo(s.hasClaimedBingo);
        if (s.lineAttempts !== undefined) setLineAttempts(s.lineAttempts);
        if (s.bingoAttempts !== undefined) setBingoAttempts(s.bingoAttempts);
      } catch (e) { /* ignorar */ }
    }
  }, [roomId]);

  // ── FIX: Guardar casillas marcadas en localStorage al cambiar ─────────────
  useEffect(() => {
    const playerId = localStorage.getItem(LS_PLAYER);
    if (!playerId || !roomId || gameState !== 'PLAYING') return;

    // Guardar marcadas
    localStorage.setItem(
      LS_MARKED(roomId, playerId),
      JSON.stringify(Array.from(markedIndexes))
    );

    // Sincronizar con servidor (debounced)
    if (!socket) return;
    const timer = setTimeout(() => {
      socket.emit('updateProgress', {
        roomId: roomId.toUpperCase(),
        playerId,
        markedIndexes: Array.from(markedIndexes),
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [markedIndexes, socket, roomId, gameState]);

  // ── FIX: Guardar estado del juego cuando cambia ───────────────────────────
  useEffect(() => {
    const playerId = localStorage.getItem(LS_PLAYER);
    if (!playerId || !roomId) return;
    localStorage.setItem(LS_STATE(roomId, playerId), JSON.stringify({
      hasClaimedLine,
      hasClaimedBingo,
      lineAttempts,
      bingoAttempts,
    }));
  }, [hasClaimedLine, hasClaimedBingo, lineAttempts, bingoAttempts, roomId]);

  // ── Socket handlers ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    const onJoinSuccess = (data) => {
      if (data.lineAttempts !== undefined) setLineAttempts(data.lineAttempts);
      if (data.bingoAttempts !== undefined) setBingoAttempts(data.bingoAttempts);
    };

    const onGameStarted = ({ card: serverCard, markedIndexes: serverMarked, hasLine, hasBingo,
      roomLineClaimed: rLC, lineAttempts: lA, bingoAttempts: bA }) => {
      const playerId = localStorage.getItem(LS_PLAYER);

      // Guardar cartón en localStorage para recuperarlo si se recarga
      if (serverCard && serverCard.length > 0 && playerId) {
        localStorage.setItem(LS_CARD(roomId, playerId), JSON.stringify(serverCard));
        setCard(serverCard);
      }

      setGameState('PLAYING');
      setHasClaimedLine(hasLine || false);
      setHasClaimedBingo(hasBingo || false);
      setRoomLineClaimed(rLC || false);

      if (lA !== undefined) setLineAttempts(lA);
      if (bA !== undefined) setBingoAttempts(bA);

      // El servidor manda las casillas marcadas al reconectar — tiene prioridad
      // sobre lo que teníamos en localStorage (es la fuente de verdad)
      if (serverMarked && serverMarked.length > 0) {
        setMarkedIndexes(new Set(serverMarked));
        if (playerId) {
          localStorage.setItem(LS_MARKED(roomId, playerId), JSON.stringify(serverMarked));
        }
      }
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
      // Limpiar localStorage al terminar la partida
      const playerId = localStorage.getItem(LS_PLAYER);
      if (playerId && roomId) {
        localStorage.removeItem(LS_CARD(roomId, playerId));
        localStorage.removeItem(LS_MARKED(roomId, playerId));
        localStorage.removeItem(LS_STATE(roomId, playerId));
      }
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

    const onRoomDestroyed = () => {
      // Limpiar sesión al destruir la sala
      const playerId = localStorage.getItem(LS_PLAYER);
      if (playerId && roomId) {
        localStorage.removeItem(LS_CARD(roomId, playerId));
        localStorage.removeItem(LS_MARKED(roomId, playerId));
        localStorage.removeItem(LS_STATE(roomId, playerId));
      }
      localStorage.removeItem(LS_ROOM);
      localStorage.removeItem(LS_PLAYER);
      localStorage.removeItem(LS_NAME);
      navigate('/');
    };

    socket.on('joinSuccess', onJoinSuccess);
    socket.on('gameStarted', onGameStarted);
    socket.on('lineWinner', onLineWinner);
    socket.on('bingoWinner', onBingoWinner);
    socket.on('winInvalid', onWinInvalid);
    socket.on('roomDestroyed', onRoomDestroyed);

    return () => {
      socket.off('joinSuccess', onJoinSuccess);
      socket.off('gameStarted', onGameStarted);
      socket.off('lineWinner', onLineWinner);
      socket.off('bingoWinner', onBingoWinner);
      socket.off('winInvalid', onWinInvalid);
      socket.off('roomDestroyed', onRoomDestroyed);
    };
  }, [socket, navigate, addToast, showOverlay, roomId]);

  const toggleMark = (index) => {
    if (gameState !== 'PLAYING' || lineSubmitting || bingoSubmitting) return;
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

  const claimWin = (type) => {
    if (!socket) return;
    if (type === 'LINE') {
      if (hasClaimedLine || lineAttempts <= 0 || lineSubmitting) return;
      if (!localLine) { addToast('❌ No tienes una línea todavía.', 'error'); return; }
      setLineSubmitting(true);
    } else {
      if (hasClaimedBingo || bingoAttempts <= 0 || bingoSubmitting) return;
      if (!localBingo) { addToast('❌ Te faltan canciones para el bingo.', 'error'); return; }
      setBingoSubmitting(true);
    }

    socket.emit('claimWin', {
      roomId: roomId.toUpperCase(),
      playerId: localStorage.getItem(LS_PLAYER),
      markedIndexes: Array.from(markedIndexes),
      type,
    });
  };

  // ── Render: WAITING ───────────────────────────────────────────────────────
  if (gameState === 'WAITING') {
    return (
      <div className="glass-panel" style={{ maxWidth: '400px', margin: '15vh auto', textAlign: 'center' }}>
        <h2>¡Ya estás dentro! 🎉</h2>
        <p>Esperando a que el presentador inicie...</p>
        <div style={{ padding: '10px 20px', background: 'var(--glass-bg)', borderRadius: '50px', marginTop: '1rem' }}>
          PIN: <strong>{roomId}</strong>
        </div>
      </div>
    );
  }

  // ── Render: PLAYING ───────────────────────────────────────────────────────
  if (gameState === 'PLAYING') {
    return (
      <div style={{ maxWidth: '600px', margin: '0 auto', padding: '10px' }}>
        <Toast toasts={toasts} />
        {overlay && <WinnerOverlay message={overlay.message} emoji={overlay.emoji} onClose={() => setOverlay(null)} />}

        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--text-muted)' }}>SALA: {roomId}</h3>
          <div style={{ color: 'var(--accent-color)', fontWeight: '900', fontSize: '1.1rem' }}>{markedIndexes.size} / 16 ✓</div>
        </div>

        {hasClaimedLine && (
          <div style={{
            background: 'linear-gradient(90deg, #00c851, #007E33)',
            borderRadius: '12px', padding: '10px', marginBottom: '15px',
            textAlign: 'center', fontWeight: '800', fontSize: '1rem',
            boxShadow: '0 4px 15px rgba(0, 200, 81, 0.3)'
          }}>
            ✅ ¡LÍNEA CANTADA! 🎉
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'clamp(4px, 1.5vw, 12px)', marginBottom: '20px' }}>
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
                  borderRadius: '16px',
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                  padding: 'clamp(3px, 1vw, 8px)',
                  cursor: 'pointer', textAlign: 'center',
                  fontSize: 'clamp(0.6rem, 2.5vw, 0.8rem)', fontWeight: '800',
                  border: isMarked ? 'none' : '1px solid var(--glass-border)',
                  position: 'relative', overflow: 'hidden',
                  transition: 'all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                  transform: isMarked ? 'scale(0.95)' : 'scale(1)',
                  boxShadow: isMarked ? '0 8px 20px rgba(106, 17, 203, 0.4)' : 'var(--glass-shadow)',
                  userSelect: 'none', WebkitTapHighlightColor: 'transparent'
                }}
              >
                {song.imageUrl && !isMarked && (
                  <div style={{
                    position: 'absolute', inset: 0,
                    backgroundImage: `url(${song.imageUrl})`,
                    backgroundSize: 'cover', backgroundPosition: 'center',
                    opacity: 0.35, borderRadius: 'inherit', zIndex: 0
                  }} />
                )}
                {isMarked && (
                  <div style={{
                    position: 'absolute', inset: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 'clamp(1.5rem, 6vw, 2.5rem)', opacity: 0.3, zIndex: 0
                  }}>✓</div>
                )}
                <div style={{
                  zIndex: 2, WebkitLineClamp: 3,
                  display: '-webkit-box', WebkitBoxOrient: 'vertical', overflow: 'hidden',
                  textShadow: '0 1px 4px rgba(0,0,0,0.8)', lineHeight: 1.2, width: '100%', padding: '2px'
                }}>{song.name}</div>
                <div style={{
                  zIndex: 1, fontSize: 'clamp(0.45rem, 2vw, 0.65rem)', opacity: 0.8,
                  fontWeight: '300', marginTop: '2px',
                  whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden', width: '90%'
                }}>{song.artist}</div>
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={() => claimWin('LINE')}
            disabled={hasClaimedLine || lineAttempts <= 0 || lineSubmitting}
            className={(!hasClaimedLine && localLine) ? 'claim-btn-pulse' : ''}
            style={{
              flex: 1, padding: '18px', fontSize: '1.2rem', fontWeight: '900',
              borderRadius: '20px', border: 'none', color: 'white',
              cursor: (hasClaimedLine || lineAttempts <= 0) ? 'not-allowed' : 'pointer',
              opacity: (hasClaimedLine || lineAttempts <= 0) ? 0.6 : 1,
              background: (hasClaimedLine || lineAttempts <= 0) ? '#333' : 'linear-gradient(90deg, #ff8a00, #e52e71)',
              boxShadow: (hasClaimedLine || lineAttempts <= 0) ? 'none' : '0 10px 25px rgba(229, 46, 113, 0.4)',
              transition: 'all 0.3s ease'
            }}
          >
            {hasClaimedLine ? '✅ LÍNEA' : lineAttempts <= 0 ? '🚫 BLOQUEADO' : `📢 LÍNEA (${lineAttempts})`}
          </button>
          <button
            onClick={() => claimWin('BINGO')}
            disabled={hasClaimedBingo || bingoAttempts <= 0 || bingoSubmitting}
            className={(!hasClaimedBingo && localBingo) ? 'claim-btn-pulse' : ''}
            style={{
              flex: 1.3, padding: '18px', fontSize: '1.2rem', fontWeight: '900',
              borderRadius: '20px', border: 'none', color: 'white',
              cursor: (hasClaimedBingo || bingoAttempts <= 0) ? 'not-allowed' : 'pointer',
              opacity: (hasClaimedBingo || bingoAttempts <= 0) ? 0.6 : 1,
              background: (hasClaimedBingo || bingoAttempts <= 0) ? '#333' : 'linear-gradient(90deg, #ff007f, #ff8a00)',
              boxShadow: (hasClaimedBingo || bingoAttempts <= 0) ? 'none' : '0 10px 25px rgba(255, 0, 127, 0.4)',
              transition: 'all 0.3s ease'
            }}
          >
            {hasClaimedBingo ? '✅ BINGO' : bingoAttempts <= 0 ? '🚫 BLOQUEADO' : `🎉 BINGO (${bingoAttempts})`}
          </button>
        </div>
      </div>
    );
  }

  // ── Render: GAME_OVER ─────────────────────────────────────────────────────
  if (gameState === 'GAME_OVER') {
    return (
      <div className="glass-panel" style={{ maxWidth: '500px', margin: '15vh auto', textAlign: 'center' }}>
        <h1 style={{ fontSize: 'clamp(2.5rem, 10vw, 4rem)', color: 'var(--accent-color)', fontWeight: '900' }}>
          {winner?.socketId === socket?.id ? '¡GANASTE! 🎉' : 'FIN DEL JUEGO'}
        </h1>
        <p style={{ fontSize: '1.5rem', marginTop: '1rem', opacity: 0.8 }}>
          Ganador: <strong style={{ color: 'white' }}>{winner?.name}</strong>
        </p>
        <button
          onClick={() => navigate('/')}
          style={{ marginTop: '2.5rem', width: '100%', padding: '20px', fontSize: '1.3rem', fontWeight: '800' }}
        >
          Volver al Inicio
        </button>
      </div>
    );
  }

  return null;
}
