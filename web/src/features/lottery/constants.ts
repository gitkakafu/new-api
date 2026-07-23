/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/

/** Matches backend PrizeOrder / docs §2.2.1 */
export const PRIZE_ORDER = [0.5, 1, 1.5, 2, 3, 5, 8, 10] as const

export type PrizeAmount = (typeof PRIZE_ORDER)[number]

export const PRIZE_CHARS: Record<
  number,
  { name: string; file: string; label: string }
> = {
  0.5: {
    name: '懒羊羊',
    file: 'prize-0.5-lazy-sheep.png',
    label: '0.5',
  },
  1: { name: '慢羊羊', file: 'prize-1-slow-sheep.png', label: '1' },
  1.5: { name: '暖羊羊', file: 'prize-1.5-warm-sheep.png', label: '1.5' },
  2: { name: '沸羊羊', file: 'prize-2-boil-sheep.png', label: '2' },
  3: { name: '美羊羊', file: 'prize-3-pretty-sheep.png', label: '3' },
  5: { name: '喜羊羊', file: 'prize-5-happy-sheep.png', label: '5' },
  8: { name: '红太狼', file: 'prize-8-red-wolf.png', label: '8' },
  10: { name: '灰太狼', file: 'prize-10-grey-wolf.png', label: '10' },
}

export function prizeIconUrl(amount: number): string {
  // NOTE: must NOT use `/lottery/*` — that path collides with the SPA route
  // and the embedded static directory causes /lottery ↔ /lottery/ redirect loops.
  const meta = PRIZE_CHARS[amount]
  if (!meta) return '/assets/lottery/prize-0.5-lazy-sheep.png'
  return `/assets/lottery/${meta.file}`
}

export function prizeIndex(amount: number): number {
  const i = PRIZE_ORDER.findIndex((a) => Math.abs(a - amount) < 1e-9)
  return i >= 0 ? i : 0
}
