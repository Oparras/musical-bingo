import React, { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';

const SocketContext = createContext();

export const useSocket = () => useContext(SocketContext);

export const SocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    // Use Vercel/Render env var if available, otherwise connect to the same IP for local network testing
    const defaultBackendUrl = `http://${window.location.hostname}:3001`;
    const backendUrl = import.meta.env.VITE_BACKEND_URL || defaultBackendUrl;
    
    const newSocket = io(backendUrl);
    setSocket(newSocket);

    return () => newSocket.close();
  }, []);

  return (
    <SocketContext.Provider value={socket}>
      {children}
    </SocketContext.Provider>
  );
};
