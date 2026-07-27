import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/globals.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import '@watergis/maplibre-gl-terradraw/dist/maplibre-gl-terradraw.css';
import { ensurePmtilesProtocol } from './lib/pmtilesLocal';

// Register once for preview / style studio (pmtiles://…).
ensurePmtilesProtocol();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
