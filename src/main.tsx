import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { registerServiceWorker } from './lib/registerServiceWorker'
import { startOutboxSync } from './lib/offline/outbox'

registerServiceWorker()
// Start draining anything logged offline as soon as the app is up — a workout
// saved on the gym floor lands the moment the phone finds signal again.
startOutboxSync()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
