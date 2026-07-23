/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/

export interface LotteryWeightRow {
  amount: number
  weight: number
  prob: number
  contrib: number
}

export interface LotteryStatus {
  enabled: boolean
  single_cost: number
  multi_cost: number
  multi_draws: number
  daily_draw_limit: number
  draws_used_today: number
  remaining_draws: number
  can_single: boolean
  can_multi: boolean
  quota: number
  public_win_min: number
  public_win_limit: number
  big_win_threshold: number
  prize_order: number[]
  single_weights: LotteryWeightRow[]
  multi_weights: LotteryWeightRow[]
  single_ev: number
  multi_ev_per_draw: number
  multi_ev_total: number
  multi_subsidy: number
  draw_date: string
  timezone: string
}

export interface LotteryDrawResult {
  mode: 'single' | 'multi' | string
  cost_display: number
  prizes: number[]
  total_prize_display: number
  slot_indexes: number[]
  big_wins: number[]
  remaining_draws: number
  quota: number
  draw_date: string
}

export interface PublicWinItem {
  date: string
  username: string
  prize: number
}

export interface ApiResponse<T = unknown> {
  success: boolean
  message?: string
  data?: T
}
