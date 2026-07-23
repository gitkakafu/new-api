/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

import type { PublicWinItem } from '../types'
import { prizeIconUrl } from '../constants'

interface PublicWinsTickerProps {
  items: PublicWinItem[]
  className?: string
}

function prizeTone(prize: number): string {
  if (prize >= 5) return 'text-amber-400'
  if (prize >= 2) return 'text-sky-400'
  return 'text-muted-foreground'
}

export function PublicWinsTicker({ items, className }: PublicWinsTickerProps) {
  const { t } = useTranslation()
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [paused, setPaused] = useState(false)

  const list = useMemo(() => {
    if (items.length === 0) return []
    // duplicate for seamless loop when enough rows
    if (items.length >= 8) return [...items, ...items]
    return items
  }, [items])

  useEffect(() => {
    const el = scrollerRef.current
    if (!el || items.length === 0) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let raf = 0
    let last = performance.now()
    const speed = 28 // px/s

    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      if (!paused) {
        el.scrollTop += speed * dt
        const half = el.scrollHeight / 2
        if (items.length >= 8 && half > 0 && el.scrollTop >= half) {
          el.scrollTop -= half
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [items, paused])

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
            ref={scrollerRef}
            className='h-[min(420px,50vh)] overflow-hidden'
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
          >
            <ul className='space-y-2 pr-1'>
              {list.map((row, i) => (
                <li
                  key={`${row.date}-${row.username}-${row.prize}-${i}`}
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
                  <div className={cn('font-semibold tabular-nums', prizeTone(row.prize))}>
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
