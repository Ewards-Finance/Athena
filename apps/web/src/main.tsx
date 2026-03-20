import React    from 'react';
import ReactDOM  from 'react-dom/client';
import { Toaster } from 'sonner';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App       from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime:            2 * 60 * 1000,  // cached data is fresh for 2 minutes
      gcTime:              10 * 60 * 1000,  // unused cache cleared after 10 minutes
      retry:                1,              // retry failed requests once
      refetchOnWindowFocus: false,          // don't refetch when switching tabs
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster position="top-right" richColors closeButton />
    </QueryClientProvider>
  </React.StrictMode>
);
