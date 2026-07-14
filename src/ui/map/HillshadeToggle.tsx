import { useUIStore } from '../store'

// Bottom-right map control to toggle the shaded-terrain (hillshade) basemap.
// State lives in the shared store, so the choice is common to both tabs.
export function HillshadeToggle() {
  const on = useUIStore((s) => s.showHillshade)
  const toggle = useUIStore((s) => s.toggleHillshade)
  return (
    <button
      type="button"
      className={'map-toggle' + (on ? ' active' : '')}
      onClick={toggle}
      title="Toggle shaded terrain relief"
      data-testid="hillshade-toggle"
      aria-pressed={on}
    >
      ▲ Terrain
    </button>
  )
}
