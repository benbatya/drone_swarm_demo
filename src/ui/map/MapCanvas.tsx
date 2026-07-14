import { MapboxOverlay } from '@deck.gl/mapbox'
import { LineLayer } from '@deck.gl/layers'
import maplibregl, { type StyleSpecification } from 'maplibre-gl'
import { useEffect, useRef } from 'react'
import 'maplibre-gl/dist/maplibre-gl.css'
import { WORLD_CENTER } from '../../sim/config'
import type { TruthSnapshot } from '../../sim/snapshot'
import { useRunner } from '../RunnerContext'
import { useUIStore, type Tab } from '../store'
import { consoleLayers } from './consoleLayers'
import { buildGraticule, type GridLine } from './graticule'
import { baseLayers, droneLayers, fireLayer } from './layers'
import { basemapLayers } from './basemap'

// Flat inline style so the app boots fully offline (no tile/glyph fetches).
// Background is ocean; land + geography are deck.gl layers (see basemap.ts).
const FLAT_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#0a1a2e' } },
  ],
}

function graticuleLayer(map: maplibregl.Map): GridLine[] {
  const b = map.getBounds()
  return buildGraticule(
    { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() },
    map.getZoom(),
  )
}

export function MapCanvas({ source }: { source: Tab }) {
  const runner = useRunner()
  const containerRef = useRef<HTMLDivElement>(null)
  const snapRef = useRef<TruthSnapshot>(runner.getStoreSnapshot())
  const sourceRef = useRef<Tab>(source)
  const rebuildRef = useRef<() => void>(() => {})

  sourceRef.current = source

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const store = useUIStore.getState

    const map = new maplibregl.Map({
      container,
      style: FLAT_STYLE,
      center: [WORLD_CENTER.lng, WORLD_CENTER.lat],
      zoom: 5.4,
      attributionControl: false,
      dragRotate: false,
    })
    const overlay = new MapboxOverlay({ interleaved: true, layers: [] })
    map.addControl(overlay)

    const rebuild = () => {
      const grat = new LineLayer<GridLine>({
        id: 'graticule',
        data: graticuleLayer(map),
        getSourcePosition: (d) => d.source,
        getTargetPosition: (d) => d.target,
        getColor: (d) => (d.major ? [92, 112, 148, 170] : [58, 72, 96, 110]),
        getWidth: 1,
        widthUnits: 'pixels',
      })
      const snap = snapRef.current
      const s = store()
      const basemap = basemapLayers({ hillshade: s.showHillshade })
      if (sourceRef.current === 'truth') {
        overlay.setProps({
          layers: [
            ...basemap,
            grat,
            ...baseLayers(),
            ...fireLayer(snap.fires, s.selectFire),
            ...droneLayers(snap.drones, {
              showDetection: true,
              detectionRadiusM: runner.cfg.detectionRadiusM,
              onSelect: s.selectDrone,
            }),
          ],
        })
      } else {
        overlay.setProps({
          layers: [
            ...basemap,
            grat,
            ...baseLayers(),
            ...consoleLayers(snap.console, {
              onSelectDrone: s.selectDrone,
              onSelectFire: s.selectFire,
              draftRect: s.draftRect,
              selectedDroneId: s.selection?.kind === 'drone' ? s.selection.id : null,
            }),
          ],
        })
      }
    }
    rebuildRef.current = rebuild

    const onFrame = (snap: TruthSnapshot) => {
      snapRef.current = snap
      rebuild()
    }
    const unsub = runner.onFrame(onFrame)
    // Rebuild on UI-state changes (selection, tab, draft rect) so overlays like
    // the selected drone's scan sector update even while the sim is paused.
    const unsubStore = useUIStore.subscribe(() => rebuild())
    map.on('load', rebuild)
    map.on('move', rebuild)

    // Shift-drag to draw a scan rectangle (User Console only).
    let drawing = false
    let start: maplibregl.LngLat | null = null
    const rectFrom = (a: maplibregl.LngLat, b: maplibregl.LngLat) => ({
      west: Math.min(a.lng, b.lng),
      east: Math.max(a.lng, b.lng),
      south: Math.min(a.lat, b.lat),
      north: Math.max(a.lat, b.lat),
    })
    map.on('mousedown', (e) => {
      if (sourceRef.current !== 'console' || !e.originalEvent.shiftKey) return
      drawing = true
      start = e.lngLat
      map.dragPan.disable()
      store().setDraftRect(rectFrom(e.lngLat, e.lngLat))
      rebuild()
    })
    map.on('mousemove', (e) => {
      if (!drawing || !start) return
      store().setDraftRect(rectFrom(start, e.lngLat))
      rebuild()
    })
    const endDraw = () => {
      if (!drawing) return
      drawing = false
      start = null
      map.dragPan.enable()
    }
    map.on('mouseup', endDraw)

    return () => {
      unsub()
      unsubStore()
      map.remove()
      rebuildRef.current = () => {}
    }
  }, [runner])

  // Reflect tab switches (different data source) without rebuilding the map.
  useEffect(() => {
    rebuildRef.current()
  }, [source])

  return (
    <div ref={containerRef} className="map-canvas" data-source={source} data-testid="map-canvas" />
  )
}
