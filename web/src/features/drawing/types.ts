/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
export type DrawMode = 'images' | 'responses'

export type ImageSizeTier = '1K' | '2K' | '4K'

export interface GroupOption {
  label: string
  value: string
  ratio: number
  desc?: string
}

export interface DrawingConfig {
  mode: DrawMode
  /** Images API model (gpt-image-2) */
  imageModel: string
  /** Base chat model for /v1/responses + image_generation tool */
  chatModel: string
  group: string
  size: ImageSizeTier
  quality: string
  n: number
  prompt: string
}

export interface GeneratedImage {
  id: string
  url: string
  b64?: string
  revisedPrompt?: string
  mode: DrawMode
  model: string
  size: string
  createdAt: number
  error?: string
}

export const DEFAULT_IMAGE_MODEL = 'gpt-image-2'

/** Codex chat models allowed as the base for responses + image tool */
export const RESPONSE_BASE_MODELS = [
  'gpt-5.4',
  'gpt-5.5',
  'gpt-5.6-sol',
] as const

export const SIZE_OPTIONS: {
  value: ImageSizeTier
  label: string
  dimension: string
  note: string
}[] = [
  {
    value: '1K',
    label: '1K',
    dimension: '1024x1024',
    note: '$0.04 / image (group 0.04)',
  },
  {
    value: '2K',
    label: '2K',
    dimension: '2048x2048',
    note: '$0.04 / image (group 0.04)',
  },
  {
    value: '4K',
    label: '4K',
    dimension: '3840x2160',
    note: '$0.08 / image (group 0.04)',
  },
]

export function sizeToApiDimension(size: ImageSizeTier): string {
  switch (size) {
    case '4K':
      return '3840x2160'
    case '2K':
      return '2048x2048'
    default:
      return '1024x1024'
  }
}
