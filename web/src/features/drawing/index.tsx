/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import {
  Download,
  History,
  ImageIcon,
  Loader2,
  Pencil,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

import {
  editViaImagesApi,
  generateViaImagesApi,
  getUserGroups,
} from './api'
import {
  appendDrawingHistory,
  b64ToDisplaySrc,
  clearDrawingHistory,
  historyItemToGenerated,
  loadDrawingHistory,
  removeDrawingHistoryItem,
  type DrawingHistoryItem,
} from './history'
import {
  ASPECT_RATIO_OPTIONS,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_SIZE_PICKER,
  TIER_OPTIONS,
  billingTierNote,
  fileToDataUrl,
  resolveApiSize,
  type AspectRatio,
  type DrawMode,
  type GeneratedImage,
  type GroupOption,
  type SizeMode,
  type SizePickerState,
} from './types'

const MAX_EDIT_IMAGES = 8
const MAX_EDIT_FILE_BYTES = 12 * 1024 * 1024

export function DrawingPage() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<DrawMode>('generate')
  const [prompt, setPrompt] = useState(
    '可爱的橙色猫咪宇航员贴纸，正面朝向，圆润萌系，穿白色宇航服带淡彩点缀，小头盔透明面罩，小爪子露出来，大眼睛，干净粉彩背景留白，贴纸风格清晰描边，柔和阴影，高清，居中构图'
  )
  const [sizePicker, setSizePicker] =
    useState<SizePickerState>(DEFAULT_SIZE_PICKER)
  const [group, setGroup] = useState('')
  const [groups, setGroups] = useState<GroupOption[]>([])
  const [loading, setLoading] = useState(false)
  /** Elapsed wait seconds while generate/edit request is in flight. */
  const [waitSeconds, setWaitSeconds] = useState(0)
  const [results, setResults] = useState<GeneratedImage[]>([])
  const [history, setHistory] = useState<DrawingHistoryItem[]>([])
  /** data URLs for edit mode reference images */
  const [editImages, setEditImages] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setHistory(loadDrawingHistory())
  }, [])

  // Tick elapsed seconds while a generate/edit request is pending.
  useEffect(() => {
    if (!loading) {
      return
    }
    setWaitSeconds(0)
    const started = Date.now()
    const timer = window.setInterval(() => {
      setWaitSeconds(Math.floor((Date.now() - started) / 1000))
    }, 250)
    return () => {
      window.clearInterval(timer)
    }
  }, [loading])

  useEffect(() => {
    void (async () => {
      try {
        const g = await getUserGroups()
        setGroups(g)
        if (g.length > 0) {
          const preferred =
            g.find((x) => x.value === '1_vip_codex') ||
            g.find((x) => x.value.includes('codex')) ||
            g[0]
          setGroup(preferred.value)
        }
      } catch {
        /* empty */
      }
    })()
  }, [])

  const resolvedSize = useMemo(
    () => resolveApiSize(sizePicker),
    [sizePicker]
  )
  const sizeNote = useMemo(
    () => billingTierNote(resolvedSize),
    [resolvedSize]
  )

  const patchSize = useCallback((patch: Partial<SizePickerState>) => {
    setSizePicker((prev) => ({ ...prev, ...patch }))
  }, [])

  const persistSuccess = useCallback(
    (imgs: GeneratedImage[], text: string) => {
      const next = appendDrawingHistory(imgs, {
        prompt: text,
        group: group || undefined,
      })
      setHistory(next)
    },
    [group]
  )

  const handlePickFiles = useCallback(
    async (files: FileList | null) => {
      if (!files?.length) return
      const remaining = MAX_EDIT_IMAGES - editImages.length
      if (remaining <= 0) {
        toast.warning(t('最多选择 {{n}} 张参考图', { n: MAX_EDIT_IMAGES }))
        return
      }
      const list = Array.from(files).slice(0, remaining)
      const next: string[] = []
      for (const file of list) {
        if (!file.type.startsWith('image/')) {
          toast.warning(t('仅支持图片文件'))
          continue
        }
        if (file.size > MAX_EDIT_FILE_BYTES) {
          toast.warning(t('单张图片请小于 12MB'))
          continue
        }
        try {
          next.push(await fileToDataUrl(file))
        } catch {
          toast.error(t('读取图片失败'))
        }
      }
      if (next.length) {
        setEditImages((prev) => [...prev, ...next].slice(0, MAX_EDIT_IMAGES))
      }
      if (fileInputRef.current) fileInputRef.current.value = ''
    },
    [editImages.length, t]
  )

  const removeEditImage = useCallback((idx: number) => {
    setEditImages((prev) => prev.filter((_, i) => i !== idx))
  }, [])

  const mapApiImages = useCallback(
    (
      data: Array<{
        url?: string
        b64_json?: string
        revised_prompt?: string
      }>,
      id: string,
      currentMode: DrawMode
    ): GeneratedImage[] =>
      data.map((item, idx) => {
        // Prefer b64_json — avoid remote Codex/CDN urls for CN users
        const b64 = item.b64_json?.trim() || undefined
        const url = b64
          ? `data:image/png;base64,${b64}`
          : item.url || ''
        return {
          id: `${id}-${idx}`,
          url,
          b64,
          revisedPrompt: item.revised_prompt,
          mode: currentMode,
          model: DEFAULT_IMAGE_MODEL,
          size: resolvedSize,
          createdAt: Date.now(),
        } satisfies GeneratedImage
      }),
    [resolvedSize]
  )


  const downloadImage = useCallback(
    (src: string, filename: string) => {
      if (!src) {
        toast.warning(t('暂无图片可下载'))
        return
      }
      try {
        const a = document.createElement('a')
        a.href = src
        a.download = filename
        a.rel = 'noopener'
        document.body.appendChild(a)
        a.click()
        a.remove()
      } catch {
        toast.error(t('下载失败'))
      }
    },
    [t]
  )

  const downloadFromB64 = useCallback(
    (b64: string | undefined, filename: string) => {
      const raw = (b64 || '').trim()
      if (!raw) {
        toast.warning(t('暂无图片可下载'))
        return
      }
      const dataUrl = raw.startsWith('data:')
        ? raw
        : `data:image/png;base64,${raw}`
      downloadImage(dataUrl, filename)
    },
    [downloadImage, t]
  )

  const handleGenerate = useCallback(async () => {
    const text = prompt.trim()
    if (!text) {
      toast.warning(t('请输入提示词'))
      return
    }
    if (!group) {
      toast.warning(t('请选择分组'))
      return
    }
    if (mode === 'edit' && editImages.length === 0) {
      toast.warning(t('请至少选择一张参考图'))
      return
    }
    setLoading(true)
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    try {
      const apiSize = resolveApiSize(sizePicker)
      const res =
        mode === 'edit'
          ? await editViaImagesApi({
              model: DEFAULT_IMAGE_MODEL,
              prompt: text,
              images: editImages,
              size: apiSize,
              group,
              n: 1,
            })
          : await generateViaImagesApi({
              model: DEFAULT_IMAGE_MODEL,
              prompt: text,
              size: apiSize,
              group,
              n: 1,
            })

      if (res.error?.message) {
        toast.error(res.error.message)
        setResults((prev) => [
          {
            id,
            url: '',
            mode,
            model: DEFAULT_IMAGE_MODEL,
            size: apiSize,
            createdAt: Date.now(),
            error: res.error?.message,
          },
          ...prev,
        ])
        return
      }
      const imgs = mapApiImages(res.data || [], id, mode)
      if (imgs.length === 0) {
        toast.error(t('未返回图片'))
      } else {
        toast.success(mode === 'edit' ? t('编辑成功') : t('生成成功'))
        setResults((prev) => [...imgs, ...prev])
        persistSuccess(imgs, text)
      }
    } catch (err) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })
          ?.response?.data?.error?.message ||
        (err as Error)?.message ||
        t('请求失败')
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }, [
    prompt,
    mode,
    sizePicker,
    group,
    editImages,
    t,
    persistSuccess,
    mapApiImages,
  ])

  const handleClearSession = useCallback(() => {
    setResults([])
  }, [])

  const handleClearHistory = useCallback(() => {
    setHistory(clearDrawingHistory())
    toast.success(t('已清空本机历史'))
  }, [t])

  const handleRemoveHistory = useCallback((itemId: string) => {
    setHistory(removeDrawingHistoryItem(itemId))
  }, [])

  const handleRestoreHistory = useCallback((item: DrawingHistoryItem) => {
    const gen = historyItemToGenerated(item)
    setResults((prev) => {
      if (prev.some((x) => x.id === gen.id)) return prev
      return [gen, ...prev]
    })
    if (item.prompt) setPrompt(item.prompt)
  }, [])

  return (
    <div className='mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 md:p-6 pb-10'>
      <div className='flex flex-col gap-1'>
        <h1 className='flex items-center gap-2 text-xl font-semibold tracking-tight md:text-2xl'>
          <ImageIcon className='text-primary size-6' />
          {t('画图')}
        </h1>
        <p className='text-muted-foreground max-w-3xl text-sm leading-6'>
          {t(
            '使用 GPT Image 2。支持「生成图像」与「编辑图像」（多图 base64）。尺寸可选自动 / 按比例 / 自定义；计费按实际输出档位（4K 长边 > 2048 按 4K 档）。'
          )}
        </p>
      </div>

      <div className='grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]'>
        <div className='border-border bg-card space-y-4 rounded-xl border p-4 shadow-sm'>
          <div className='space-y-2'>
            <Label>{t('模式')}</Label>
            <div className='grid grid-cols-2 gap-2'>
              <Button
                type='button'
                variant={mode === 'generate' ? 'default' : 'outline'}
                className='h-auto flex-col items-start gap-0.5 py-2.5 text-left'
                onClick={() => setMode('generate')}
              >
                <span className='font-medium'>{t('生成图像')}</span>
                <span className='text-xs font-normal opacity-80'>
                  /pg/images/generations
                </span>
              </Button>
              <Button
                type='button'
                variant={mode === 'edit' ? 'default' : 'outline'}
                className='h-auto flex-col items-start gap-0.5 py-2.5 text-left'
                onClick={() => setMode('edit')}
              >
                <span className='font-medium'>{t('编辑图像')}</span>
                <span className='text-xs font-normal opacity-80'>
                  /pg/images/edits · base64
                </span>
              </Button>
            </div>
          </div>

          <div className='space-y-1 rounded-lg border border-dashed px-3 py-2 text-sm'>
            <div className='font-medium'>{DEFAULT_IMAGE_MODEL}</div>
            <p className='text-muted-foreground text-xs'>
              {t('广场固定价模型，生成与编辑走同一套尺寸倍率计费。')}
            </p>
          </div>

          {mode === 'edit' && (
            <div className='space-y-2'>
              <Label>{t('参考图（可多张）')}</Label>
              <input
                ref={fileInputRef}
                type='file'
                accept='image/*'
                multiple
                className='hidden'
                onChange={(e) => void handlePickFiles(e.target.files)}
              />
              <div className='flex flex-wrap gap-2'>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  className='gap-1.5'
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className='size-3.5' />
                  {t('选择图片')}
                </Button>
                {editImages.length > 0 && (
                  <Button
                    type='button'
                    variant='ghost'
                    size='sm'
                    onClick={() => setEditImages([])}
                  >
                    {t('清空参考图')}
                  </Button>
                )}
              </div>
              <p className='text-muted-foreground text-xs'>
                {t('最多 {{n}} 张，以 base64 提交编辑。', {
                  n: MAX_EDIT_IMAGES,
                })}
              </p>
              {editImages.length > 0 && (
                <div className='grid grid-cols-3 gap-2 sm:grid-cols-4'>
                  {editImages.map((src, idx) => (
                    <div
                      key={`${idx}-${src.slice(0, 24)}`}
                      className='relative overflow-hidden rounded-md border'
                    >
                      <img
                        src={src}
                        alt={`ref-${idx + 1}`}
                        className='bg-muted aspect-square w-full object-cover'
                      />
                      <button
                        type='button'
                        className='bg-background/90 absolute top-1 right-1 rounded-full border p-0.5'
                        onClick={() => removeEditImage(idx)}
                        title={t('移除')}
                      >
                        <X className='size-3' />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className='grid gap-3 sm:grid-cols-2'>
            <div className='space-y-3 sm:col-span-2'>
              <Label>{t('尺寸')}</Label>
              <div className='grid grid-cols-3 gap-2'>
                {(
                  [
                    { v: 'auto' as SizeMode, label: t('自动') },
                    { v: 'ratio' as SizeMode, label: t('按比例') },
                    { v: 'custom' as SizeMode, label: t('自定义') },
                  ] as const
                ).map((opt) => (
                  <Button
                    key={opt.v}
                    type='button'
                    variant={
                      sizePicker.sizeMode === opt.v ? 'default' : 'outline'
                    }
                    className='h-9'
                    onClick={() => patchSize({ sizeMode: opt.v })}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>

              {sizePicker.sizeMode === 'ratio' && (
                <div className='grid gap-3 sm:grid-cols-2'>
                  <div className='space-y-2'>
                    <Label className='text-muted-foreground text-xs'>
                      {t('基准分辨率')}
                    </Label>
                    <div className='grid grid-cols-3 gap-2'>
                      {TIER_OPTIONS.map((tier) => (
                        <Button
                          key={tier}
                          type='button'
                          size='sm'
                          variant={
                            sizePicker.tier === tier ? 'default' : 'outline'
                          }
                          onClick={() => patchSize({ tier })}
                        >
                          {tier}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div className='space-y-2'>
                    <Label className='text-muted-foreground text-xs'>
                      {t('图像比例')}
                    </Label>
                    <Select
                      value={sizePicker.ratio}
                      onValueChange={(v) =>
                        v && patchSize({ ratio: String(v) as AspectRatio })
                      }
                    >
                      <SelectTrigger className='w-full'>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent alignItemWithTrigger={false}>
                        <SelectGroup>
                          {ASPECT_RATIO_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              {sizePicker.sizeMode === 'custom' && (
                <div className='grid grid-cols-2 gap-3'>
                  <div className='space-y-2'>
                    <Label className='text-muted-foreground text-xs'>
                      {t('宽')}
                    </Label>
                    <input
                      type='number'
                      min={16}
                      max={3840}
                      step={16}
                      value={sizePicker.customW}
                      onChange={(e) => patchSize({ customW: e.target.value })}
                      className='border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-sm transition-colors focus-visible:ring-1 focus-visible:outline-none'
                    />
                  </div>
                  <div className='space-y-2'>
                    <Label className='text-muted-foreground text-xs'>
                      {t('高')}
                    </Label>
                    <input
                      type='number'
                      min={16}
                      max={3840}
                      step={16}
                      value={sizePicker.customH}
                      onChange={(e) => patchSize({ customH: e.target.value })}
                      className='border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-sm transition-colors focus-visible:ring-1 focus-visible:outline-none'
                    />
                  </div>
                  <p className='text-muted-foreground col-span-2 text-xs'>
                    {t(
                      '默认 1024×1024。提交前按上游规则归一化：边对齐 16、单边 ≤ 3840、宽高比 ≤ 3:1、像素约 65w–829w。'
                    )}
                  </p>
                </div>
              )}

              <p className='text-muted-foreground text-xs'>
                {t('请求尺寸')}：
                <span className='text-foreground font-mono'>
                  {resolvedSize}
                </span>
                {' · '}
                {sizeNote}
              </p>
            </div>


            <div className='space-y-2 sm:col-span-2'>
              <Label>{t('分组')}</Label>
              <Select
                value={group}
                onValueChange={(v) => v && setGroup(String(v))}
              >
                <SelectTrigger className='w-full'>
                  <SelectValue placeholder={t('选择分组')} />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectGroup>
                    {groups.map((g) => (
                      <SelectItem key={g.value} value={g.value}>
                        {g.label}
                        {g.desc ? ` — ${g.desc}` : ''}
                        {typeof g.ratio === 'number' ? ` (×${g.ratio})` : ''}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className='space-y-2'>
            <Label>{t('提示词')}</Label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={8}
              className='min-h-40 resize-y font-mono text-sm'
              placeholder={
                mode === 'edit'
                  ? t('描述如何编辑参考图…')
                  : t('描述你想生成的图片…')
              }
            />
          </div>

          <div className='flex flex-wrap items-center gap-3'>
            <Button onClick={handleGenerate} disabled={loading} className='gap-2'>
              {loading ? (
                <Loader2 className='size-4 animate-spin' />
              ) : mode === 'edit' ? (
                <Pencil className='size-4' />
              ) : (
                <Sparkles className='size-4' />
              )}
              {loading
                ? t('处理中…')
                : mode === 'edit'
                  ? t('编辑')
                  : t('生成')}
            </Button>
            {loading && (
              <span
                className='text-muted-foreground tabular-nums text-sm'
                aria-live='polite'
              >
                {t('已等待')} {waitSeconds} {t('秒')}
              </span>
            )}
            <Button
              type='button'
              variant='outline'
              disabled={results.length === 0}
              onClick={handleClearSession}
              className='gap-2'
            >
              <Trash2 className='size-4' />
              {t('清空本次')}
            </Button>
          </div>
        </div>

        <div className='border-border bg-card min-h-[320px] space-y-3 rounded-xl border p-4 shadow-sm'>
          <div className='flex items-center justify-between gap-2'>
            <h2 className='text-sm font-semibold'>{t('结果')}</h2>
            <span className='text-muted-foreground text-xs'>
              {results.length} {t('张')}
            </span>
          </div>

          {results.length === 0 ? (
            <div className='text-muted-foreground flex min-h-[280px] flex-col items-center justify-center gap-2 text-center text-sm'>
              <ImageIcon className='size-10 opacity-40' />
              <p>{t('生成的图片会显示在这里。')}</p>
            </div>
          ) : (
            <div className='grid gap-4 sm:grid-cols-2'>
              {results.map((img) => (
                <div
                  key={img.id}
                  className={cn(
                    'overflow-hidden rounded-lg border',
                    img.error && 'border-destructive/40'
                  )}
                >
                  <div className='relative'>
                    {img.url ? (
                      <a href={img.url} target='_blank' rel='noreferrer'>
                        <img
                          src={img.url}
                          alt={img.revisedPrompt || prompt}
                          className='bg-muted aspect-square w-full object-cover'
                        />
                      </a>
                    ) : (
                      <div className='bg-muted text-destructive flex aspect-square items-center justify-center p-3 text-center text-xs'>
                        {img.error || t('无图片')}
                      </div>
                    )}
                    {img.url ? (
                      <button
                        type='button'
                        className='bg-background/90 absolute top-1.5 right-1.5 z-10 rounded-full border p-1 opacity-90 shadow-sm transition hover:opacity-100'
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          downloadFromB64(
                            img.b64 || img.url,
                            `drawing-${img.id}.png`
                          )
                        }}
                        title={t('下载')}
                        aria-label={t('下载')}
                      >
                        <Download className='size-3.5' />
                      </button>
                    ) : null}
                  </div>
                  <div className='space-y-0.5 p-2 text-[11px] leading-4'>
                    <div className='text-muted-foreground truncate'>
                      {img.model} · {img.size} ·{' '}
                      {img.mode === 'edit' ? t('编辑') : t('生成')}
                    </div>
                    {img.revisedPrompt && (
                      <div className='line-clamp-2'>{img.revisedPrompt}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className='border-border bg-card space-y-3 rounded-xl border p-4 shadow-sm'>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <div className='flex items-center gap-2'>
            <History className='text-primary size-4' />
            <h2 className='text-sm font-semibold'>{t('本机生成历史')}</h2>
            <span className='text-muted-foreground text-xs'>
              {history.length} {t('条')}
            </span>
          </div>
          <Button
            type='button'
            variant='outline'
            size='sm'
            disabled={history.length === 0}
            onClick={handleClearHistory}
            className='gap-1.5'
          >
            <Trash2 className='size-3.5' />
            {t('清空历史')}
          </Button>
        </div>
        <p className='text-muted-foreground text-xs leading-5'>
          {t(
            '历史仅保存在当前浏览器本地（不上传服务器）。换设备或清站点数据会丢失；可随时单条删除或全部清空。'
          )}
        </p>

        {history.length === 0 ? (
          <div className='text-muted-foreground flex min-h-[120px] flex-col items-center justify-center gap-1 text-center text-sm'>
            <p>{t('暂无历史记录。生成成功后会自动写入本机。')}</p>
          </div>
        ) : (
          <div className='grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4'>
            {history.map((item) => {
              const src = b64ToDisplaySrc(item.b64)
              return (
                <div
                  key={item.id}
                  className='group relative overflow-hidden rounded-lg border'
                >
                  {src ? (
                    <button
                      type='button'
                      className='block w-full text-left'
                      onClick={() => handleRestoreHistory(item)}
                      title={t('点此恢复到上方结果区')}
                    >
                      <img
                        src={src}
                        alt={item.revisedPrompt || item.prompt || item.model}
                        className='bg-muted aspect-square w-full object-cover'
                      />
                    </button>
                  ) : (
                    <div className='bg-muted text-muted-foreground flex aspect-square items-center justify-center p-2 text-center text-xs'>
                      {t('图片过大已省略预览')}
                    </div>
                  )}
                  <div className='absolute top-1.5 right-1.5 z-10 flex items-center gap-1'>
                    {src ? (
                      <button
                        type='button'
                        className='bg-background/90 rounded-full border p-1 opacity-80 shadow-sm transition hover:opacity-100'
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          downloadFromB64(item.b64, `drawing-history-${item.id}.png`)
                        }}
                        title={t('下载')}
                        aria-label={t('下载')}
                      >
                        <Download className='size-3.5' />
                      </button>
                    ) : null}
                    <button
                      type='button'
                      className='bg-background/90 rounded-full border p-1 opacity-80 shadow-sm transition hover:opacity-100'
                      onClick={() => handleRemoveHistory(item.id)}
                      title={t('删除此条')}
                    >
                      <X className='size-3.5' />
                    </button>
                  </div>
                  <div className='space-y-0.5 p-2 text-[11px] leading-4'>
                    <div className='text-muted-foreground truncate'>
                      {item.model}
                      {item.group ? ` · ${item.group}` : ''} · {item.size}
                    </div>
                    {(item.prompt || item.revisedPrompt) && (
                      <div className='line-clamp-2'>
                        {item.prompt || item.revisedPrompt}
                      </div>
                    )}
                    <div className='text-muted-foreground'>
                      {new Date(item.createdAt).toLocaleString()}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default DrawingPage
