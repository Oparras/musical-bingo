import React from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import Home from './pages/Home';

import PresenterDashboard from './pages/PresenterDashboard';
import PresenterScreen from './pages/PresenterScreen';
import PlayerJoin from './pages/PlayerJoin';
import PlayerGame from './pages/PlayerGame';

// Placeholders for missing pages
const Placeholder = ({ title }) => (
  <div className="glass-panel" style={{ maxWidth: '600px', margin: '10vh auto', textAlign: 'center' }}>
    <h2>{title}</h2>
    <p>Under construction...</p>
  </div>
);

function AppRoutes() {
  const location = useLocation();
  const isPresenterScreen = location.pathname.startsWith('/presenter/screen/');

  return (
    <div className={isPresenterScreen ? 'app-container app-container--screen' : 'app-container'}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/presenter/login" element={<PresenterDashboard />} />
        <Route path="/presenter/dashboard" element={<PresenterDashboard />} />
        <Route path="/presenter/screen/:roomId" element={<PresenterScreen />} />
        <Route path="/join" element={<PlayerJoin />} />
        <Route path="/game/:roomId" element={<PlayerGame />} />
      </Routes>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

export default App;
