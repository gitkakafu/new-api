/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import confetti from 'canvas-confetti'
import { useEffect, useMemo } from 'react'

import { cn } from '@/lib/utils'

/** Local static frames from cxk-ball (community meme assets; entertainment only). */
const CXK_FRAME_A = '/assets/lottery/cxk-paddle-1.png'
const CXK_FRAME_B = '/assets/lottery/cxk-paddle-2.png'

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function fireBigWinConfetti(strength: 'normal' | 'strong' = 'normal') {
  if (prefersReducedMotion()) return
  const particleCount = strength === 'strong' ? 160 : 90
  const spread = strength === 'strong' ? 90 : 70
  confetti({
    particleCount,
    spread,
    origin: { y: 0.65 },
    colors: ['#fbbf24', '#f59e0b', '#fcd34d', '#a855f7', '#ec4899'],
  })
  if (strength === 'strong') {
    setTimeout(() => {
      confetti({
        particleCount: 60,
        angle: 60,
        spread: 55,
        origin: { x: 0, y: 0.7 },
      })
      confetti({
        particleCount: 60,
        angle: 120,
        spread: 55,
        origin: { x: 1, y: 0.7 },
      })
    }, 200)
  }
}

interface BigWinBannerProps {
  amount: number | null
  visible: boolean
  onDone?: () => void
}

/**
 * Big-win overlay: confetti is fired by the parent; this banner shows amount
 * plus a lightweight 2-frame CXK paddle loop (local assets only).
 * ≥5: normal size / ~2.8s · ≥10: larger / ~4.2s
 */
export function BigWinBanner({ amount, visible, onDone }: BigWinBannerProps) {
  const strong = amount != null && amount >= 10
  const durationMs = strong ? 4200 : 2800
  const reduced = useMemo(() => prefersReducedMotion(), [visible, amount])

  useEffect(() => {
    if (!visible || amount == null) return
    const t = window.setTimeout(() => onDone?.(), durationMs)
    return () => window.clearTimeout(t)
  }, [visible, amount, onDone, durationMs])

  if (!visible || amount == null) return null

  const imgClass = cn(
    'object-contain drop-shadow-lg select-none',
    strong ? 'h-28 w-28 sm:h-36 sm:w-36' : 'h-20 w-20 sm:h-24 sm:w-24'
  )

  return (
    <div
      className='pointer-events-none fixed inset-0 z-50 flex items-center justify-center'
      aria-live='polite'
    >
      {/* Scoped keyframes for 2-frame paddle loop (~7 fps) */}
      <style>{`
        @keyframes lottery-cxk-a {
          0%, 49.9% { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
        @keyframes lottery-cxk-b {
          0%, 49.9% { opacity: 0; }
          50%, 100% { opacity: 1; }
        }
        .lottery-cxk-frame-a {
          animation: lottery-cxk-a 0.28s steps(1, end) infinite;
        }
        .lottery-cxk-frame-b {
          animation: lottery-cxk-b 0.28s steps(1, end) infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .lottery-cxk-frame-a,
          .lottery-cxk-frame-b {
            animation: none !important;
          }
          .lottery-cxk-frame-b {
            opacity: 0 !important;
          }
        }
      `}</style>

      <div
        className={cn(
          'animate-in zoom-in-95 fade-in duration-300 flex flex-col items-center gap-3 rounded-2xl border border-amber-400/60 bg-gradient-to-br from-amber-500/90 via-orange-500/90 to-purple-600/90 text-center shadow-2xl shadow-amber-500/40',
          strong ? 'px-12 py-8' : 'px-10 py-6'
        )}
      >
        {/* CXK 2-frame basketball loop */}
        <div
          className={cn(
            'relative',
            strong ? 'h-28 w-28 sm:h-36 sm:w-36' : 'h-20 w-20 sm:h-24 sm:w-24'
          )}
          aria-hidden
        >
          <img
            src={CXK_FRAME_A}
            alt=''
            draggable={false}
            className={cn(
              imgClass,
              'absolute inset-0',
              !reduced && 'lottery-cxk-frame-a'
            )}
          />
          {!reduced && (
            <img
              src={CXK_FRAME_B}
              alt=''
              draggable={false}
              className={cn(imgClass, 'absolute inset-0 lottery-cxk-frame-b')}
            />
          )}
        </div>

        <div className='text-sm font-medium tracking-widest text-amber-100 uppercase'>
          BIG WIN
        </div>
        <div
          className={cn(
            'font-black text-white drop-shadow',
            strong ? 'text-5xl' : 'text-4xl'
          )}
        >
          {amount}
        </div>
      </div>
    </div>
  )
}
