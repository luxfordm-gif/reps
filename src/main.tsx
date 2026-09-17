import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { registerServiceWorker } from './lib/registerServiceWorker'
import { startOutboxSync } from './lib/offline/outbox'

// iOS Safari won't apply :active to anything unless the page listens for
// touch, so without this the press feedback simply never happens on an iPhone.
// Passive and empty: it exists to be registered, not to run.
document.addEventListener('touchstart', () => {}, { passive: true })

registerServiceWorker()
// Start draining anything logged offline as soon as the app is up — a workout
// saved on the gym floor lands the moment the phone finds signal again.
startOutboxSync()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
