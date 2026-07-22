/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { api } from '@/lib/api'

import type { DrawMode, GroupOption } from './types'

export async function getUserGroups(): Promise<GroupOption[]> {
  const res = await api.get('/api/user/self/groups')
  const { data } = res
  if (!data.success || !data.data) return []
  const groupData = data.data as Record<string, { desc: string; ratio: number }>
  return Object.entries(groupData).map(([group, info]) => ({
    label: group,
    value: group,
    ratio: info.ratio,
    desc: info.desc,
  }))
}

export interface ImagesGenerateResult {
  created?: number
  data?: Array<{
    url?: string
    b64_json?: string
    revised_prompt?: string
  }>
  error?: { message?: string; type?: string }
}

const pgOpts = (signal?: AbortSignal) =>
  ({
    signal,
    skipErrorHandler: true,
    skipAuthRefresh: true,
    timeout: 300_000,
  }) as Record<string, unknown>

/**
 * 生成图像 → /pg/images/generations
 * @param size `auto` 或归一化后的 `WxH`
 */
export async function generateViaImagesApi(params: {
  model: string
  prompt: string
  /** `auto` or `WxH` */
  size: string
  quality?: string
  n?: number
  group?: string
  signal?: AbortSignal
}): Promise<ImagesGenerateResult> {
  const body: Record<string, unknown> = {
    model: params.model,
    prompt: params.prompt,
    size: params.size,
    n: params.n ?? 1,
    response_format: 'b64_json',
  }
  if (params.quality) body.quality = params.quality
  if (params.group) body.group = params.group

  const res = await api.post(
    '/pg/images/generations',
    body,
    pgOpts(params.signal)
  )
  return res.data
}

/**
 * 编辑图像 → /pg/images/edits（JSON + base64 图，可多张）
 * image 字段为 data URL 或纯 base64 字符串数组。
 */
export async function editViaImagesApi(params: {
  model: string
  prompt: string
  /** data:image/...;base64,... or raw base64 */
  images: string[]
  /** `auto` or `WxH` */
  size: string
  quality?: string
  n?: number
  group?: string
  signal?: AbortSignal
}): Promise<ImagesGenerateResult> {
  if (!params.images.length) {
    return { error: { message: '至少选择一张参考图' } }
  }

  const body: Record<string, unknown> = {
    model: params.model,
    prompt: params.prompt,
    size: params.size,
    n: params.n ?? 1,
    response_format: 'b64_json',
    // OpenAI-compatible multi-image edit: array of base64 / data URLs
    image: params.images.length === 1 ? params.images[0] : params.images,
  }
  if (params.quality) body.quality = params.quality
  if (params.group) body.group = params.group

  const res = await api.post('/pg/images/edits', body, pgOpts(params.signal))
  return res.data
}

export function modeLabel(mode: DrawMode): string {
  return mode === 'edit' ? '编辑图像' : '生成图像'
}
