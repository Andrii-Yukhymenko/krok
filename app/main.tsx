import { createRoot } from 'react-dom/client';
import Home from './page';
import './globals.css';
import 'leaflet/dist/leaflet.css';
import './journey.css';

createRoot(document.getElementById('root')!).render(<Home />);
