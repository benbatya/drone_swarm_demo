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
  it('is full when fresh and drops 1/min (0–100 scale) while blacked out', () => {
    expect(staleValue(0)).toBe(1) // just synced
    expect(staleValue(40)).toBeCloseTo(0.6) // 40 min dark → value 60
    expect(staleValue(100)).toBe(0) // 100 min dark → black
    expect(staleValue(250)).toBe(0) // floored
  })

  it('is 0 when never contacted', () => {
    expect(staleValue(null)).toBe(0)
  })
})
