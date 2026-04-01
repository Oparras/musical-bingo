import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';

const SocketContext = createContext();
const ConnectionContext = createContext();

const HEALTH_STATES = {
  unknown: 'unknown',
  waking: 'waking',
  healthy: 'healthy',
  offline: 'offline',
  network: 'network',
};

export const useSocket = () => useContext(SocketContext);
export const useConnection = () => useContext(ConnectionContext);

export const SocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [disconnectedAt, setDisconnectedAt] = useState(Date.now());
  const [healthState, setHealthState] = useState(HEALTH_STATES.unknown);

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
      setHealthState(HEALTH_STATES.healthy);

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
      setHealthState(HEALTH_STATES.unknown);
    });

    newSocket.on('reconnecting', () => {
      setReconnecting(true);
      setDisconnectedAt((prev) => prev || Date.now());
      setHealthState(HEALTH_STATES.unknown);
    });

    newSocket.on('reconnect', () => {
      setConnected(true);
      setReconnecting(false);
      setHealthState(HEALTH_STATES.healthy);
    });

    setSocket(newSocket);
    return () => newSocket.close();
  }, []);

  useEffect(() => {
    if (connected) return undefined;

    const defaultBackendUrl = `http://${window.location.hostname}:3001`;
    const backendUrl = import.meta.env.VITE_BACKEND_URL || defaultBackendUrl;
    let cancelled = false;

    const checkHealth = async () => {
      if (!navigator.onLine) {
        if (!cancelled) setHealthState(HEALTH_STATES.network);
        return;
      }

      try {
        const response = await fetch(`${backendUrl}/health`, {
          method: 'GET',
          cache: 'no-store',
        });

        if (cancelled) return;

        if (response.ok) {
          setHealthState(HEALTH_STATES.healthy);
        } else {
          setHealthState(HEALTH_STATES.offline);
        }
      } catch (error) {
        if (cancelled) return;
        const disconnectedForMs = Date.now() - disconnectedAt;
        setHealthState(disconnectedForMs > 5000 ? HEALTH_STATES.waking : HEALTH_STATES.unknown);
      }
    };

    checkHealth();
    const interval = window.setInterval(checkHealth, 6000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [connected, disconnectedAt]);

  const disconnectedSeconds = useMemo(
    () => Math.max(0, Math.round((Date.now() - disconnectedAt) / 1000)),
    [disconnectedAt]
  );

  const offlineBanner = !connected && !reconnecting && socket;

  const offlineMessage = useMemo(() => {
    if (!navigator.onLine || healthState === HEALTH_STATES.network) {
      return 'Tu conexion a internet parece caida. Revisa la red y manten la pagina abierta.';
    }

    if (healthState === HEALTH_STATES.healthy) {
      return 'El backend ya responde, pero el socket sigue reconectando. Espera un momento.';
    }

    if (healthState === HEALTH_STATES.offline) {
      return 'El backend responde con problemas. Puede estar reiniciandose en Render; seguimos reintentando.';
    }

    if (healthState === HEALTH_STATES.waking) {
      return 'El backend puede estar despertando en Render. Esto a veces tarda unos segundos; reintentamos solos.';
    }

    return `Sin conexion con el servidor. Reintentando...${disconnectedSeconds > 0 ? ` (${disconnectedSeconds}s)` : ''}`;
  }, [disconnectedSeconds, healthState]);

  const offlineBackground = useMemo(() => {
    if (!navigator.onLine || healthState === HEALTH_STATES.network) {
      return 'linear-gradient(90deg, #7f1d1d, #ef4444)';
    }

    if (healthState === HEALTH_STATES.healthy) {
      return 'linear-gradient(90deg, #1d4ed8, #2563eb)';
    }

    if (healthState === HEALTH_STATES.offline || healthState === HEALTH_STATES.waking) {
      return 'linear-gradient(90deg, #7c2d12, #ea580c)';
    }

    return 'linear-gradient(90deg, #991b1b, #dc2626)';
  }, [healthState]);

  return (
    <SocketContext.Provider value={socket}>
      <ConnectionContext.Provider value={{ connected, reconnecting, healthState }}>
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
            background: offlineBackground,
            color: 'white', textAlign: 'center', padding: '10px',
            fontWeight: '700', fontSize: '0.95rem',
          }}>
            {offlineMessage}
          </div>
        )}
        {children}
      </ConnectionContext.Provider>
    </SocketContext.Provider>
  );
};
