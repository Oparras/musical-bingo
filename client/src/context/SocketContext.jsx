import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';

const SocketContext = createContext();
const ConnectionContext = createContext();

export const useSocket = () => useContext(SocketContext);
export const useConnection = () => useContext(ConnectionContext);

export const SocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [disconnectedAt, setDisconnectedAt] = useState(Date.now());
  const [wakeHintVisible, setWakeHintVisible] = useState(false);

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
      setWakeHintVisible(false);

      const savedRoomId = localStorage.getItem('bingo_roomId');
      const savedPlayerId = localStorage.getItem('bingo_playerId');
      const savedPlayerName = localStorage.getItem('bingo_playerName');

      if (savedRoomId && savedPlayerId && savedPlayerName) {
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
      setDisconnectedAt(Date.now());
    });

    newSocket.on('reconnecting', () => {
      setReconnecting(true);
      setDisconnectedAt((prev) => prev || Date.now());
    });

    newSocket.on('reconnect', () => {
      setConnected(true);
      setReconnecting(false);
      setWakeHintVisible(false);
    });

    setSocket(newSocket);
    return () => newSocket.close();
  }, []);

  useEffect(() => {
    if (connected) return undefined;

    const timer = window.setTimeout(() => {
      setWakeHintVisible(true);
    }, 5000);

    return () => window.clearTimeout(timer);
  }, [connected, disconnectedAt]);

  const disconnectedSeconds = useMemo(
    () => Math.max(0, Math.round((Date.now() - disconnectedAt) / 1000)),
    [disconnectedAt]
  );

  const offlineBanner = !connected && !reconnecting && socket;

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
            Reconectando con el servidor... No cierres esta pagina.
          </div>
        )}
        {offlineBanner && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, zIndex: 99999,
            background: wakeHintVisible
              ? 'linear-gradient(90deg, #7c2d12, #ea580c)'
              : 'linear-gradient(90deg, #991b1b, #dc2626)',
            color: 'white', textAlign: 'center', padding: '10px',
            fontWeight: '700', fontSize: '0.95rem',
          }}>
            {wakeHintVisible
              ? 'Sin conexion con el servidor. El backend puede estar despertando en Render; espera unos segundos y reintentamos solos.'
              : `Sin conexion con el servidor. Reintentando...${disconnectedSeconds > 0 ? ` (${disconnectedSeconds}s)` : ''}`}
          </div>
        )}
        {children}
      </ConnectionContext.Provider>
    </SocketContext.Provider>
  );
};
