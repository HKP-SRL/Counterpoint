import './styles.css';
import { LinkProvider } from '@astryxdesign/core/Link';
import { Theme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral/built';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { isFinalApiError } from './api';
import { createAppRouter, RouterLink } from './router';
import { ThemePreferenceContext, useThemePreference } from './theme';

// Data stays fresh until the live stream invalidates it: the console never polls, and a refresh
// keeps the last data on screen (TanStack Query keeps `data` while refetching).
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Number.POSITIVE_INFINITY,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: (failureCount, error) => !isFinalApiError(error) && failureCount < 2,
    },
  },
});

const router = createAppRouter(queryClient);

function App() {
  const theme = useThemePreference();
  return (
    <ThemePreferenceContext value={theme}>
      <Theme theme={neutralTheme} mode={theme.mode}>
        <LinkProvider component={RouterLink}>
          <QueryClientProvider client={queryClient}>
            <RouterProvider router={router} />
          </QueryClientProvider>
        </LinkProvider>
      </Theme>
    </ThemePreferenceContext>
  );
}

const rootElement = document.getElementById('root');
if (rootElement === null) throw new Error('The console page has no #root element.');
createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
