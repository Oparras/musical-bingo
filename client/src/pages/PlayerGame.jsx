import React, { useState, useEffect } from 'react';
import { useSocket } from '../context/SocketContext';
import { useParams, useNavigate } from 'react-router-dom';

export default function PlayerGame() {
  const { roomId } = useParams();
  const socket = useSocket();
  const navigate = useNavigate();

  const [gameState, setGameState] = useState('WAITING'); 
  const [card, setCard] = useState([]); 
  const [markedIndexes, setMarkedIndexes] = useState(new Set());
  const [winner, setWinner] = useState(null);
  
  useEffect(() => {
    if (!socket) return;

    socket.on('gameStarted', ({ card }) => {
      setCard(card);
      setGameState('PLAYING');
    });

    socket.on('bingoWinner', ({ player }) => {
      setWinner(player);
      setGameState('GAME_OVER');
    });
    
    socket.on('bingoFalseAlarm', () => {
      alert("Oops! Your BINGO is invalid. You missed a song! Or maybe it hasn't played yet.");
    });

    socket.on('roomDestroyed', () => {
      alert("The presenter closed the room.");
      navigate('/');
    });

    return () => {
      socket.off('gameStarted');
      socket.off('bingoWinner');
      socket.off('bingoFalseAlarm');
      socket.off('roomDestroyed');
    };
  }, [socket, navigate]);

  const toggleMark = (index) => {
    if (gameState !== 'PLAYING') return;

    const newSet = new Set(markedIndexes);
    if (newSet.has(index)) {
      newSet.delete(index);
    } else {
      newSet.add(index);
    }
    setMarkedIndexes(newSet);
  };

  const claimBingo = () => {
    if (markedIndexes.size < 4) {
      alert("You need to mark at least 4 songs to call BINGO!");
      return;
    }
    socket.emit('claimBingo', { roomId }); 
  };

  if (gameState === 'WAITING') {
    return (
      <div className="glass-panel" style={{ maxWidth: '500px', margin: '20vh auto', textAlign: 'center' }}>
        <h2>You're in! 🎉</h2>
        <p style={{ margin: '2rem 0', color: 'var(--text-muted)', fontSize: '1.2rem' }}>
          Waiting for the Host to start the game...
        </p>
        <div style={{ padding: '10px 20px', background: 'var(--glass-bg)', display: 'inline-block', borderRadius: '50px' }}>
          Room PIN: <strong style={{ letterSpacing: '2px' }}>{roomId}</strong>
        </div>
      </div>
    );
  }

  if (gameState === 'PLAYING') {
    return (
      <div style={{ maxWidth: '600px', margin: '0 auto', padding: '10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h3 style={{ color: 'var(--text-muted)', margin: 0 }}>
            Room: {roomId}
          </h3>
          <div style={{ color: 'var(--accent-color)', fontWeight: 'bold' }}>
            {markedIndexes.size} / 16 Marked
          </div>
        </div>
        
        {/* BINGO CARD GRID (4x4) */}
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(4, 1fr)', 
          gap: '8px', 
          marginBottom: '2rem' 
        }}>
          {card.map((song, i) => {
            const isMarked = markedIndexes.has(i);
            return (
              <div 
                key={i} 
                onClick={() => toggleMark(i)}
                style={{
                  aspectRatio: '1',
                  background: isMarked ? 'linear-gradient(135deg, var(--primary-color), var(--secondary-color))' : 'var(--glass-bg)',
                  border: isMarked ? 'none' : '1px solid var(--glass-border)',
                  borderRadius: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '4px',
                  cursor: 'pointer',
                  transition: 'all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                  transform: isMarked ? 'scale(0.95)' : 'scale(1)',
                  boxShadow: isMarked ? '0 5px 15px rgba(106, 17, 203, 0.4)' : 'var(--glass-shadow)',
                  textAlign: 'center',
                  overflow: 'hidden',
                  position: 'relative'
                }}
              >
                {/* Fallback to text if No Image logic */}
                {song.imageUrl && !isMarked && (
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundImage: `url(${song.imageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center', opacity: 0.15, borderRadius: '12px' }} />
                )}
                
                <div style={{ fontSize: 'min(3.5vw, 0.8rem)', fontWeight: '800', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', zIndex: 1, textShadow: isMarked ? '0 1px 2px rgba(0,0,0,0.5)' : 'none' }}>
                  {song.name}
                </div>
                <div style={{ fontSize: 'min(2.8vw, 0.65rem)', color: isMarked ? 'rgba(255,255,255,0.8)' : 'var(--text-muted)', marginTop: '4px', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden', width: '100%', zIndex: 1, fontWeight: '300' }}>
                  {song.artist}
                </div>
              </div>
            );
          })}
        </div>

        <button 
          onClick={claimBingo}
          style={{ width: '100%', padding: '20px', fontSize: '2rem', background: 'linear-gradient(90deg, #ff007f, #ff8a00)', borderRadius: '20px', boxShadow: '0 10px 30px rgba(255, 0, 127, 0.4)' }}
        >
          BINGO!
        </button>
      </div>
    );
  }

  if (gameState === 'GAME_OVER') {
    return (
      <div className="glass-panel" style={{ maxWidth: '500px', margin: '15vh auto', textAlign: 'center' }}>
        {winner?.socketId === socket.id ? (
          <>
            <h1 style={{ fontSize: '3.5rem', color: 'var(--accent-color)' }}>YOU WIN! 🎉</h1>
            <p style={{ fontSize: '1.2rem', margin: '1rem 0' }}>Your musical ear is unmatched!</p>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: '3rem' }}>GAME OVER</h1>
            <p style={{ fontSize: '1.2rem', margin: '1rem 0', color: 'var(--text-muted)' }}>
              Winner: <strong className="text-gradient">{winner?.name}</strong>
            </p>
          </>
        )}
        <button onClick={() => navigate('/')} style={{ marginTop: '2rem', width: '100%' }}>Back to Home</button>
      </div>
    );
  }

  return null;
}
