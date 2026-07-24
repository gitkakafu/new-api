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
import type { AuthUser } from '@/stores/auth-store'

const allowedRedirectProtocols = new Set(['http:', 'https:'])

export function getSavedLanguage(user: AuthUser): string | undefined {
  if (typeof user.language === 'string') {
    return user.language
  }

  if (user.setting && typeof user.setting === 'object') {
    return typeof user.setting.language === 'string'
      ? user.setting.language
      : undefined
  }

  if (typeof user.setting !== 'string') {
    return undefined
  }

  try {
    const setting = JSON.parse(user.setting) as { language?: unknown }
    return typeof setting.language === 'string' ? setting.language : undefined
  } catch {
    return undefined
  }
}

export function sanitizeAuthRedirect(
  value: unknown,
  origin: string
): string | null {
  if (typeof value !== 'string') return null

  const target = value.trim()
  if (!target || target.includes('\\') || target.startsWith('//')) return null

  let trustedOrigin: URL
  try {
    trustedOrigin = new URL(origin)
  } catch {
    return null
  }
  if (!allowedRedirectProtocols.has(trustedOrigin.protocol)) return null

  let redirectURL: URL
  try {
    redirectURL = target.startsWith('/')
      ? new URL(target, trustedOrigin.origin)
      : new URL(target)
  } catch {
    return null
  }

  if (
    !allowedRedirectProtocols.has(redirectURL.protocol) ||
    redirectURL.origin !== trustedOrigin.origin
  ) {
    return null
  }

  return `${redirectURL.pathname}${redirectURL.search}${redirectURL.hash}`
}


/** Default landing path after login. Lottery guest goes to the draw page. */
export function getPostLoginPath(user: AuthUser | null | undefined): string {
  if (user?.is_lottery_guest || user?.username === 'lottery_guest') {
    return '/lottery'
  }
  return '/dashboard'
}

/** Clamp a sanitized redirect so lottery guests cannot land on forbidden routes. */
export function resolveAuthRedirect(
  user: AuthUser | null | undefined,
  redirect: unknown,
  origin: string
): string {
  const fallback = getPostLoginPath(user)
  const sanitized = sanitizeAuthRedirect(redirect, origin)
  if (!sanitized) return fallback
  if (user?.is_lottery_guest || user?.username === 'lottery_guest') {
    const path = sanitized.split('?')[0] || '/'
    const allowed = ['/lottery', '/wallet', '/announcements']
    if (!allowed.some((p) => path === p || path.startsWith(p + '/'))) {
      return fallback
    }
  }
  return sanitized
}
