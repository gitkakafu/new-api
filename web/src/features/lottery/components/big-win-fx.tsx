/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import confetti from 'canvas-confetti'
import { useEffect } from 'react'

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

export function BigWinBanner({ amount, visible, onDone }: BigWinBannerProps) {
  useEffect(() => {
    if (!visible || amount == null) return
    const t = window.setTimeout(() => onDone?.(), 2800)
    return () => window.clearTimeout(t)
  }, [visible, amount, onDone])

  if (!visible || amount == null) return null

  return (
    <div
      className='pointer-events-none fixed inset-0 z-50 flex items-center justify-center'
      aria-live='polite'
    >
      <div className='animate-in zoom-in-95 fade-in duration-300 rounded-2xl border border-amber-400/60 bg-gradient-to-br from-amber-500/90 via-orange-500/90 to-purple-600/90 px-10 py-6 text-center shadow-2xl shadow-amber-500/40'>
        <div className='text-sm font-medium tracking-widest text-amber-100 uppercase'>
          BIG WIN
        </div>
        <div className='mt-1 text-4xl font-black text-white drop-shadow'>
          {amount}
        </div>
      </div>
    </div>
  )
}
