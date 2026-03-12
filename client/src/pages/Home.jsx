import React from 'react';
import { useNavigate } from 'react-router-dom';

export default function Home() {
  const navigate = useNavigate();

  return (
    <div className="glass-panel" style={{ maxWidth: '800px', margin: '15vh auto', textAlign: 'center', padding: '4rem 2rem' }}>
      <h1 className="text-gradient" style={{ fontSize: '4.5rem', marginBottom: '15px', letterSpacing: '2px' }}>🎵 Musical Bingo</h1>
      <p style={{ marginBottom: '3.5rem', color: 'var(--text-muted)', fontSize: '1.4rem' }}>
        El juego definitivo para tus fiestas. ¿Quién eres hoy?
      </p>
      
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', padding: '0 20px' }}>
        <div 
          onClick={() => navigate('/presenter/login')}
          style={{ 
            background: 'var(--glass-bg)', 
            padding: '3rem 2rem', 
            borderRadius: '20px', 
            cursor: 'pointer',
            border: '1px solid var(--glass-border)',
            transition: 'transform 0.3s ease, box-shadow 0.3s ease'
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-10px)'; e.currentTarget.style.boxShadow = '0 15px 30px rgba(0,0,0,0.3)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}
        >
          <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>🎤</div>
          <h2 style={{ marginBottom: '10px' }}>Soy Presentador</h2>
          <p style={{ color: 'var(--text-muted)' }}>Crea la sala, elige la playlist de Spotify y controla el juego.</p>
        </div>

        <div 
          onClick={() => navigate('/join')}
          style={{ 
            background: 'var(--primary-color)', 
            padding: '3rem 2rem', 
            borderRadius: '20px', 
            cursor: 'pointer',
            transition: 'transform 0.3s ease, box-shadow 0.3s ease',
            color: 'white'
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-10px)'; e.currentTarget.style.boxShadow = '0 15px 30px rgba(var(--primary-color-rgb), 0.4)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}
        >
          <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>📱</div>
          <h2 style={{ marginBottom: '10px', color: 'white' }}>Soy Jugador</h2>
          <p style={{ opacity: 0.9 }}>Únete a una sala con el PIN y consigue tu cartón para jugar.</p>
        </div>
      </div>
    </div>
  );
}
