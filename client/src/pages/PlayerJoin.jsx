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

  useEffect(() => {
    if (!socket) return;
    
    socket.on('joinSuccess', ({ roomId }) => {
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

  const handleJoin = (e) => {
    e.preventDefault();
    if (!roomId || !playerName) {
      setError('Please enter a Room PIN and your name.');
      return;
    }
    
    setLoading(true);
    setError(null);
    socket.emit('joinRoom', { roomId: roomId.toUpperCase(), playerName });
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

        <button type="submit" disabled={loading} style={{ width: '100%' }}>
          {loading ? 'Joining...' : 'Enter Game'}
        </button>
      </form>
    </div>
  );
}
