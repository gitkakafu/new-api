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
/** Idle drift speeds (px/frame @ ~60fps) — slow, independent per reel */
const IDLE_SPEEDS = [0.1, 0.15, 0.12]
/** Draw free-spin speeds — only slightly faster than idle */
const SPIN_SPEEDS = [0.35, 0.48, 0.4]
/** Strip repeats — must cover free-spin wrap + settle min-travel */
const STRIP_COPIES = 10
/** Minimum full prize-cycles the settle animation always travels (every spin) */
const SETTLE_MIN_SPINS = 3

function loopHeight(): number {
  return PRIZE_ORDER.length * CELL
}

/**
 * Keep free-spin offsets in a mid-band of the long strip so we never
 * paint empty cells, and still have room to settle further downward.
 */
function wrapY(v: number): number {
  const loop = loopHeight()
  // Keep in (-4*loop, -loop] roughly so settle can still travel 3+ loops
  while (v <= -4 * loop) v += loop
  while (v > -loop) v -= loop
  return v
}

/**
 * Land offset for `targetIndex` that is always at least `minSpins` full
 * cycles *below* the current Y. Prevents 2nd+ draws from barely moving
 * (or scrolling the wrong way) when already near a congruent land.
 */
function landOffset(
  currentY: number,
  targetIndex: number,
  reel: number,
  minSpins = SETTLE_MIN_SPINS
): number {
  const loop = loopHeight()
  const targetInCycle = -targetIndex * CELL
  // land = targetInCycle - k*loop  (k >= 0), with land <= currentY - minSpins*loop - stagger
  const stagger = reel * 6
  const floor = currentY - minSpins * loop - stagger
  // k such that targetInCycle - k*loop <= floor  →  k >= (targetInCycle - floor) / loop
  let k = Math.ceil((targetInCycle - floor) / loop)
  if (k < minSpins) k = minSpins
  return targetInCycle - k * loop
}

/**
 * CSS 3-reel slot machine. All reels land on the same prize tier for clarity.
 * Idle (!spinning): three reels drift slowly and independently.
 * Free-spin (spinning, no target): slightly faster independent roll.
 * Settle (spinning + target): always ease downward several cycles to the result.
 */
export function SlotMachine({
  targetIndex,
  spinning,
  durationMs = 2400,
  className,
  onSpinEnd,
  highlight,
}: SlotMachineProps) {
  const strip = useMemo(() => {
    const one = [...PRIZE_ORDER]
    const out: number[] = []
    for (let c = 0; c < STRIP_COPIES; c++) out.push(...one)
    return out
  }, [])

  // Staggered starts so idle never shows three identical faces
  const [offsets, setOffsets] = useState(() => [
    -loopHeight(),
    -loopHeight() * 2 - 18,
    -loopHeight() * 3 - 10,
  ])
  const [settling, setSettling] = useState(false)
  const onEndRef = useRef(onSpinEnd)
  onEndRef.current = onSpinEnd
  const rafRef = useRef(0)
  const yRef = useRef([-loopHeight(), -loopHeight() * 2 - 18, -loopHeight() * 3 - 10])
  const settleTimerRef = useRef(0)

  // Continuous reel motion owner (idle + free-spin). Settle uses CSS transition.
  useEffect(() => {
    // Settling to target — pause RAF; settle effect drives offsets
    if (spinning && targetIndex != null) {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
      }
      return
    }

    // Leaving settle / entering idle or free-spin: drop CSS transition
    setSettling(false)

    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    // Idle + reduced motion: staggered static faces
    if (!spinning && reduced) {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
      }
      const staticY = [
        -loopHeight(),
        -loopHeight() * 2 - 18,
        -loopHeight() * 3 - 10,
      ]
      yRef.current = staticY
      setOffsets(staticY)
      return
    }

    const speeds = spinning ? SPIN_SPEEDS : IDLE_SPEEDS
    const tick = () => {
      yRef.current = yRef.current.map((v, i) => wrapY(v - speeds[i]))
      setOffsets([...yRef.current])
      rafRef.current = requestAnimationFrame(tick)
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
      }
    }
  }, [spinning, targetIndex])

  // Settle when target arrives during a spin
  useEffect(() => {
    if (!spinning || targetIndex == null) return
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
    if (settleTimerRef.current) {
      window.clearTimeout(settleTimerRef.current)
      settleTimerRef.current = 0
    }

    // 1) Freeze at current Y with NO transition (restart CSS transition cleanly)
    setSettling(false)
    const current = [...yRef.current]
    setOffsets(current)

    // 2) Next frames: enable easing and jump to a land far enough below current
    let cancelled = false
    const raf1 = requestAnimationFrame(() => {
      if (cancelled) return
      const lands = current.map((cur, i) =>
        landOffset(cur, targetIndex, i, SETTLE_MIN_SPINS)
      )
      yRef.current = lands
      requestAnimationFrame(() => {
        if (cancelled) return
        setSettling(true)
        setOffsets(lands)
      })
    })

    settleTimerRef.current = window.setTimeout(() => {
      onEndRef.current?.()
    }, durationMs + 120)

    return () => {
      cancelled = true
      cancelAnimationFrame(raf1)
      if (settleTimerRef.current) {
        window.clearTimeout(settleTimerRef.current)
        settleTimerRef.current = 0
      }
    }
  }, [spinning, targetIndex, durationMs])

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
                  : 'none',
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
