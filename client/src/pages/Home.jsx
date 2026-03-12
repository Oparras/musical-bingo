import React from 'react';
import { useNavigate } from 'react-router-dom';

export default function Home() {
  const navigate = useNavigate();

  const isMobile = window.innerWidth <= 768;

  return (
    <div className="glass-panel" style={{ 
      maxWidth: '800px', 
      margin: isMobile ? '2rem auto' : '10vh auto', 
      textAlign: 'center', 
      padding: isMobile ? '2rem 1rem' : '4rem 2rem' 
    }}>
      <h1 className="text-gradient" style={{ 
        fontSize: isMobile ? '2.5rem' : '4.5rem', 
        marginBottom: '0', 
        letterSpacing: '1px' 
      }}>🎵 Musical Bingo</h1>
      <p style={{ 
        fontSize: '0.8rem', 
        color: 'var(--text-muted)', 
        fontStyle: 'italic', 
        marginBottom: '20px',
        opacity: 0.6
      }}>by parritas </p>
      
      <p style={{ 
        marginBottom: isMobile ? '2rem' : '3.5rem', 
        color: 'var(--text-muted)', 
        fontSize: isMobile ? '1.1rem' : '1.4rem' 
      }}>
        El juego definitivo para tus fiestas. ¿Quién eres hoy?
      </p>
      
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', 
        gap: '1.5rem', 
        padding: isMobile ? '0' : '0 20px' 
      }}>
        <div 
          onClick={() => navigate('/presenter/login')}
          style={{ 
            background: 'var(--glass-bg)', 
            padding: isMobile ? '2rem' : '3rem 2rem', 
            borderRadius: '20px', 
            cursor: 'pointer',
            border: '1px solid var(--glass-border)',
            transition: 'transform 0.3s ease, box-shadow 0.3s ease'
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-10px)'; e.currentTarget.style.boxShadow = '0 15px 30px rgba(0,0,0,0.3)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}
        >
          <div style={{ fontSize: isMobile ? '3rem' : '4rem', marginBottom: '1rem' }}>🎤</div>
          <h2 style={{ marginBottom: '10px', fontSize: isMobile ? '1.5rem' : '2rem' }}>Soy Presentador</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: isMobile ? '0.9rem' : '1rem' }}>Crea la sala, elige la playlist de Spotify y controla el juego.</p>
        </div>

        <div 
          onClick={() => navigate('/join')}
          style={{ 
            background: 'var(--primary-color)', 
            padding: isMobile ? '2rem' : '3rem 2rem', 
            borderRadius: '20px', 
            cursor: 'pointer',
            transition: 'transform 0.3s ease, box-shadow 0.3s ease',
            color: 'white'
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-10px)'; e.currentTarget.style.boxShadow = '0 15px 30px rgba(106, 17, 203, 0.4)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}
        >
          <div style={{ fontSize: isMobile ? '3rem' : '4rem', marginBottom: '1rem' }}>📱</div>
          <h2 style={{ marginBottom: '10px', color: 'white', fontSize: isMobile ? '1.5rem' : '2rem' }}>Soy Jugador</h2>
          <p style={{ opacity: 0.9, fontSize: isMobile ? '0.9rem' : '1rem' }}>Únete a una sala con el PIN y consigue tu cartón para jugar.</p>
        </div>
      </div>
    </div>
  );
}
