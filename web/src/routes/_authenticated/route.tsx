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
import { createFileRoute, redirect } from '@tanstack/react-router'

import { AuthenticatedLayout } from '@/components/layout'
import { useAuthStore } from '@/stores/auth-store'

const LOTTERY_GUEST_ALLOWED_PREFIXES = ['/lottery', '/wallet', '/announcements']

function isLotteryGuestAllowedPath(pathname: string): boolean {
  const path = pathname.split('?')[0] || '/'
  return LOTTERY_GUEST_ALLOWED_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(prefix + '/')
  )
}

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: ({ location }) => {
    const { auth } = useAuthStore.getState()

    if (!auth.user || !auth.accessToken) {
      throw redirect({
        to: '/sign-in',
        search: { redirect: location.href },
      })
    }

    // Public lottery demo account: only wallet + lottery (+ announcements for the notice).
    if (auth.user.is_lottery_guest || auth.user.username === 'lottery_guest') {
      if (!isLotteryGuestAllowedPath(location.pathname)) {
        throw redirect({ to: '/lottery' })
      }
    }
  },
  component: AuthenticatedLayout,
})
