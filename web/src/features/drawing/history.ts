/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import type { DrawMode, GeneratedImage } from './types'

/** Browser-only drawing history. Never sent to the server. */
export const DRAWING_HISTORY_KEY = 'whyapi.drawing.history.v1'
export const DRAWING_HISTORY_MAX = 40
/** Soft cap so localStorage does not fill with large base64 images. */
export const DRAWING_HISTORY_MAX_BYTES = 4_500_000

export interface DrawingHistoryItem {
  id: string
  url: string
  /** Optional base64 without data: prefix — preferred for re-open after session */
  b64?: string
  revisedPrompt?: string
  prompt?: string
  mode: DrawMode
  model: string
  size: string
  group?: string
  createdAt: number
  error?: string
}

function safeParse(raw: string | null): DrawingHistoryItem[] {
  if (!raw) return []
  try {
    const data = JSON.parse(raw) as unknown
    if (!Array.isArray(data)) return []
    return data.filter(
      (x): x is DrawingHistoryItem =>
        !!x &&
        typeof x === 'object' &&
        typeof (x as DrawingHistoryItem).id === 'string' &&
        typeof (x as DrawingHistoryItem).createdAt === 'number'
    )
  } catch {
    return []
  }
}

export function loadDrawingHistory(): DrawingHistoryItem[] {
  if (typeof window === 'undefined') return []
  try {
    return safeParse(window.localStorage.getItem(DRAWING_HISTORY_KEY))
  } catch {
    return []
  }
}

function estimateBytes(items: DrawingHistoryItem[]): number {
  try {
    return new Blob([JSON.stringify(items)]).size
  } catch {
    return JSON.stringify(items).length
  }
}

function toDataUrl(item: DrawingHistoryItem): string {
  if (item.url && item.url.startsWith('data:')) return item.url
  if (item.b64) {
    if (item.b64.startsWith('data:')) return item.b64
    return `data:image/png;base64,${item.b64}`
  }
  return item.url || ''
}

/** Persist successful images only (skip pure errors with no image). */
export function saveDrawingHistory(items: DrawingHistoryItem[]): void {
  if (typeof window === 'undefined') return
  let next = items
    .filter((x) => !x.error && (x.url || x.b64))
    .slice(0, DRAWING_HISTORY_MAX)

  // Drop oldest until under size cap (keep most recent)
  while (next.length > 1 && estimateBytes(next) > DRAWING_HISTORY_MAX_BYTES) {
    next = next.slice(0, -1)
  }
  // If single item still huge, store without b64 (url-only may be empty after reload)
  if (next.length === 1 && estimateBytes(next) > DRAWING_HISTORY_MAX_BYTES) {
    const only = { ...next[0] }
    delete only.b64
    if (only.url && only.url.length > 200_000) {
      only.url = ''
    }
    next = only.url || only.b64 ? [only] : []
  }

  try {
    window.localStorage.setItem(DRAWING_HISTORY_KEY, JSON.stringify(next))
  } catch {
    // Quota exceeded: strip b64 and retry with fewer items
    try {
      const slim = next.map((x) => {
        const { b64: _b, ...rest } = x
        return rest
      })
      let trimmed = slim
      while (
        trimmed.length > 0 &&
        estimateBytes(trimmed) > DRAWING_HISTORY_MAX_BYTES
      ) {
        trimmed = trimmed.slice(0, -1)
      }
      window.localStorage.setItem(DRAWING_HISTORY_KEY, JSON.stringify(trimmed))
    } catch {
      try {
        window.localStorage.removeItem(DRAWING_HISTORY_KEY)
      } catch {
        /* empty */
      }
    }
  }
}

export function appendDrawingHistory(
  items: GeneratedImage[],
  extra?: { prompt?: string; group?: string }
): DrawingHistoryItem[] {
  const current = loadDrawingHistory()
  const mapped: DrawingHistoryItem[] = items
    .filter((x) => !x.error && (x.url || x.b64))
    .map((x) => ({
      id: x.id,
      url: toDataUrl({
        id: x.id,
        url: x.url,
        b64: x.b64,
        mode: x.mode,
        model: x.model,
        size: x.size,
        createdAt: x.createdAt,
      }),
      b64: x.b64,
      revisedPrompt: x.revisedPrompt,
      prompt: extra?.prompt,
      mode: x.mode,
      model: x.model,
      size: x.size,
      group: extra?.group,
      createdAt: x.createdAt,
    }))
  const merged = [...mapped, ...current]
  // de-dupe by id
  const seen = new Set<string>()
  const deduped: DrawingHistoryItem[] = []
  for (const item of merged) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    deduped.push(item)
  }
  saveDrawingHistory(deduped)
  return loadDrawingHistory()
}

export function removeDrawingHistoryItem(id: string): DrawingHistoryItem[] {
  const next = loadDrawingHistory().filter((x) => x.id !== id)
  saveDrawingHistory(next)
  return next
}

export function clearDrawingHistory(): DrawingHistoryItem[] {
  saveDrawingHistory([])
  return []
}

export function historyItemToGenerated(item: DrawingHistoryItem): GeneratedImage {
  return {
    id: item.id,
    url: toDataUrl(item),
    b64: item.b64,
    revisedPrompt: item.revisedPrompt,
    mode: item.mode,
    model: item.model,
    size: item.size,
    createdAt: item.createdAt,
    error: item.error,
  }
}
