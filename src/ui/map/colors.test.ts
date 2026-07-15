import { describe, expect, it } from 'vitest'
import { hsvToRgb, staleValue } from './colors'

describe('hsvToRgb', () => {
  it('maps primary hues at full saturation/value', () => {
    expect(hsvToRgb(0, 1, 1)).toEqual([255, 0, 0]) // red
    expect(hsvToRgb(120, 1, 1)).toEqual([0, 255, 0]) // green
    expect(hsvToRgb(240, 1, 1)).toEqual([0, 0, 255]) // blue
  })

  it('scales brightness with value', () => {
    expect(hsvToRgb(0, 1, 0.5)).toEqual([128, 0, 0])
    expect(hsvToRgb(0, 1, 0)).toEqual([0, 0, 0]) // value 0 → black
  })

  it('wraps hue past 360', () => {
    expect(hsvToRgb(360, 1, 1)).toEqual(hsvToRgb(0, 1, 1))
  })
})

describe('staleValue', () => {
  it('is the inverse of the staleness fraction', () => {
    expect(staleValue(0)).toBe(1) // fresh (just synced)
    expect(staleValue(0.4)).toBeCloseTo(0.6) // 40% toward MISSING
    expect(staleValue(1)).toBe(0) // MISSING → black
  })

  it('clamps out-of-range fractions', () => {
    expect(staleValue(1.5)).toBe(0) // never-contacted / past MISSING → black
    expect(staleValue(-0.2)).toBe(1) // clamped to full brightness
  })
})
