/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

import type { PublicWinItem } from '../types'
import { prizeIconUrl } from '../constants'

interface PublicWinsTickerProps {
  items: PublicWinItem[]
  className?: string
}

/** px/s — ~1.3–1.5 rows/s at typical row height; readable and clearly moving */
const SCROLL_SPEED = 60

function prizeTone(prize: number): string {
  if (prize >= 5) return 'text-amber-400'
  if (prize >= 2) return 'text-sky-400'
  return 'text-muted-foreground'
}

/**
 * Build a list tall enough for a seamless loop: at least 2× viewport height,
 * and always ≥2 copies of the source so we can reset offset at half height.
 */
function buildLoopList(
  items: PublicWinItem[],
  viewportH: number,
  rowH: number
): { list: PublicWinItem[]; copies: number } {
  if (items.length === 0) return { list: [], copies: 0 }
  const safeRow = Math.max(rowH, 40)
  const safeView = Math.max(viewportH, 200)
  // one copy height estimate
  const oneH = items.length * safeRow
  // need content ≥ 2× viewport so half-reset never leaves empty frame
  let copies = 2
  while (oneH * copies < safeView * 2 && copies < 12) {
    copies += 1
  }
  // few rows: still force enough copies for a continuous marquee
  if (items.length < 6) {
    copies = Math.max(copies, Math.ceil((safeView * 2) / oneH))
    copies = Math.min(Math.max(copies, 4), 16)
  }
  const list: PublicWinItem[] = []
  for (let c = 0; c < copies; c++) {
    list.push(...items)
  }
  return { list, copies }
}

export function PublicWinsTicker({ items, className }: PublicWinsTickerProps) {
  const { t } = useTranslation()
  const viewportRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLUListElement>(null)
  const pausedRef = useRef(false)
  const offsetRef = useRef(0)
  const [paused, setPaused] = useState(false)
  const [viewportH, setViewportH] = useState(320)
  const [rowH, setRowH] = useState(44)

  pausedRef.current = paused

  useLayoutEffect(() => {
    const vp = viewportRef.current
    if (!vp) return
    const measure = () => {
      setViewportH(vp.clientHeight || 320)
      const first = vp.querySelector<HTMLElement>('[data-win-row]')
      if (first) {
        // include space-y-2 gap (~8px) via getBoundingClientRect of consecutive rows if possible
        const second = first.nextElementSibling as HTMLElement | null
        if (second) {
          const a = first.getBoundingClientRect()
          const b = second.getBoundingClientRect()
          setRowH(Math.max(32, b.top - a.top))
        } else {
          setRowH(Math.max(32, first.getBoundingClientRect().height + 8))
        }
      }
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(vp)
    return () => ro.disconnect()
  }, [items])

  const { list, copies } = useMemo(
    () => buildLoopList(items, viewportH, rowH),
    [items, viewportH, rowH]
  )

  // reset offset when source list changes
  useEffect(() => {
    offsetRef.current = 0
    if (trackRef.current) {
      trackRef.current.style.transform = 'translate3d(0,0,0)'
    }
  }, [items])

  useEffect(() => {
    if (items.length === 0 || copies < 2) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let raf = 0
    let last = performance.now()

    const tick = (now: number) => {
      const dt = Math.min(0.064, (now - last) / 1000)
      last = now
      const track = trackRef.current
      if (track && !pausedRef.current) {
        // half of track = one seamless cycle when list is N equal copies
        const half = track.scrollHeight / copies
        if (half > 0) {
          offsetRef.current += SCROLL_SPEED * dt
          // keep offset in [0, half)
          if (offsetRef.current >= half) {
            offsetRef.current = offsetRef.current % half
          }
          track.style.transform = `translate3d(0, ${-offsetRef.current}px, 0)`
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [items, copies])

  return (
    <Card className={cn('flex h-full min-h-[280px] flex-col', className)}>
      <CardHeader className='pb-2'>
        <CardTitle className='text-base'>{t('高光时刻')}</CardTitle>
        <p className='text-muted-foreground text-xs'>
          {t('最近 ≥2 的中奖播报（脱敏）')}
        </p>
      </CardHeader>
      <CardContent className='min-h-0 flex-1'>
        {items.length === 0 ? (
          <div className='text-muted-foreground flex h-40 items-center justify-center text-sm'>
            {t('暂无 ≥2 的中奖，来当第一条？')}
          </div>
        ) : (
          <div
            ref={viewportRef}
            className='relative h-[min(420px,50vh)] overflow-hidden'
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onFocus={() => setPaused(true)}
            onBlur={() => setPaused(false)}
          >
            <ul
              ref={trackRef}
              className='space-y-2 pr-1 will-change-transform'
              style={{ transform: 'translate3d(0,0,0)' }}
            >
              {list.map((row, i) => (
                <li
                  key={`${row.date}-${row.username}-${row.prize}-${i}`}
                  data-win-row
                  className='bg-muted/40 flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm'
                >
                  <img
                    src={prizeIconUrl(row.prize)}
                    alt=''
                    className='h-8 w-8 shrink-0 rounded-md object-cover'
                  />
                  <div className='min-w-0 flex-1'>
                    <div className='text-muted-foreground truncate text-xs'>
                      {row.date} · {row.username}
                    </div>
                  </div>
                  <div
                    className={cn(
                      'font-semibold tabular-nums',
                      prizeTone(row.prize)
                    )}
                  >
                    {row.prize}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
