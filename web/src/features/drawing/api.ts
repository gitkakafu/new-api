/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { api } from '@/lib/api'

import type { DrawMode, GroupOption, ImageSizeTier } from './types'
import { sizeToApiDimension } from './types'

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

export async function getUserModels(group: string): Promise<string[]> {
  const res = await api.get('/api/user/models', { params: { group } })
  const { data } = res
  if (!data.success || !Array.isArray(data.data)) return []
  return data.data as string[]
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

/** Path 1: OpenAI Images API → /v1/images/generations (gpt-image-2) */
export async function generateViaImagesApi(params: {
  model: string
  prompt: string
  size: ImageSizeTier
  quality?: string
  n?: number
  group?: string
  signal?: AbortSignal
}): Promise<ImagesGenerateResult> {
  const body: Record<string, unknown> = {
    model: params.model,
    prompt: params.prompt,
    size: sizeToApiDimension(params.size),
    n: params.n ?? 1,
    response_format: 'b64_json',
  }
  if (params.quality) body.quality = params.quality
  if (params.group) body.group = params.group

  // Session-auth playground path (UserAuth + virtual token) — not /v1 TokenAuth
  const res = await api.post('/pg/images/generations', body, {
    signal: params.signal,
    skipErrorHandler: true,
    skipAuthRefresh: true,
    timeout: 300_000,
  } as Record<string, unknown>)
  return res.data
}

/** Path 2: Codex /v1/responses + image_generation tool (same as sub2api GPT Image 2 test) */
export async function generateViaResponsesTool(params: {
  chatModel: string
  prompt: string
  size: ImageSizeTier
  quality?: string
  group?: string
  signal?: AbortSignal
}): Promise<{
  images: Array<{ b64?: string; url?: string; revisedPrompt?: string }>
  raw?: unknown
  error?: string
}> {
  const size = sizeToApiDimension(params.size)
  const body: Record<string, unknown> = {
    model: params.chatModel,
    input: params.prompt,
    tools: [
      {
        type: 'image_generation',
        model: 'gpt-image-2',
        size,
        quality: params.quality || 'auto',
      },
    ],
    tool_choice: { type: 'image_generation' },
    stream: false,
  }
  if (params.group) body.group = params.group

  // Session-auth playground path — bills logged-in user without sk- API key
  const res = await api.post('/pg/responses', body, {
    signal: params.signal,
    skipErrorHandler: true,
    skipAuthRefresh: true,
    timeout: 300_000,
  } as Record<string, unknown>)

  const data = res.data as {
    error?: { message?: string }
    output?: Array<{
      type?: string
      result?: string
      revised_prompt?: string
      status?: string
    }>
  }

  if (data?.error?.message) {
    return { images: [], error: data.error.message, raw: data }
  }

  const images: Array<{ b64?: string; url?: string; revisedPrompt?: string }> =
    []
  for (const item of data?.output || []) {
    if (item.type === 'image_generation_call' && item.result) {
      images.push({
        b64: item.result,
        revisedPrompt: item.revised_prompt,
      })
    }
  }
  return { images, raw: data }
}

export function modeLabel(mode: DrawMode): string {
  return mode === 'images' ? '图像接口' : '对话 + 画图工具'
}
