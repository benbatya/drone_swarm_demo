import { createRoot } from 'react-dom/client'
import { makeConfig } from './sim/config'
import { SimRunner } from './sim/simRunner'
import { App } from './ui/App'
import { RunnerProvider } from './ui/RunnerContext'
import './index.css'

// Construct the SimRunner OUTSIDE React and start it immediately, so the sim
// loop and window.__SIM__ hook are live regardless of React's lifecycle.
// No StrictMode: the map/deck overlay owns imperative GL resources.
const runner = new SimRunner(makeConfig())
runner.start()

const root = document.getElementById('root')
if (!root) throw new Error('missing #root')
createRoot(root).render(
  <RunnerProvider runner={runner}>
    <App />
  </RunnerProvider>,
)
