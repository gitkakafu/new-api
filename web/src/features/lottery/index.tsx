/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Dices, Sparkles } from 'lucide-react'

import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { cn } from '@/lib/utils'

import { drawLottery, getLotteryPublicWins, getLotteryStatus } from './api'
import { BigWinBanner, fireBigWinConfetti } from './components/big-win-fx'
import { PublicWinsTicker } from './components/public-wins-ticker'
import { SlotMachine } from './components/slot-machine'
import { PRIZE_CHARS, prizeIconUrl } from './constants'
import type { LotteryDrawResult, LotteryStatus, PublicWinItem } from './types'

export function LotteryPage() {
  const { t } = useTranslation()
  const [status, setStatus] = useState<LotteryStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [drawing, setDrawing] = useState(false)
  const [spinning, setSpinning] = useState(false)
  const [targetIndex, setTargetIndex] = useState<number | null>(null)
  const [lastResult, setLastResult] = useState<LotteryDrawResult | null>(null)
  const [publicWins, setPublicWins] = useState<PublicWinItem[]>([])
  const [highlight, setHighlight] = useState(false)
  const [bigWinAmount, setBigWinAmount] = useState<number | null>(null)
  const [bigWinVisible, setBigWinVisible] = useState(false)
  const pendingRef = useRef<LotteryDrawResult | null>(null)

  const refreshStatus = useCallback(async () => {
    try {
      const res = await getLotteryStatus()
      if (res.success && res.data) {
        setStatus(res.data)
      } else {
        toast.error(res.message || t('加载抽奖状态失败'))
      }
    } catch (e) {
      toast.error(t('加载抽奖状态失败'))
    } finally {
      setLoading(false)
    }
  }, [t])

  const refreshWins = useCallback(async () => {
    try {
      const res = await getLotteryPublicWins()
      if (res.success && res.data?.items) {
        setPublicWins(res.data.items)
      }
    } catch {
      /* silent poll */
    }
  }, [])

  useEffect(() => {
    void refreshStatus()
    void refreshWins()
    const id = window.setInterval(() => void refreshWins(), 20_000)
    return () => window.clearInterval(id)
  }, [refreshStatus, refreshWins])

  const onSpinEnd = useCallback(() => {
    setSpinning(false)
    setDrawing(false)
    const result = pendingRef.current
    if (!result) return
    setLastResult(result)
    setStatus((s) =>
      s
        ? {
            ...s,
            remaining_draws: result.remaining_draws,
            draws_used_today: s.daily_draw_limit - result.remaining_draws,
            quota: result.quota,
            can_single: result.remaining_draws >= 1,
            can_multi: false,
          }
        : s
    )

    const maxPrize = Math.max(...result.prizes, 0)
    const bigs = result.big_wins ?? []
    if (bigs.length > 0 || maxPrize >= 5) {
      setHighlight(true)
      setBigWinAmount(maxPrize)
      setBigWinVisible(true)
      fireBigWinConfetti(maxPrize >= 10 ? 'strong' : 'normal')
      window.setTimeout(() => setHighlight(false), 2000)
    }

    // optimistic public wins for ≥2
    const newWins: PublicWinItem[] = result.prizes
      .filter((p) => p >= 2)
      .map((p) => ({
        date: result.draw_date,
        username: t('我'),
        prize: p,
      }))
    if (newWins.length) {
      setPublicWins((prev) => [...newWins, ...prev].slice(0, 100))
    }
    pendingRef.current = null
    void refreshStatus()
    void refreshWins()
  }, [refreshStatus, refreshWins, t])

  const handleDraw = async (mode: 'single' | 'multi') => {
    if (drawing || spinning) return
    setDrawing(true)
    setSpinning(true)
    setTargetIndex(null)
    setLastResult(null)
    try {
      const res = await drawLottery(mode)
      if (!res.success || !res.data) {
        toast.error(res.message || t('抽奖失败'))
        setSpinning(false)
        setDrawing(false)
        return
      }
      const data = res.data
      pendingRef.current = data
      // use last prize index for multi visual focus (or first for single)
      const idx =
        data.slot_indexes?.[data.slot_indexes.length - 1] ??
        data.slot_indexes?.[0] ??
        0
      setTargetIndex(idx)

      // multi: light confetti during if any ≥5 mid-draw (strategy A lite)
      if (mode === 'multi') {
        for (const p of data.prizes) {
          if (p >= 5) {
            fireBigWinConfetti('normal')
            break
          }
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : t('抽奖失败')
      toast.error(msg)
      setSpinning(false)
      setDrawing(false)
    }
  }

  const quotaLabel = useMemo(() => {
    if (!status) return '-'
    return formatQuotaWithCurrency(status.quota)
  }, [status])

  if (loading) {
    return (
      <SectionPageLayout>
        <SectionPageLayout.Title>{t('抽奖')}</SectionPageLayout.Title>
        <SectionPageLayout.Content>
          <div className='text-muted-foreground p-8 text-center text-sm'>
            {t('加载中…')}
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>
    )
  }

  if (!status?.enabled) {
    return (
      <SectionPageLayout>
        <SectionPageLayout.Title>{t('抽奖')}</SectionPageLayout.Title>
        <SectionPageLayout.Content>
          <div className='text-muted-foreground p-8 text-center text-sm'>
            {t('抽奖功能未启用')}
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>
    )
  }

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('抽奖')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <BigWinBanner
          amount={bigWinAmount}
          visible={bigWinVisible}
          onDone={() => setBigWinVisible(false)}
        />

        <div className='grid gap-4 lg:grid-cols-[1fr_300px]'>
          <div className='space-y-4'>
            <Card>
              <CardHeader className='pb-2'>
                <div className='flex flex-wrap items-center justify-between gap-2'>
                  <div>
                    <CardTitle className='flex items-center gap-2 text-lg'>
                      <Dices className='h-5 w-5' />
                      {t('余额抽奖')}
                    </CardTitle>
                    <CardDescription>
                      {t('今日剩余')}{' '}
                      <span className='text-foreground font-semibold'>
                        {status.remaining_draws}
                      </span>{' '}
                      / {status.daily_draw_limit}
                      {' · '}
                      {t('余额')} {quotaLabel}
                    </CardDescription>
                  </div>
                  <div className='text-muted-foreground text-xs'>
                    {status.draw_date} ({status.timezone})
                  </div>
                </div>
              </CardHeader>
              <CardContent className='space-y-4'>
                <SlotMachine
                  spinning={spinning}
                  targetIndex={targetIndex}
                  onSpinEnd={onSpinEnd}
                  highlight={highlight}
                />

                <div className='flex flex-wrap items-stretch justify-center gap-3'>
                  <Button
                    size='lg'
                    className='min-w-[9.5rem] flex-col gap-0.5 py-2 h-auto'
                    disabled={drawing || spinning || !status.can_single}
                    onClick={() => void handleDraw('single')}
                  >
                    <span className='inline-flex items-center'>
                      <Sparkles className='mr-1 h-4 w-4' />
                      {t('单抽')}
                    </span>
                    <span className='text-[11px] font-normal opacity-90'>
                      {t('消耗')} {status.single_cost} {t('额度')} · 1{t('抽')}
                    </span>
                  </Button>
                  <div className='relative'>
                    <Button
                      size='lg'
                      variant='secondary'
                      className='min-w-[11rem] flex-col gap-0.5 py-2 h-auto'
                      disabled={drawing || spinning || !status.can_multi}
                      onClick={() => void handleDraw('multi')}
                    >
                      <span className='font-semibold'>{t('十连')}</span>
                      <span className='text-[11px] font-normal opacity-90'>
                        {t('消耗')}{' '}
                        <span className='font-semibold text-amber-600 dark:text-amber-400'>
                          {status.multi_cost}
                        </span>{' '}
                        {t('额度')} · {status.multi_draws}
                        {t('抽')}
                      </span>
                    </Button>
                    <span className='pointer-events-none absolute -top-2 -right-2 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white shadow'>
                      {t('省')}2
                    </span>
                  </div>
                </div>
                <div className='space-y-1 text-center text-xs'>
                  <p className='text-amber-700 dark:text-amber-300 font-medium'>
                    {t('十连只需消耗')} {status.multi_cost} {t('额度')}
                    {t('（原价')} {status.multi_draws}
                    {t('额度，立省')}{' '}
                    {(status.multi_draws - status.multi_cost).toFixed(0)}
                    {t('额度）')}
                  </p>
                  <p className='text-muted-foreground'>
                    {t(
                      '十连需今日未抽过（剩余 ≥10）。以到账为准；动画中断不退款。'
                    )}
                  </p>
                </div>

                {lastResult && (
                  <div className='rounded-xl border bg-muted/30 p-3'>
                    <div className='mb-2 text-sm font-medium'>
                      {t('本次结果')} · {t('合计')}{' '}
                      <span className='text-amber-500'>
                        {lastResult.total_prize_display}
                      </span>
                      {' · '}
                      {t('消耗')} {lastResult.cost_display}
                    </div>
                    <div className='flex flex-wrap gap-2'>
                      {lastResult.prizes.map((p, i) => (
                        <div
                          key={i}
                          className={cn(
                            'flex items-center gap-1 rounded-lg border px-2 py-1 text-sm',
                            p >= 5 && 'border-amber-400/50 bg-amber-500/10',
                            p >= 2 &&
                              p < 5 &&
                              'border-sky-400/40 bg-sky-500/10'
                          )}
                        >
                          <img
                            src={prizeIconUrl(p)}
                            alt={PRIZE_CHARS[p]?.name ?? ''}
                            className='h-6 w-6 rounded object-cover'
                          />
                          <span className='font-semibold tabular-nums'>{p}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className='pb-2'>
                <CardTitle className='text-base'>{t('概率公示')}</CardTitle>
                <CardDescription>
                  {t('单抽 EV')} ≈ {status.single_ev.toFixed(3)} ·{' '}
                  {t('十连总 EV')} ≈ {status.multi_ev_total.toFixed(3)}（
                  {t('让利')} {status.multi_subsidy.toFixed(2)}）
                </CardDescription>
              </CardHeader>
              <CardContent className='grid gap-4 md:grid-cols-2'>
                <OddsTable title={t('单抽')} rows={status.single_weights} />
                <OddsTable
                  title={t('十连（每抽）')}
                  rows={status.multi_weights}
                />
              </CardContent>
            </Card>
          </div>

          <PublicWinsTicker items={publicWins} />
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}

function OddsTable({
  title,
  rows,
}: {
  title: string
  rows: LotteryStatus['single_weights']
}) {
  return (
    <div>
      <div className='mb-2 text-sm font-medium'>{title}</div>
      <div className='overflow-hidden rounded-lg border text-xs'>
        <table className='w-full'>
          <thead className='bg-muted/50'>
            <tr>
              <th className='px-2 py-1.5 text-left'>金额</th>
              <th className='px-2 py-1.5 text-left'>角色</th>
              <th className='px-2 py-1.5 text-right'>概率</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.amount} className='border-t'>
                <td className='px-2 py-1 tabular-nums'>{r.amount}</td>
                <td className='px-2 py-1'>
                  <span className='inline-flex items-center gap-1'>
                    <img
                      src={prizeIconUrl(r.amount)}
                      alt=''
                      className='h-5 w-5 rounded object-cover'
                    />
                    {PRIZE_CHARS[r.amount]?.name ?? ''}
                  </span>
                </td>
                <td className='px-2 py-1 text-right tabular-nums'>
                  {(r.prob * 100).toFixed(2)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default LotteryPage
