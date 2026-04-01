import React, { useState, useEffect } from 'react';
import { useSocket } from '../context/SocketContext';
import { useNavigate } from 'react-router-dom';

export default function PlayerJoin() {
  const socket = useSocket();
  const navigate = useNavigate();

  const [roomId, setRoomId] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [hasSavedSession, setHasSavedSession] = useState(false);

  useEffect(() => {
    // Check for saved session
    const savedRoomId = localStorage.getItem('bingo_roomId');
    const savedPlayerId = localStorage.getItem('bingo_playerId');
    const savedPlayerName = localStorage.getItem('bingo_playerName');
    
    if (savedRoomId && savedPlayerId && savedPlayerName) {
      setHasSavedSession(true);
      setPlayerName(savedPlayerName);
    }
  }, []);

  useEffect(() => {
    if (!socket) return;
    
    socket.on('joinSuccess', ({ roomId, player }) => {
      localStorage.setItem('bingo_roomId', roomId);
      localStorage.setItem('bingo_playerId', player.id);
      localStorage.setItem('bingo_playerName', player.name);
      navigate(`/game/${roomId}`);
    });

    socket.on('joinError', ({ message }) => {
      setError(message);
      setLoading(false);
    });

    return () => {
      socket.off('joinSuccess');
      socket.off('joinError');
    };
  }, [socket, navigate]);

  const handleJoin = (e, isResume = false) => {
    if (e) e.preventDefault();
    if (!roomId || !playerName) {
      setError('Por favor, introduce el PIN y tu nombre.');
      return;
    }
    
    setLoading(true);
    setError(null);
    
    const playerId = isResume ? localStorage.getItem('bingo_playerId') : null;
    socket.emit('joinRoom', { roomId: roomId.toUpperCase(), playerName, playerId });
  };

  return (
    <div className="glass-panel" style={{ maxWidth: '400px', margin: '15vh auto', textAlign: 'center', position: 'relative' }}>
      <button 
        className="secondary" 
        onClick={() => navigate('/')} 
        style={{ position: 'absolute', top: '15px', right: '15px', padding: '5px 15px', fontSize: '0.8rem' }}
      >
        Atrás
      </button>
      <h2 style={{ marginBottom: '2rem' }}>Entrar a una Partida</h2>
      
      {error && <div style={{ color: '#ff4d4d', marginBottom: '1rem', padding: '10px', background: 'rgba(255,0,0,0.1)', borderRadius: '8px' }}>{error}</div>}

      <form onSubmit={handleJoin} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <div>
          <input 
            type="text" 
            placeholder="Room PIN" 
            value={roomId} 
            onChange={(e) => setRoomId(e.target.value)} 
            style={{ textAlign: 'center', fontSize: '1.5rem', letterSpacing: '3px', textTransform: 'uppercase' }}
            maxLength={6}
          />
        </div>
        <div>
          <input 
            type="text" 
            placeholder="Your Nickname" 
            value={playerName} 
            onChange={(e) => setPlayerName(e.target.value)}
            style={{ textAlign: 'center', fontSize: '1.2rem' }}
            maxLength={15}
          />
        </div>

        {hasSavedSession && roomId.toUpperCase() === localStorage.getItem('bingo_roomId')?.toUpperCase() && (
          <div style={{ marginBottom: '1.5rem', padding: '15px', background: 'rgba(59, 130, 246, 0.1)', borderRadius: '12px', border: '1px dashed var(--accent-color)' }}>
            <p style={{ margin: '0 0 10px 0', fontSize: '0.9rem', color: 'var(--text-muted)' }}>Hemos encontrado una partida anterior en esta sala:</p>
            <button 
              type="button" 
              className="accent"
              onClick={() => handleJoin(null, true)}
              style={{ width: '100%', fontSize: '1rem' }}
            >
              Reanudar Partida {roomId}
            </button>
          </div>
        )}

        <button type="submit" disabled={loading} style={{ width: '100%' }}>
          {loading ? 'Entrando...' : 'Entrar a la Partida'}
        </button>
      </form>
    </div>
  );
}
