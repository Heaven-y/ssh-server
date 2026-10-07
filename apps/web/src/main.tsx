import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { LocalSessionGate } from './app/LocalSessionGate';
import { startChatConnection } from './features/chat/chat-store';
import { queryClient } from './lib/query-client';
import './styles.css';

const mountApp = () => (
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>
);
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LocalSessionGate start={startChatConnection} mountApp={mountApp} />
  </StrictMode>,
);
