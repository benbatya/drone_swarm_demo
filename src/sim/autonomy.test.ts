import { describe, expect, it } from 'vitest'
import { makeConfig } from './config'
import { cellIdOf } from './geo'
import { makeRng } from './rng'
import { createWorld, tickWorld, type GroundTruth } from './world'
import { homeSectorRect } from './drones/drone'
import { enqueue } from './directives/queue'

const rng = () => makeRng(1)
const world = (): GroundTruth => createWorld(makeConfig({ ignitionLambdaPerMin: 0 }))

describe('autonomous idle behavior', () => {
  it('self-engages a known in-range fire, then returns to patrol once out', () => {
    const w = world()
    const r = rng()
    const d = w.drones[0]
    const id = cellIdOf({ x: d.homePos.x + 5000, y: d.homePos.y })
    w.fires.set(id, { cellId: id, ignitedAt: 1 })
    d.knownFires.add(id)

    tickWorld(w, r)
    expect(d.autoExec?.kind).toBe('extinguish')

    for (let i = 0; i < 8 && w.fires.has(id); i++) tickWorld(w, r)
    expect(w.fires.has(id)).toBe(false)

    tickWorld(w, r)
    expect(d.autoExec).toBe(null) // back to autoPatrol
  })

  it('drops a self-engage target that a peer douses', () => {
    const w = world()
    const r = rng()
    const d = w.drones[0]
    const id = cellIdOf({ x: d.homePos.x + 80_000, y: d.homePos.y }) // 80km, in range
    w.fires.set(id, { cellId: id, ignitedAt: 1 })
    d.knownFires.add(id)

    tickWorld(w, r)
    expect(d.autoExec?.kind).toBe('extinguish')

    w.fires.delete(id) // a peer put it out
    tickWorld(w, r)
    expect(d.autoExec).toBe(null)
  })

  it('does not self-engage a fire beyond autoEngageRangeKm', () => {
    const w = world()
    const r = rng()
    const d = w.drones[0]
    const far = { x: d.homePos.x + 200_000, y: d.homePos.y } // 200km > 168km
    const id = cellIdOf(far)
    w.fires.set(id, { cellId: id, ignitedAt: 1 })
    d.knownFires.add(id)

    tickWorld(w, r)
    expect(d.autoExec).toBe(null) // out of range -> patrol
  })

  it('lets an operator directive preempt autonomy', () => {
    const w = world()
    const r = rng()
    const d = w.drones[0]
    const id = cellIdOf({ x: d.homePos.x + 5000, y: d.homePos.y })
    w.fires.set(id, { cellId: id, ignitedAt: 1 })
    d.knownFires.add(id)

    tickWorld(w, r)
    expect(d.autoExec?.kind).toBe('extinguish')

    enqueue(d, {
      kind: 'scan',
      id: 'op1',
      importance: 5,
      issuedAt: 100,
      rect: homeSectorRect(d.homePos, 100),
      durationMin: 100,
    })
    tickWorld(w, r)
    expect(d.queue.length).toBeGreaterThan(0)
    expect(d.exec?.kind).toBe('scan')
  })
})
