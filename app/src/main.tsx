import { createRoot } from 'react-dom/client'
import { BrowserRouter } from "react-router";
import { AppProvider } from './context/AppContext'
import './i18n'
import './theme/theme.css'
import './theme'
import './mascot'
import './index.css'
import App from './app.tsx'
import { ErrorBoundary } from './components/ErrorBoundary'
import { BASE_PATH } from './http.ts';

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <BrowserRouter basename={BASE_PATH}>
      <AppProvider>
        <App />
      </AppProvider>
    </BrowserRouter>
  </ErrorBoundary>,
)
