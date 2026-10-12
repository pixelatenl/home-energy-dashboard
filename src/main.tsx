import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Legacy hash links from the pre-router app redirect to their path
// equivalents before the router mounts, so old kiosk bookmarks
// (#usage, #debug, #architecture) keep working.
const LEGACY_HASH_PATHS: Record<string, string> = {
  "#usage": "/usage",
  "#debug": "/debug",
  "#architecture": "/architecture",
}

const legacyPath = LEGACY_HASH_PATHS[window.location.hash]
if (legacyPath !== undefined) {
  window.history.replaceState(null, "", legacyPath)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
