/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
/** generate = 生成图像；edit = 编辑图像（多图 base64） */
export type DrawMode = 'generate' | 'edit'

/** 尺寸模式：自动 / 按比例 / 自定义 */
export type SizeMode = 'auto' | 'ratio' | 'custom'

export type ImageSizeTier = '1K' | '2K' | '4K'

export type AspectRatio =
  | '1:1'
  | '3:2'
  | '2:3'
  | '16:9'
  | '9:16'
  | '4:3'
  | '3:4'
  | '21:9'

export interface GroupOption {
  label: string
  value: string
  ratio: number
  desc?: string
}

export interface GeneratedImage {
  id: string
  url: string
  b64?: string
  revisedPrompt?: string
  mode: DrawMode
  model: string
  /** API size string actually sent (auto or WxH) */
  size: string
  createdAt: number
  error?: string
}

/** UI state for size picker */
export interface SizePickerState {
  sizeMode: SizeMode
  tier: ImageSizeTier
  ratio: AspectRatio
  customW: string
  customH: string
}

export const DEFAULT_IMAGE_MODEL = 'gpt-image-2'

export const DEFAULT_SIZE_PICKER: SizePickerState = {
  sizeMode: 'auto',
  tier: '1K',
  ratio: '1:1',
  customW: '1024',
  customH: '1024',
}

export const TIER_OPTIONS: ImageSizeTier[] = ['1K', '2K', '4K']

export const ASPECT_RATIO_OPTIONS: { label: string; value: AspectRatio }[] = [
  { label: '1:1', value: '1:1' },
  { label: '3:2', value: '3:2' },
  { label: '2:3', value: '2:3' },
  { label: '16:9', value: '16:9' },
  { label: '9:16', value: '9:16' },
  { label: '4:3', value: '4:3' },
  { label: '3:4', value: '3:4' },
  { label: '21:9', value: '21:9' },
]

// ── size normalization (upstream-compatible) ──────────────
// 边对齐 16、单边 ≤ 3840、宽高比 ≤ 3:1、像素 [655360, 8294400]（约 65w–829w）

const ALIGN = 16
const MAX_EDGE = 3840
const MAX_ASPECT = 3
const MIN_PIXELS = 655_360
const MAX_PIXELS = 8_294_400

function roundAlign(n: number, step: number): number {
  return Math.max(step, Math.round(n / step) * step)
}
function floorAlign(n: number, step: number): number {
  return Math.max(step, Math.floor(n / step) * step)
}
function ceilAlign(n: number, step: number): number {
  return Math.max(step, Math.ceil(n / step) * step)
}

/** Normalize WxH to upstream rules. */
export function normalizeDimensions(
  width: number,
  height: number
): { width: number; height: number } {
  let w = roundAlign(width, ALIGN)
  let h = roundAlign(height, ALIGN)

  for (let i = 0; i < 4; i++) {
    const maxEdge = Math.max(w, h)
    if (maxEdge > MAX_EDGE) {
      const scale = MAX_EDGE / maxEdge
      w = floorAlign(w * scale, ALIGN)
      h = floorAlign(h * scale, ALIGN)
    }
    if (w / h > MAX_ASPECT) {
      w = floorAlign(h * MAX_ASPECT, ALIGN)
    } else if (h / w > MAX_ASPECT) {
      h = floorAlign(w * MAX_ASPECT, ALIGN)
    }
    const pixels = w * h
    if (pixels > MAX_PIXELS) {
      const scale = Math.sqrt(MAX_PIXELS / pixels)
      w = floorAlign(w * scale, ALIGN)
      h = floorAlign(h * scale, ALIGN)
    } else if (pixels < MIN_PIXELS) {
      const scale = Math.sqrt(MIN_PIXELS / pixels)
      w = ceilAlign(w * scale, ALIGN)
      h = ceilAlign(h * scale, ALIGN)
    }
  }
  return { width: w, height: h }
}

export function normalizeSizeString(size: string): string {
  const s = String(size || '').trim()
  if (!s || s === 'auto') return s || 'auto'
  const m = s.match(/^(\d+)\s*[x×]\s*(\d+)$/i)
  if (!m) return s
  const { width, height } = normalizeDimensions(Number(m[1]), Number(m[2]))
  return `${width}x${height}`
}

function parseRatio(ratio: string): { width: number; height: number } | null {
  const m = String(ratio || '').match(
    /^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/
  )
  if (!m) return null
  const width = Number(m[1])
  const height = Number(m[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }
  return { width, height }
}

/**
 * 按比例：基准分辨率(tier) + 图像比例 → 归一化后的 WxH。
 * tier + aspect ratio → WxH.
 */
export function sizeFromTierAndRatio(
  tier: ImageSizeTier,
  ratio: string
): string | null {
  const r = parseRatio(ratio)
  if (!r) return null
  const { width: aw, height: ah } = r

  if (aw === ah) {
    const m = tier === '1K' ? 1024 : tier === '2K' ? 2048 : 3840
    return normalizeSizeString(`${m}x${m}`)
  }

  if (tier === '1K') {
    const g = aw > ah ? roundAlign((1024 * aw) / ah, ALIGN) : 1024
    const d = aw > ah ? 1024 : roundAlign((1024 * ah) / aw, ALIGN)
    return normalizeSizeString(`${g}x${d}`)
  }

  const t = tier === '2K' ? 2048 : 3840
  const i = aw > ah ? t : roundAlign((t * aw) / ah, ALIGN)
  const c = aw > ah ? roundAlign((t * ah) / aw, ALIGN) : t
  return normalizeSizeString(`${i}x${c}`)
}

/** Resolve UI size picker → API `size` field (`auto` or `WxH`). */
export function resolveApiSize(state: SizePickerState): string {
  if (state.sizeMode === 'auto') return 'auto'
  if (state.sizeMode === 'ratio') {
    return sizeFromTierAndRatio(state.tier, state.ratio) || 'auto'
  }
  const w = Number(state.customW) || 1024
  const h = Number(state.customH) || 1024
  return normalizeSizeString(`${w}x${h}`)
}

/** Billing tier hint from a resolved size string (for UI notes only). */
export function classifyBillingTier(size: string): '1K' | '2K' | '4K' | 'auto' {
  const s = String(size || '').trim().toLowerCase()
  if (!s || s === 'auto') return 'auto'
  if (s === '1k' || s === '2k' || s === '4k') {
    return s.toUpperCase() as '1K' | '2K' | '4K'
  }
  const m = s.match(/^(\d+)\s*x\s*(\d+)$/)
  if (!m) return '1K'
  const maxEdge = Math.max(Number(m[1]), Number(m[2]))
  if (maxEdge <= 1024) return '1K'
  if (maxEdge <= 2048) return '2K'
  return '4K'
}

export function billingTierNote(size: string): string {
  const tier = classifyBillingTier(size)
  if (tier === 'auto') {
    return '自动：由模型决定输出尺寸。若输出达到 4K 档（长边 > 2048），按 4K 计费。'
  }
  if (tier === '4K') {
    return `当前 ${size} → 4K 档`
  }
  return `当前 ${size} → ${tier} 档`
}

/** Normalize user-selected file to a data URL for preview + API. */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('read failed'))
    reader.readAsDataURL(file)
  })
}
