import { createRoot } from 'react-dom/client'
import { App } from './ui/App'
import './index.css'

// No StrictMode: the map/deck overlay owns imperative GL resources whose
// double-mount teardown in dev StrictMode is more trouble than it's worth here.
const root = document.getElementById('root')
if (!root) throw new Error('missing #root')
createRoot(root).render(<App />)
