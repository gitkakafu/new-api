/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { api } from '@/lib/api'

import type {
  ApiResponse,
  LotteryDrawResult,
  LotteryStatus,
  PublicWinItem,
} from './types'

export async function getLotteryStatus(): Promise<ApiResponse<LotteryStatus>> {
  const res = await api.get('/api/user/lottery/status')
  return res.data
}

export async function drawLottery(
  mode: 'single' | 'multi'
): Promise<ApiResponse<LotteryDrawResult>> {
  const res = await api.post('/api/user/lottery/draw', { mode })
  return res.data
}

export async function getLotteryPublicWins(): Promise<
  ApiResponse<{ items: PublicWinItem[]; updated_at: number }>
> {
  const res = await api.get('/api/user/lottery/public-wins')
  return res.data
}

export async function getLotteryHistory(): Promise<
  ApiResponse<{ items: Array<Record<string, unknown>> }>
> {
  const res = await api.get('/api/user/lottery/history')
  return res.data
}
