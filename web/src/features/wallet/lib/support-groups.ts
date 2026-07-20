/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import {
  REDEMPTION_SHOP_URL,
  SUPPORT_QQ_GROUP as DEFAULT_SUPPORT_QQ_GROUP,
} from '../constants'

export type SupportGroups = {
  shopUrl: string
  qqGroup: string
  qqGroupUrl: string
  wechatQrCode: string
  douyinQrCode: string
}

function asTrimmedString(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim()
}

function firstString(
  source: Record<string, unknown> | null | undefined,
  keys: string[]
): string {
  if (!source) return ''
  for (const key of keys) {
    const value = asTrimmedString(source[key])
    if (value) return value
  }
  return ''
}

/**
 * Build a clickable join URL for a QQ group setting value.
 *
 * - Full http(s) / mqq* URL: used as-is (admin may paste the official join link).
 * - Pure group number (digits): QQ client deep link. Do NOT use
 *   `https://qm.qq.com/q/<number>` — that path expects a short share key, not the
 *   group number, and returns 404 (e.g. qm.qq.com/q/949531417).
 * - Other non-empty text: treated as a qm.qq.com short share key.
 */
export function buildQqGroupUrl(qqGroup: string): string {
  const group = qqGroup.trim()
  if (!group) return ''
  if (/^https?:\/\//i.test(group)) return group
  if (/^(mqqapi|mqq|mqqopensdkapi|tencent):\/\//i.test(group)) return group
  // Numeric QQ group id → open group card in QQ client
  if (/^\d{5,12}$/.test(group)) {
    const uin = encodeURIComponent(group)
    return `mqqapi://card/show_pslcard?src_type=internal&version=1&uin=${uin}&card_type=group&source=qrcode`
  }
  // Official short join key from “一键加群”
  return `https://qm.qq.com/q/${encodeURIComponent(group)}`
}

/** Whether the join URL is a custom protocol (must not open in a new tab). */
export function isQqProtocolUrl(url: string): boolean {
  return /^(mqqapi|mqq|mqqopensdkapi|tencent):\/\//i.test(url.trim())
}

/**
 * Resolve support group settings from `/api/status` payload.
 * Empty values mean the corresponding UI entry should be hidden.
 * If the status payload does not yet include the new keys (stale cache /
 * pre-deploy), fall back to the historical default QQ group so the wallet
 * does not blank out during rollout.
 */
export function resolveSupportGroups(
  status: Record<string, unknown> | null | undefined
): SupportGroups {
  const hasQqKey =
    !!status &&
    ('support_qq_group' in status || 'SupportQQGroup' in status)
  const qqGroup = hasQqKey
    ? firstString(status, ['support_qq_group', 'SupportQQGroup'])
    : DEFAULT_SUPPORT_QQ_GROUP

  const wechatQrCode = firstString(status, [
    'support_wechat_group_qrcode',
    'SupportWeChatGroupQRCode',
  ])
  const douyinQrCode = firstString(status, [
    'support_douyin_group_qrcode',
    'SupportDouyinGroupQRCode',
  ])

  return {
    shopUrl: REDEMPTION_SHOP_URL,
    qqGroup,
    qqGroupUrl: buildQqGroupUrl(qqGroup),
    wechatQrCode,
    douyinQrCode,
  }
}

export function hasAnySupportGroup(groups: SupportGroups): boolean {
  return Boolean(groups.qqGroup || groups.wechatQrCode || groups.douyinQrCode)
}
