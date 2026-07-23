/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { useEffect, useMemo, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

import { PRIZE_CHARS, PRIZE_ORDER, prizeIconUrl } from '../constants'

interface SlotMachineProps {
  /** Final prize index in PRIZE_ORDER after server returns */
  targetIndex: number | null
  spinning: boolean
  durationMs?: number
  className?: string
  onSpinEnd?: () => void
  highlight?: boolean
}

const CELL = 88

/**
 * CSS 3-reel slot machine. All reels land on the same prize tier for clarity.
 * Free-spins until `targetIndex` is set, then eases to the result.
 */
export function SlotMachine({
  targetIndex,
  spinning,
  durationMs = 2400,
  className,
  onSpinEnd,
  highlight,
}: SlotMachineProps) {
  const strip = useMemo(
    () => [...PRIZE_ORDER, ...PRIZE_ORDER, ...PRIZE_ORDER, ...PRIZE_ORDER],
    []
  )
  const [offsets, setOffsets] = useState([0, 0, 0])
  const [settling, setSettling] = useState(false)
  const onEndRef = useRef(onSpinEnd)
  onEndRef.current = onSpinEnd
  const rafRef = useRef(0)
  const yRef = useRef([0, -12, -24])

  // Free spin while waiting for server
  useEffect(() => {
    if (!spinning || targetIndex != null) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      return
    }
    setSettling(false)
    const tick = () => {
      yRef.current = yRef.current.map((v, i) => v - (16 + i * 3))
      // keep offsets in a reasonable range
      yRef.current = yRef.current.map((v) => {
        const loop = PRIZE_ORDER.length * CELL
        if (v < -loop * 3) return v + loop
        return v
      })
      setOffsets([...yRef.current])
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [spinning, targetIndex])

  // Settle when target arrives
  useEffect(() => {
    if (!spinning || targetIndex == null) return
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    setSettling(true)
    const landBase = -(PRIZE_ORDER.length * 2 + targetIndex) * CELL
    const lands = [landBase, landBase - 4, landBase + 4]
    yRef.current = lands
    // force reflow-friendly update next frame
    requestAnimationFrame(() => setOffsets(lands))
    const t = window.setTimeout(() => {
      onEndRef.current?.()
    }, durationMs + 120)
    return () => window.clearTimeout(t)
  }, [spinning, targetIndex, durationMs])

  // idle face: show first prize row
  useEffect(() => {
    if (spinning) return
    if (targetIndex == null) {
      setSettling(false)
      setOffsets([0, 0, 0])
      yRef.current = [0, 0, 0]
    }
  }, [spinning, targetIndex])

  return (
    <div
      className={cn(
        'relative mx-auto w-full max-w-md rounded-2xl border border-purple-500/30 bg-gradient-to-b from-slate-900 via-slate-950 to-black p-4 shadow-xl shadow-purple-900/30',
        highlight && 'ring-2 ring-amber-400 shadow-amber-500/40',
        className
      )}
    >
      <div className='mb-2 text-center text-xs tracking-[0.3em] text-amber-300/80 uppercase'>
        LUCKY DRAW
      </div>
      <div className='grid grid-cols-3 gap-2'>
        {[0, 1, 2].map((r) => (
          <div
            key={r}
            className='relative h-[88px] overflow-hidden rounded-xl border border-white/10 bg-black/60'
          >
            <div
              style={{
                transform: `translateY(${offsets[r]}px)`,
                transition: settling
                  ? `transform ${durationMs - r * 180}ms cubic-bezier(0.12, 0.9, 0.2, 1)`
                  : undefined,
              }}
            >
              {strip.map((amt, i) => {
                const meta = PRIZE_CHARS[amt]
                return (
                  <div
                    key={`${r}-${i}`}
                    className='flex h-[88px] flex-col items-center justify-center gap-0.5 px-1'
                  >
                    <img
                      src={prizeIconUrl(amt)}
                      alt={meta?.name ?? String(amt)}
                      className='h-12 w-12 rounded-lg object-cover shadow'
                      draggable={false}
                    />
                    <span className='text-[10px] font-semibold text-amber-200/90'>
                      {meta?.label ?? amt}
                    </span>
                  </div>
                )
              })}
            </div>
            <div className='pointer-events-none absolute inset-x-0 top-0 h-4 bg-gradient-to-b from-black to-transparent' />
            <div className='pointer-events-none absolute inset-x-0 bottom-0 h-4 bg-gradient-to-t from-black to-transparent' />
          </div>
        ))}
      </div>
      <div className='pointer-events-none absolute inset-x-6 top-[calc(50%+6px)] h-0.5 bg-amber-400/40' />
    </div>
  )
}
