/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
/**
 * 「使用密钥」对话框 — 对齐 sub2api UseKeyModal：
 * 以配置文件为主（Codex / Claude Code / Grok CLI / OpenCode），
 * 不再默认堆一堆 shell export。
 */
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
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

/** Client tabs aligned with sub2api (config-file first). */
type ClientTab = 'codex' | 'claude' | 'grok' | 'opencode' | 'gemini'
type OsTab = 'unix' | 'windows'
type CodexAuthMode = 'legacy' | 'api-key'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  tokenKey: string
  /** Optional group name used only for soft hints */
  groupName?: string
}

interface FileBlock {
  path: string
  content: string
  hint?: string
}

function ensureV1(base: string): string {
  const trimmed = base.replace(/\/+$/, '')
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`
}

function stripV1(base: string): string {
  return base.replace(/\/+$/, '').replace(/\/v1$/i, '')
}

function codexDir(os: OsTab): string {
  return os === 'windows' ? '%userprofile%\\.codex' : '~/.codex'
}

function grokDir(os: OsTab): string {
  return os === 'windows' ? '%userprofile%\\.grok' : '~/.grok'
}

function claudeSettingsPath(os: OsTab): string {
  return os === 'windows'
    ? '%USERPROFILE%\\.claude\\settings.json'
    : '~/.claude/settings.json'
}

function opencodePath(os: OsTab): string {
  return os === 'windows'
    ? '%USERPROFILE%\\.config\\opencode\\opencode.json'
    : '~/.config/opencode/opencode.json'
}

function buildCodexConfig(
  apiV1: string,
  authMode: CodexAuthMode,
  ws: boolean
): string {
  const authLine =
    authMode === 'api-key'
      ? `requires_openai_auth = false
http_headers = { "x-openai-actor-authorization" = "local-image-extension" }`
      : 'requires_openai_auth = true'

  const wsLines = ws
    ? `supports_websockets = true
`
    : ''
  const features = ws
    ? `[features]
responses_websockets_v2 = true
goals = true`
    : `[features]
goals = true`

  return `model_provider = "OpenAI"
model = "gpt-5.5"
review_model = "gpt-5.5"
model_reasoning_effort = "xhigh"
disable_response_storage = true
network_access = "enabled"
windows_wsl_setup_acknowledged = true

[model_providers.OpenAI]
name = "OpenAI"
base_url = "${apiV1}"
wire_api = "responses"
${wsLines}${authLine}

${features}`
}

function buildGrokConfig(apiV1: string, key: string): string {
  return `[models]
default = "grok"
web_search = "grok"

[model."grok"]
model = "grok-4.5"
base_url = "${apiV1}"
name = "Grok 4.5"
api_key = "${key}"
api_backend = "responses"
context_window = 1000000
supports_backend_search = true`
}

function buildClaudeSettings(baseRoot: string, key: string): string {
  return JSON.stringify(
    {
      $schema: 'https://json.schemastore.org/claude-code-settings.json',
      env: {
        ANTHROPIC_BASE_URL: baseRoot,
        ANTHROPIC_AUTH_TOKEN: key,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        CLAUDE_CODE_ATTRIBUTION_HEADER: '0',
      },
    },
    null,
    2
  )
}

function buildOpenCodeConfig(apiV1: string, key: string): string {
  const openaiModels: Record<string, unknown> = {}
  for (const [id, name, ctx] of [
    ['gpt-5.4', 'GPT-5.4', 1_050_000],
    ['gpt-5.5', 'GPT-5.5', 1_050_000],
    ['gpt-5.6-sol', 'GPT-5.6 Sol', 1_050_000],
    ['gpt-5.6-luna', 'GPT-5.6 Luna', 1_050_000],
  ] as const) {
    openaiModels[id] = {
      name,
      limit: { context: ctx, output: 128000 },
      options: { store: false },
      variants: { low: {}, medium: {}, high: {}, xhigh: {} },
    }
  }

  const grokModels: Record<string, unknown> = {
    'grok-4.5': {
      name: 'Grok 4.5',
      limit: { context: 1_000_000, output: 128000 },
    },
    'grok-build-0.1': {
      name: 'Grok Build 0.1',
      limit: { context: 256000, output: 64000 },
    },
    'grok-composer-2.5-fast': {
      name: 'Grok Composer 2.5 Fast',
      limit: { context: 256000, output: 64000 },
    },
  }

  return JSON.stringify(
    {
      provider: {
        openai: {
          npm: '@ai-sdk/openai',
          options: { baseURL: apiV1, apiKey: key },
          models: openaiModels,
        },
        grok: {
          npm: '@ai-sdk/openai',
          options: { baseURL: apiV1, apiKey: key },
          models: grokModels,
        },
        anthropic: {
          npm: '@ai-sdk/anthropic',
          options: {
            baseURL: stripV1(apiV1),
            apiKey: key,
          },
        },
      },
    },
    null,
    2
  )
}

export function UseKeyDialog(props: Props) {
  const { t } = useTranslation()
  const [client, setClient] = useState<ClientTab>('codex')
  const [os, setOs] = useState<OsTab>('unix')
  const [codexAuthMode, setCodexAuthMode] = useState<CodexAuthMode>('legacy')
  const [codexWs, setCodexWs] = useState(false)
  const [copied, setCopied] = useState(false)

  const baseRoot = stripV1(getServerAddress())
  const apiV1 = ensureV1(baseRoot)
  const key = props.tokenKey.startsWith('sk-')
    ? props.tokenKey
    : `sk-${props.tokenKey}`

  const clientTabs: Array<{ id: ClientTab; label: string }> = [
    { id: 'codex', label: 'Codex CLI' },
    { id: 'claude', label: 'Claude Code' },
    { id: 'grok', label: 'Grok CLI' },
    { id: 'opencode', label: 'OpenCode' },
    { id: 'gemini', label: 'Gemini CLI' },
  ]

  const files = useMemo((): FileBlock[] => {
    if (client === 'codex') {
      const dir = codexDir(os)
      return [
        {
          path: `${dir}/config.toml`,
          content: buildCodexConfig(apiV1, codexAuthMode, codexWs),
          hint: t(
            '请把内容写到 config.toml 文件开头。已有配置请先备份再合并。保存后重启 Codex CLI。'
          ),
        },
        {
          path: `${dir}/auth.json`,
          content: JSON.stringify({ OPENAI_API_KEY: key }, null, 2),
          hint: t('密钥写在 auth.json，不要把 sk- 写进 shell 历史。'),
        },
      ]
    }

    if (client === 'claude') {
      return [
        {
          path: claudeSettingsPath(os),
          content: buildClaudeSettings(baseRoot, key),
          hint: t(
            '推荐：写入 Claude Code 用户级 settings.json 后重启 CLI。路径不存在请先创建目录。'
          ),
        },
      ]
    }

    if (client === 'grok') {
      return [
        {
          path: `${grokDir(os)}/config.toml`,
          content: buildGrokConfig(apiV1, key),
          hint: t(
            '如已有 config.toml 请先备份再合并。保存后运行 grok inspect 验证生效配置。'
          ),
        },
      ]
    }

    if (client === 'opencode') {
      return [
        {
          path: opencodePath(os),
          content: buildOpenCodeConfig(apiV1, key),
          hint: t(
            '配置路径：~/.config/opencode/opencode.json（或 opencode.jsonc）。示例含 openai / grok / anthropic，可按需删改模型列表。'
          ),
        },
      ]
    }

    // gemini — env is still the primary official path
    const geminiBase = baseRoot.endsWith('/v1beta')
      ? baseRoot
      : `${baseRoot}/v1beta`
    const geminiEnv =
      os === 'windows'
        ? `$env:GOOGLE_GEMINI_BASE_URL="${geminiBase}"
$env:GEMINI_API_KEY="${key}"
$env:GEMINI_MODEL="gemini-2.0-flash"`
        : `export GOOGLE_GEMINI_BASE_URL="${geminiBase}"
export GEMINI_API_KEY="${key}"
export GEMINI_MODEL="gemini-2.0-flash"`
    return [
      {
        path: os === 'windows' ? 'PowerShell' : 'Terminal',
        content: geminiEnv,
        hint: t('Gemini CLI 当前以环境变量配置为主。'),
      },
    ]
  }, [apiV1, baseRoot, client, codexAuthMode, codexWs, key, os, t])

  const description = useMemo(() => {
    switch (client) {
      case 'codex':
        return t(
          '把下面两段写入本机 Codex 配置目录（config.toml + auth.json），重启 Codex CLI 即可。'
        )
      case 'claude':
        return t(
          '把 settings.json 写入 Claude Code 用户配置目录后重启。一般无需再 export 环境变量。'
        )
      case 'grok':
        return t(
          '把 config.toml 写入 Grok CLI 配置目录（~/.grok），保存后可用 grok inspect 验证。'
        )
      case 'opencode':
        return t(
          '把 opencode.json 写入 OpenCode 配置目录。可按需保留 openai / grok / anthropic 中的部分 provider。'
        )
      default:
        return t('按下方说明配置 Gemini CLI。')
    }
  }, [client, t])

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
        {description}
        {props.groupName ? (
          <span className='text-foreground'>
            {' '}
            · {t('分组')}: {props.groupName}
          </span>
        ) : null}
      </p>

      <div className='space-y-2'>
        <Label>{t('客户端')}</Label>
        <div className='flex flex-wrap gap-2'>
          {clientTabs.map((tab) => (
            <Button
              key={tab.id}
              type='button'
              size='sm'
              variant={client === tab.id ? 'default' : 'outline'}
              onClick={() => setClient(tab.id)}
            >
              {tab.label}
            </Button>
          ))}
        </div>
      </div>

      {client !== 'opencode' && (
        <div className='space-y-2'>
          <Label>{t('系统')}</Label>
          <div className='flex flex-wrap gap-2'>
            {(
              [
                ['unix', 'macOS / Linux'],
                ['windows', 'Windows'],
              ] as const
            ).map(([id, label]) => (
              <Button
                key={id}
                type='button'
                size='sm'
                variant={os === id ? 'default' : 'outline'}
                onClick={() => setOs(id)}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {client === 'codex' && (
        <div className='space-y-3 rounded-lg border p-3'>
          <div>
            <p className='text-sm font-medium'>{t('Codex 鉴权方式')}</p>
            <p className='text-muted-foreground mt-0.5 text-xs'>
              {t(
                '默认 legacy（requires_openai_auth + auth.json）。部分环境可用 api-key 模式。'
              )}
            </p>
          </div>
          <div className='grid grid-cols-2 gap-1 rounded-lg bg-muted p-1'>
            {(
              [
                ['legacy', t('auth.json（推荐）')],
                ['api-key', t('API Key 模式')],
              ] as const
            ).map(([id, label]) => (
              <Button
                key={id}
                type='button'
                size='sm'
                variant={codexAuthMode === id ? 'default' : 'ghost'}
                className='h-9'
                onClick={() => setCodexAuthMode(id)}
              >
                {label}
              </Button>
            ))}
          </div>
          <label className='flex cursor-pointer items-center gap-2 text-sm'>
            <input
              type='checkbox'
              className='accent-primary size-4'
              checked={codexWs}
              onChange={(e) => setCodexWs(e.target.checked)}
            />
            {t('启用 WebSocket v2（responses_websockets_v2）')}
          </label>
        </div>
      )}

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

      <div className='rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200'>
        {t(
          '接口地址默认使用本站。改完配置文件后请重启对应 CLI。密钥请勿提交到公开仓库。'
        )}{' '}
        <span className='font-mono text-xs'>{apiV1}</span>
      </div>
    </Dialog>
  )
}
