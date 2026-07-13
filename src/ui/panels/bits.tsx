import type { ReactNode } from 'react'

export function Row({ k, v, warn }: { k: string; v: ReactNode; warn?: boolean }) {
  return (
    <div className="row">
      <span className="row-k">{k}</span>
      <span className={'row-v' + (warn ? ' warn' : '')}>{v}</span>
    </div>
  )
}

export function Bar({ frac, color }: { frac: number; color?: string }) {
  const pct = Math.max(0, Math.min(1, frac)) * 100
  return (
    <div className="bar">
      <div className="bar-fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  )
}
