import React, { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';

const SocketContext = createContext();
const ConnectionContext = createContext();

export const useSocket = () => useContext(SocketContext);
export const useConnection = () => useContext(ConnectionContext);

export const SocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    const defaultBackendUrl = `http://${window.location.hostname}:3001`;
    const backendUrl = import.meta.env.VITE_BACKEND_URL || defaultBackendUrl;

    const newSocket = io(backendUrl, {
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });

    newSocket.on('connect', () => {
      setConnected(true);
      setReconnecting(false);

      // 🔑 FIX PRINCIPAL: Al reconectar, re-emitir joinRoom automáticamente
      // si el jugador tenía una sesión activa guardada en localStorage
      const savedRoomId = localStorage.getItem('bingo_roomId');
      const savedPlayerId = localStorage.getItem('bingo_playerId');
      const savedPlayerName = localStorage.getItem('bingo_playerName');

      if (savedRoomId && savedPlayerId && savedPlayerName) {
        // Pequeño delay para asegurar que el socket está listo en el servidor
        setTimeout(() => {
          newSocket.emit('joinRoom', {
            roomId: savedRoomId.toUpperCase(),
            playerName: savedPlayerName,
            playerId: savedPlayerId,
          });
        }, 300);
      }
    });

    newSocket.on('disconnect', () => {
      setConnected(false);
    });

    newSocket.on('reconnecting', () => {
      setReconnecting(true);
    });

    newSocket.on('reconnect', () => {
      setConnected(true);
      setReconnecting(false);
    });

    setSocket(newSocket);
    return () => newSocket.close();
  }, []);

  return (
    <SocketContext.Provider value={socket}>
      <ConnectionContext.Provider value={{ connected, reconnecting }}>
        {reconnecting && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, zIndex: 99999,
            background: 'linear-gradient(90deg, #b45309, #d97706)',
            color: 'white', textAlign: 'center', padding: '10px',
            fontWeight: '700', fontSize: '0.95rem', letterSpacing: '0.5px',
            animation: 'fadeInUp 0.3s ease',
          }}>
            ⚠️ Reconectando con el servidor... No te muevas de la página.
          </div>
        )}
        {!connected && !reconnecting && socket && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, zIndex: 99999,
            background: 'linear-gradient(90deg, #991b1b, #dc2626)',
            color: 'white', textAlign: 'center', padding: '10px',
            fontWeight: '700', fontSize: '0.95rem',
          }}>
            ❌ Sin conexión con el servidor. Reintentando...
          </div>
        )}
        {children}
      </ConnectionContext.Provider>
    </SocketContext.Provider>
  );
};
