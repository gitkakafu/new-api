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
/** Keep at most this many successful entries (newest first). No byte/size cap. */
export const DRAWING_HISTORY_MAX = 30

export interface DrawingHistoryItem {
  id: string
  /**
   * Raw base64 image payload (no `data:` prefix). Preferred for CN users —
   * do not rely on remote Codex/CDN URLs which are often slow or blocked.
   */
  b64: string
  revisedPrompt?: string
  prompt?: string
  mode: DrawMode
  model: string
  size: string
  group?: string
  createdAt: number
  error?: string
}

/** Strip `data:image/...;base64,` prefix → pure b64. Reject bare remote URLs. */
export function toRawB64(b64?: string, url?: string): string {
  const fromB64 = (s: string) => {
    const t = s.trim()
    if (!t) return ''
    if (t.startsWith('data:')) {
      const i = t.indexOf('base64,')
      return i >= 0 ? t.slice(i + 'base64,'.length) : ''
    }
    // already raw base64 (or unknown) — keep if it does not look like a URL
    if (t.startsWith('http://') || t.startsWith('https://')) return ''
    return t
  }
  if (b64) {
    const got = fromB64(b64)
    if (got) return got
  }
  if (url) {
    // Only accept data URLs for migration; never persist remote http(s) links
    if (url.startsWith('data:')) return fromB64(url)
  }
  return ''
}

/** Build a browser-displayable src from stored b64 (session-only, not persisted). */
export function b64ToDisplaySrc(b64: string): string {
  const raw = toRawB64(b64)
  if (!raw) return ''
  return `data:image/png;base64,${raw}`
}

function safeParse(raw: string | null): DrawingHistoryItem[] {
  if (!raw) return []
  try {
    const data = JSON.parse(raw) as unknown
    if (!Array.isArray(data)) return []
    return data
      .filter(
        (x): x is DrawingHistoryItem & { url?: string } =>
          !!x &&
          typeof x === 'object' &&
          typeof (x as DrawingHistoryItem).id === 'string' &&
          typeof (x as DrawingHistoryItem).createdAt === 'number'
      )
      .map((x) => {
        const legacyUrl = (x as { url?: string }).url
        const b64 = toRawB64(x.b64, legacyUrl)
        const mode: DrawMode =
          x.mode === 'edit' || x.mode === 'generate' ? x.mode : 'generate'
        return {
          id: x.id,
          b64,
          revisedPrompt: x.revisedPrompt,
          prompt: x.prompt,
          mode,
          model: x.model,
          size: x.size,
          group: x.group,
          createdAt: x.createdAt,
          error: x.error,
        } satisfies DrawingHistoryItem
      })
      .filter((x) => !!x.b64 || !!x.error)
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

function trySet(items: DrawingHistoryItem[]): boolean {
  try {
    window.localStorage.setItem(DRAWING_HISTORY_KEY, JSON.stringify(items))
    return true
  } catch {
    return false
  }
}

/**
 * Persist successful images only.
 * - Store raw b64 only (never data URL, never remote Codex/CDN url).
 * - No soft byte/MB budget.
 * - Cap by count only (DRAWING_HISTORY_MAX).
 * - Only if the browser throws QuotaExceeded: drop oldest, then strip previews.
 */
export function saveDrawingHistory(items: DrawingHistoryItem[]): void {
  if (typeof window === 'undefined') return
  const next = items
    .filter((x) => !x.error && x.b64)
    .map((x) => ({
      ...x,
      // enforce raw b64 on write
      b64: toRawB64(x.b64),
    }))
    .filter((x) => !!x.b64)
    .slice(0, DRAWING_HISTORY_MAX)

  if (trySet(next)) return

  // Browser quota only — never pre-trim by an artificial size limit
  let trimmed = [...next]
  while (trimmed.length > 0) {
    if (trySet(trimmed)) return
    trimmed = trimmed.slice(0, -1)
  }

  const metaOnly = next.slice(0, 10).map((x) => ({
    ...x,
    b64: '',
  }))
  if (trySet(metaOnly)) return

  try {
    window.localStorage.removeItem(DRAWING_HISTORY_KEY)
  } catch {
    /* empty */
  }
}

export function appendDrawingHistory(
  items: GeneratedImage[],
  extra?: { prompt?: string; group?: string }
): DrawingHistoryItem[] {
  const current = loadDrawingHistory()
  const mapped: DrawingHistoryItem[] = items
    .map((x) => {
      const b64 = toRawB64(x.b64, x.url)
      return {
        id: x.id,
        b64,
        revisedPrompt: x.revisedPrompt,
        prompt: extra?.prompt,
        mode: x.mode,
        model: x.model,
        size: x.size,
        group: extra?.group,
        createdAt: x.createdAt,
      } satisfies DrawingHistoryItem
    })
    .filter((x) => !!x.b64)

  // Newest first; keep older entries
  const merged = [...mapped, ...current]
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
  const b64 = toRawB64(item.b64)
  return {
    id: item.id,
    // display src only — built from b64, never remote URL
    url: b64ToDisplaySrc(b64),
    b64,
    revisedPrompt: item.revisedPrompt,
    mode: item.mode,
    model: item.model,
    size: item.size,
    createdAt: item.createdAt,
    error: item.error,
  }
}
