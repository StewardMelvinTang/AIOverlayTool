import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import RendererErrorBoundary from './components/RendererErrorBoundary';
import './styles.css';

window.addEventListener('error', (event) => {
  window.floatAI.reportRendererError({
    kind: 'window-error',
    message: event.message || 'Unknown renderer error',
    stack: event.error instanceof Error ? event.error.stack : undefined
  });
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  window.floatAI.reportRendererError({
    kind: 'unhandled-rejection',
    message: reason instanceof Error ? reason.message : String(reason ?? 'Unknown rejected promise'),
    stack: reason instanceof Error ? reason.stack : undefined
  });
});

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <RendererErrorBoundary>
      <App />
    </RendererErrorBoundary>
  </React.StrictMode>
);
