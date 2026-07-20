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
import { ExternalLink, ShoppingCart, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { buttonVariants } from '@/components/ui/button'
import { IconBadge } from '@/components/ui/icon-badge'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

import {
  hasAnySupportGroup,
  isQqProtocolUrl,
  type SupportGroups,
} from '../lib/support-groups'

type SupportGroupsPanelProps = {
  groups: SupportGroups
  /** compact = wallet row; card = about page */
  variant?: 'compact' | 'card'
  className?: string
  showShop?: boolean
  showDescription?: boolean
}

function QrTile({
  label,
  src,
}: {
  label: string
  src: string
}) {
  return (
    <div className='flex flex-col items-center gap-2 rounded-lg border bg-background/60 p-3'>
      <div className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
        {label}
      </div>
      <img
        src={src}
        alt={label}
        className='h-28 w-28 rounded-md border bg-white object-contain sm:h-32 sm:w-32'
      />
    </div>
  )
}

export function SupportGroupsPanel({
  groups,
  variant = 'compact',
  className,
  showShop = true,
  showDescription = true,
}: SupportGroupsPanelProps) {
  const { t } = useTranslation()
  const hasGroups = hasAnySupportGroup(groups)
  const hasQr = Boolean(groups.wechatQrCode || groups.douyinQrCode)
  const qqIsProtocol = isQqProtocolUrl(groups.qqGroupUrl)
  // Custom protocols (mqqapi://) must open in the same browsing context so the
  // OS can hand off to the QQ client; target=_blank often fails to launch apps.
  const qqLinkProps = qqIsProtocol
    ? ({ rel: 'noopener noreferrer' } as const)
    : ({ target: '_blank' as const, rel: 'noopener noreferrer' } as const)

  if (!showShop && !hasGroups) {
    return null
  }

  const actionButtons = (
    <div className='flex flex-col gap-2 sm:flex-row sm:items-center'>
      {showShop ? (
        <a
          href={groups.shopUrl}
          target='_blank'
          rel='noopener noreferrer'
          className={cn(
            buttonVariants({ variant: 'default', size: 'lg' }),
            'h-10 gap-2 sm:flex-1'
          )}
        >
          <ShoppingCart className='h-4 w-4' />
          {t('Buy redemption code')}
          <ExternalLink className='h-3.5 w-3.5 opacity-80' />
        </a>
      ) : null}
      {groups.qqGroup && groups.qqGroupUrl ? (
        <a
          href={groups.qqGroupUrl}
          {...qqLinkProps}
          className={cn(
            buttonVariants({ variant: 'outline', size: 'lg' }),
            'h-10 gap-2 sm:flex-1'
          )}
        >
          <Users className='h-4 w-4' />
          {t('QQ Group')}: {groups.qqGroup}
        </a>
      ) : null}
    </div>
  )

  const qrGrid = hasQr ? (
    <div
      className={cn(
        'grid gap-3',
        groups.wechatQrCode && groups.douyinQrCode
          ? 'grid-cols-1 sm:grid-cols-2'
          : 'grid-cols-1 sm:max-w-xs'
      )}
    >
      {groups.wechatQrCode ? (
        <QrTile label={t('WeChat Group')} src={groups.wechatQrCode} />
      ) : null}
      {groups.douyinQrCode ? (
        <QrTile label={t('Douyin Group')} src={groups.douyinQrCode} />
      ) : null}
    </div>
  ) : null

  if (variant === 'card') {
    return (
      <div className={cn('space-y-4', className)}>
        {showShop ? (
          <div className='space-y-1.5'>
            <div className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
              {t('Recharge URL')}
            </div>
            <a
              href={groups.shopUrl}
              target='_blank'
              rel='noopener noreferrer'
              className='text-primary inline-flex max-w-full items-center gap-1.5 break-all text-sm font-medium underline-offset-4 hover:underline'
            >
              {groups.shopUrl}
              <ExternalLink className='h-3.5 w-3.5 shrink-0' />
            </a>
          </div>
        ) : null}

        {groups.qqGroup && groups.qqGroupUrl ? (
          <div className='space-y-1.5'>
            <div className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
              {t('QQ Group')}
            </div>
            <a
              href={groups.qqGroupUrl}
              {...qqLinkProps}
              className='text-primary inline-flex items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline'
            >
              {groups.qqGroup}
              <ExternalLink className='h-3.5 w-3.5 shrink-0' />
            </a>
          </div>
        ) : null}

        {qrGrid}

        <div className='flex flex-col gap-2 pt-1 sm:flex-row'>
          {showShop ? (
            <a
              href={groups.shopUrl}
              target='_blank'
              rel='noopener noreferrer'
              className={cn(
                buttonVariants({ variant: 'default', size: 'lg' }),
                'h-10 gap-2 sm:flex-1'
              )}
            >
              <ShoppingCart className='h-4 w-4' />
              {t('Buy redemption code')}
            </a>
          ) : null}
          {groups.qqGroup && groups.qqGroupUrl ? (
            <a
              href={groups.qqGroupUrl}
              {...qqLinkProps}
              className={cn(
                buttonVariants({ variant: 'outline', size: 'lg' }),
                'h-10 gap-2 sm:flex-1'
              )}
            >
              <Users className='h-4 w-4' />
              {t('Join QQ Group')}
            </a>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className={cn('space-y-2.5', className)}>
      <div className='flex items-center gap-2'>
        <IconBadge tone='success' size='xs'>
          <ShoppingCart />
        </IconBadge>
        <Label className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
          {hasGroups
            ? t('Purchase redemption code & groups')
            : t('Purchase redemption code')}
        </Label>
      </div>
      {actionButtons}
      {qrGrid}
      {showDescription ? (
        <p className='text-muted-foreground text-xs'>
          {hasGroups
            ? t(
                'Buy a code in the shop, then redeem it below. Contact support via community groups if needed.'
              )
            : t(
                'Buy a code in the shop, then redeem it below.'
              )}
        </p>
      ) : null}
    </div>
  )
}
