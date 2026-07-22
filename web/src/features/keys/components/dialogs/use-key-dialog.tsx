/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { copyToClipboard } from '@/lib/copy-to-clipboard'
import { cn } from '@/lib/utils'

function getServerAddress(): string {
  try {
    const raw = localStorage.getItem('status')
    if (raw) {
      const status = JSON.parse(raw)
      if (status.server_address) return status.server_address as string
    }
  } catch {
    /* empty */
  }
  return window.location.origin
}

type ClientTab = 'openai' | 'codex' | 'claude' | 'gemini'
type ShellTab = 'unix' | 'cmd' | 'powershell'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  tokenKey: string
  /** Optional group name used only for soft hints */
  groupName?: string
}

function ensureV1(base: string): string {
  const trimmed = base.replace(/\/+$/, '')
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`
}

export function UseKeyDialog(props: Props) {
  const { t } = useTranslation()
  const [client, setClient] = useState<ClientTab>('openai')
  const [shell, setShell] = useState<ShellTab>('unix')
  const [copied, setCopied] = useState(false)

  const baseUrl = getServerAddress().replace(/\/+$/, '')
  const apiV1 = ensureV1(baseUrl)
  const key = props.tokenKey.startsWith('sk-')
    ? props.tokenKey
    : `sk-${props.tokenKey}`

  const files = useMemo(() => {
    const blocks: Array<{ path: string; content: string; hint?: string }> = []

    if (client === 'openai') {
      if (shell === 'unix') {
        blocks.push({
          path: '终端（macOS / Linux）',
          content: `export OPENAI_BASE_URL="${apiV1}"
export OPENAI_API_KEY="${key}"`,
        })
      } else if (shell === 'cmd') {
        blocks.push({
          path: '命令提示符',
          content: `set OPENAI_BASE_URL=${apiV1}
set OPENAI_API_KEY=${key}`,
        })
      } else {
        blocks.push({
          path: 'PowerShell',
          content: `$env:OPENAI_BASE_URL="${apiV1}"
$env:OPENAI_API_KEY="${key}"`,
        })
      }
      blocks.push({
        path: 'curl 连通性测试',
        content: `curl ${apiV1}/models -H "Authorization: Bearer ${key}"`,
      })
    } else if (client === 'codex') {
      if (shell === 'unix') {
        blocks.push({
          path: '~/.codex/config.toml（节选）',
          content: `model_provider = "openai"
model = "gpt-5.4"

[model_providers.openai]
name = "OpenAI"
base_url = "${apiV1}"
env_key = "OPENAI_API_KEY"`,
          hint: t('请在终端设置 OPENAI_API_KEY 为本密钥，然后重启 Codex CLI。'),
        })
        blocks.push({
          path: '终端',
          content: `export OPENAI_API_KEY="${key}"
export OPENAI_BASE_URL="${apiV1}"`,
        })
      } else if (shell === 'cmd') {
        blocks.push({
          path: '命令提示符',
          content: `set OPENAI_API_KEY=${key}
set OPENAI_BASE_URL=${apiV1}`,
        })
      } else {
        blocks.push({
          path: 'PowerShell',
          content: `$env:OPENAI_API_KEY="${key}"
$env:OPENAI_BASE_URL="${apiV1}"`,
        })
      }
    } else if (client === 'claude') {
      if (shell === 'unix') {
        blocks.push({
          path: '终端',
          content: `export ANTHROPIC_BASE_URL="${baseUrl}"
export ANTHROPIC_AUTH_TOKEN="${key}"
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
export CLAUDE_CODE_ATTRIBUTION_HEADER=0`,
        })
        blocks.push({
          path: '~/.claude/settings.json',
          content: `{
  "env": {
    "ANTHROPIC_BASE_URL": "${baseUrl}",
    "ANTHROPIC_AUTH_TOKEN": "${key}",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
    "CLAUDE_CODE_ATTRIBUTION_HEADER": "0"
  }
}`,
          hint: t('Claude Code 配置文件 — 写入后请重启 CLI。'),
        })
      } else if (shell === 'cmd') {
        blocks.push({
          path: '命令提示符',
          content: `set ANTHROPIC_BASE_URL=${baseUrl}
set ANTHROPIC_AUTH_TOKEN=${key}
set CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
set CLAUDE_CODE_ATTRIBUTION_HEADER=0`,
        })
      } else {
        blocks.push({
          path: 'PowerShell',
          content: `$env:ANTHROPIC_BASE_URL="${baseUrl}"
$env:ANTHROPIC_AUTH_TOKEN="${key}"
$env:CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
$env:CLAUDE_CODE_ATTRIBUTION_HEADER=0`,
        })
      }
    } else {
      // gemini
      const geminiBase = baseUrl.endsWith('/v1beta')
        ? baseUrl
        : `${baseUrl}/v1beta`
      if (shell === 'unix') {
        blocks.push({
          path: '终端',
          content: `export GOOGLE_GEMINI_BASE_URL="${geminiBase}"
export GEMINI_API_KEY="${key}"`,
        })
      } else if (shell === 'cmd') {
        blocks.push({
          path: '命令提示符',
          content: `set GOOGLE_GEMINI_BASE_URL=${geminiBase}
set GEMINI_API_KEY=${key}`,
        })
      } else {
        blocks.push({
          path: 'PowerShell',
          content: `$env:GOOGLE_GEMINI_BASE_URL="${geminiBase}"
$env:GEMINI_API_KEY="${key}"`,
        })
      }
    }

    return blocks
  }, [apiV1, baseUrl, client, key, shell, t])

  const handleCopy = async (content: string) => {
    const ok = await copyToClipboard(content)
    if (ok) {
      setCopied(true)
      toast.success(t('已复制'))
      window.setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('使用密钥')}
      contentClassName='sm:max-w-2xl'
      contentHeight='auto'
      bodyClassName='space-y-4'
      footer={
        <Button variant='outline' onClick={() => props.onOpenChange(false)}>
          {t('关闭')}
        </Button>
      }
    >
      <p className='text-muted-foreground text-sm'>
        {t(
          '复制可直接粘贴的环境变量 / 配置片段，适配常见 CLI 客户端。接口地址默认使用本站。'
        )}
        {props.groupName ? (
          <span className='text-foreground'>
            {' '}
            · {t('分组')}: {props.groupName}
          </span>
        ) : null}
      </p>

      <div className='space-y-2'>
        <Label>{t('客户端')}</Label>
        <RadioGroup
          value={client}
          onValueChange={(v) => setClient(v as ClientTab)}
          className='flex flex-wrap gap-3'
        >
          {(
            [
              ['openai', 'OpenAI SDK'],
              ['codex', 'Codex CLI'],
              ['claude', 'Claude Code'],
              ['gemini', 'Gemini CLI'],
            ] as const
          ).map(([id, label]) => (
            <div key={id} className='flex items-center gap-2'>
              <RadioGroupItem value={id} id={`use-key-${id}`} />
              <Label htmlFor={`use-key-${id}`} className='cursor-pointer'>
                {label}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </div>

      <div className='space-y-2'>
        <Label>{t('终端类型')}</Label>
        <div className='flex flex-wrap gap-2'>
          {(
            [
              ['unix', 'macOS / Linux'],
              ['cmd', 'Windows CMD'],
              ['powershell', 'PowerShell'],
            ] as const
          ).map(([id, label]) => (
            <Button
              key={id}
              type='button'
              size='sm'
              variant={shell === id ? 'default' : 'outline'}
              onClick={() => setShell(id)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      <div className='space-y-3'>
        {files.map((file) => (
          <div
            key={file.path}
            className='overflow-hidden rounded-lg border bg-zinc-950 text-zinc-100'
          >
            <div className='flex items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-900 px-3 py-2'>
              <span className='truncate font-mono text-xs text-zinc-400'>
                {file.path}
              </span>
              <Button
                type='button'
                size='sm'
                variant='secondary'
                className={cn(
                  'h-7 shrink-0 text-xs',
                  copied && 'bg-emerald-600 text-white'
                )}
                onClick={() => handleCopy(file.content)}
              >
                {t('复制')}
              </Button>
            </div>
            {file.hint ? (
              <p className='border-b border-zinc-800 px-3 py-1.5 text-xs text-amber-300/90'>
                {file.hint}
              </p>
            ) : null}
            <pre className='overflow-x-auto p-3 font-mono text-xs leading-5 whitespace-pre-wrap'>
              {file.content}
            </pre>
          </div>
        ))}
      </div>
    </Dialog>
  )
}
