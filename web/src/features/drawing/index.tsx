/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import {
  History,
  ImageIcon,
  Loader2,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
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
  generateViaImagesApi,
  generateViaResponsesTool,
  getUserGroups,
  getUserModels,
} from './api'
import {
  appendDrawingHistory,
  clearDrawingHistory,
  historyItemToGenerated,
  loadDrawingHistory,
  removeDrawingHistoryItem,
  type DrawingHistoryItem,
} from './history'
import {
  DEFAULT_IMAGE_MODEL,
  RESPONSE_BASE_MODELS,
  SIZE_OPTIONS,
  type DrawMode,
  type GeneratedImage,
  type GroupOption,
  type ImageSizeTier,
} from './types'

export function DrawingPage() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<DrawMode>('images')
  const [prompt, setPrompt] = useState(
    '可爱的橙色猫咪宇航员贴纸，正面朝向，圆润萌系，穿白色宇航服带淡彩点缀，小头盔透明面罩，小爪子露出来，大眼睛，干净粉彩背景留白，贴纸风格清晰描边，柔和阴影，高清，居中构图'
  )
  const [size, setSize] = useState<ImageSizeTier>('1K')
  const [chatModel, setChatModel] = useState<string>(RESPONSE_BASE_MODELS[0])
  const [group, setGroup] = useState('')
  const [groups, setGroups] = useState<GroupOption[]>([])
  const [availableChatModels, setAvailableChatModels] = useState<string[]>([
    ...RESPONSE_BASE_MODELS,
  ])
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<GeneratedImage[]>([])
  const [history, setHistory] = useState<DrawingHistoryItem[]>([])

  useEffect(() => {
    setHistory(loadDrawingHistory())
  }, [])

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

  useEffect(() => {
    if (!group) return
    void (async () => {
      try {
        const models = await getUserModels(group)
        const allowed = RESPONSE_BASE_MODELS.filter((m) =>
          models.some(
            (x) =>
              x === m ||
              x.startsWith(m) ||
              x.toLowerCase().includes(m.toLowerCase())
          )
        )
        if (allowed.length > 0) {
          setAvailableChatModels(allowed)
          if (!allowed.includes(chatModel)) setChatModel(allowed[0])
        } else {
          // Keep defaults if API list does not surface exact names
          setAvailableChatModels([...RESPONSE_BASE_MODELS])
        }
      } catch {
        /* empty */
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-fetch when group changes
  }, [group])

  const sizeNote = useMemo(
    () => SIZE_OPTIONS.find((s) => s.value === size)?.note ?? '',
    [size]
  )

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
    setLoading(true)
    const id = `${Date.now()}`
    try {
      if (mode === 'images') {
        const res = await generateViaImagesApi({
          model: DEFAULT_IMAGE_MODEL,
          prompt: text,
          size,
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
              size,
              createdAt: Date.now(),
              error: res.error?.message,
            },
            ...prev,
          ])
          return
        }
        const imgs = (res.data || []).map((item, idx) => {
          const b64 = item.b64_json
          const url = item.url
            ? item.url
            : b64
              ? `data:image/png;base64,${b64}`
              : ''
          return {
            id: `${id}-${idx}`,
            url,
            b64,
            revisedPrompt: item.revised_prompt,
            mode,
            model: DEFAULT_IMAGE_MODEL,
            size,
            createdAt: Date.now(),
          } satisfies GeneratedImage
        })
        if (imgs.length === 0) {
          toast.error(t('未返回图片'))
        } else {
          toast.success(t('生成成功'))
          setResults((prev) => [...imgs, ...prev])
          persistSuccess(imgs, text)
        }
      } else {
        const res = await generateViaResponsesTool({
          chatModel,
          prompt: text,
          size,
          group,
        })
        if (res.error) {
          toast.error(res.error)
          setResults((prev) => [
            {
              id,
              url: '',
              mode,
              model: chatModel,
              size,
              createdAt: Date.now(),
              error: res.error,
            },
            ...prev,
          ])
          return
        }
        const imgs = res.images.map((item, idx) => {
          const b64 = item.b64
          const url = item.url
            ? item.url
            : b64
              ? `data:image/png;base64,${b64}`
              : ''
          return {
            id: `${id}-${idx}`,
            url,
            b64,
            revisedPrompt: item.revisedPrompt,
            mode,
            model: `${chatModel} + gpt-image-2`,
            size,
            createdAt: Date.now(),
          } satisfies GeneratedImage
        })
        if (imgs.length === 0) {
          toast.error(t('未返回图片'))
        } else {
          toast.success(t('生成成功'))
          setResults((prev) => [...imgs, ...prev])
          persistSuccess(imgs, text)
        }
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
  }, [prompt, mode, size, group, chatModel, t, persistSuccess])

  const handleClearSession = useCallback(() => {
    setResults([])
  }, [])

  const handleClearHistory = useCallback(() => {
    setHistory(clearDrawingHistory())
    toast.success(t('已清空本机历史'))
  }, [t])

  const handleRemoveHistory = useCallback((id: string) => {
    setHistory(removeDrawingHistoryItem(id))
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
    <div className='mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 md:p-6'>
      <div className='flex flex-col gap-1'>
        <h1 className='flex items-center gap-2 text-xl font-semibold tracking-tight md:text-2xl'>
          <ImageIcon className='text-primary size-6' />
          {t('画图')}
        </h1>
        <p className='text-muted-foreground max-w-3xl text-sm leading-6'>
          {t(
            '使用 GPT Image 2 生成图片。可选「图像接口」或「对话 + 画图工具」。1K/2K 约 $0.04/张，4K 约 $0.08/张（按分组倍率 0.04 计）。对话模式会额外按上游计收基础对话模型的 token 与画图工具附加费。'
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
                variant={mode === 'images' ? 'default' : 'outline'}
                className='h-auto flex-col items-start gap-0.5 py-2.5 text-left'
                onClick={() => setMode('images')}
              >
                <span className='font-medium'>{t('图像接口')}</span>
                <span className='text-xs font-normal opacity-80'>
                  /pg/images/generations
                </span>
              </Button>
              <Button
                type='button'
                variant={mode === 'responses' ? 'default' : 'outline'}
                className='h-auto flex-col items-start gap-0.5 py-2.5 text-left'
                onClick={() => setMode('responses')}
              >
                <span className='font-medium'>{t('对话 + 画图工具')}</span>
                <span className='text-xs font-normal opacity-80'>
                  /pg/responses · image_generation
                </span>
              </Button>
            </div>
          </div>

          {mode === 'responses' && (
            <div className='space-y-2'>
              <Label>{t('基础对话模型')}</Label>
              <Select
                value={chatModel}
                onValueChange={(v) => v && setChatModel(String(v))}
              >
                <SelectTrigger className='w-full'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectGroup>
                    {availableChatModels.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <p className='text-muted-foreground text-xs'>
                {t(
                  '在该 Codex 对话模型上调用 image_generation 工具生成图片（与 sub2api 测流通路一致）。'
                )}
              </p>
            </div>
          )}

          {mode === 'images' && (
            <div className='space-y-1 rounded-lg border border-dashed px-3 py-2 text-sm'>
              <div className='font-medium'>{DEFAULT_IMAGE_MODEL}</div>
              <p className='text-muted-foreground text-xs'>
                {t('广场固定价模型，按尺寸倍率计费。')}
              </p>
            </div>
          )}

          <div className='grid gap-3 sm:grid-cols-2'>
            <div className='space-y-2'>
              <Label>{t('尺寸')}</Label>
              <Select
                value={size}
                onValueChange={(v) => v && setSize(String(v) as ImageSizeTier)}
              >
                <SelectTrigger className='w-full'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectGroup>
                    {SIZE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label} · {opt.dimension}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <p className='text-muted-foreground text-xs'>{sizeNote}</p>
            </div>

            <div className='space-y-2'>
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
              placeholder={t('描述你想生成的图片…')}
            />
          </div>

          <div className='flex flex-wrap gap-2'>
            <Button onClick={handleGenerate} disabled={loading} className='gap-2'>
              {loading ? (
                <Loader2 className='size-4 animate-spin' />
              ) : (
                <Sparkles className='size-4' />
              )}
              {loading ? t('生成中…') : t('生成')}
            </Button>
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
            <h2 className='text-sm font-semibold'>{t('生成结果')}</h2>
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
                  <div className='space-y-0.5 p-2 text-[11px] leading-4'>
                    <div className='text-muted-foreground truncate'>
                      {img.model} · {img.size} · {img.mode}
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
              const src =
                item.url ||
                (item.b64
                  ? item.b64.startsWith('data:')
                    ? item.b64
                    : `data:image/png;base64,${item.b64}`
                  : '')
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
                  <button
                    type='button'
                    className='bg-background/90 absolute top-1.5 right-1.5 rounded-full border p-1 opacity-80 shadow-sm transition hover:opacity-100'
                    onClick={() => handleRemoveHistory(item.id)}
                    title={t('删除此条')}
                  >
                    <X className='size-3.5' />
                  </button>
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
