import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/index.css';
import './lib/theme';
import './lib/pwa';
import { installTooltips } from './lib/tooltips';

installTooltips();

// development only: the Agentation toolbar sends notes on the page to a coding agent (left out of the build)
const Agentation = import.meta.env.DEV ? lazy(() => import('agentation').then((m) => ({ default: m.Agentation }))) : null;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    {Agentation && <Suspense fallback={null}><Agentation endpoint="http://localhost:4747" /></Suspense>}
  </StrictMode>,
);
