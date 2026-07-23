/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { Megaphone } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { AnnouncementDetailModal } from '@/features/dashboard/components/overview/announcement-detail-dialog'
import { useAnnouncements } from '@/features/dashboard/hooks/use-status-data'
import type { AnnouncementItem } from '@/features/dashboard/types'
import { getAnnouncementColorClass } from '@/lib/colors'
import { formatDateTimeObject } from '@/lib/time'
import { cn } from '@/lib/utils'

function AnnouncementStatusDot(props: { type?: string }) {
  return (
    <span
      className={cn(
        'mt-1.5 inline-block size-2 shrink-0 rounded-full',
        getAnnouncementColorClass(props.type)
      )}
    />
  )
}

export function AnnouncementsPage() {
  const { t } = useTranslation()
  const { items, loading } = useAnnouncements()
  const [selected, setSelected] = useState<AnnouncementItem | null>(null)
  const [open, setOpen] = useState(false)

  const sorted = useMemo(() => {
    return [...items].sort((a, b) => {
      const ta = a.publishDate ? new Date(a.publishDate).getTime() : 0
      const tb = b.publishDate ? new Date(b.publishDate).getTime() : 0
      return tb - ta
    })
  }, [items])

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Announcements')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2 text-base'>
              <Megaphone className='size-4' />
              {t('Announcements')}
            </CardTitle>
            <CardDescription>
              {t('Latest platform updates and notices')}
            </CardDescription>
          </CardHeader>
          <CardContent className='p-0'>
            {loading ? (
              <div className='text-muted-foreground px-5 py-10 text-sm'>
                {t('Loading...')}
              </div>
            ) : sorted.length === 0 ? (
              <div className='text-muted-foreground px-5 py-10 text-sm'>
                {t('No announcements at this time')}
              </div>
            ) : (
              <ScrollArea className='h-[min(70vh,640px)]'>
                <div>
                  {sorted.map((item, idx) => {
                    const key = item.id ?? `announcement-${idx}`
                    return (
                      <button
                        key={key}
                        type='button'
                        onClick={() => {
                          setSelected(item)
                          setOpen(true)
                        }}
                        className={cn(
                          'group hover:bg-muted/40 w-full px-5 py-4 text-left transition-colors',
                          idx < sorted.length - 1 && 'border-border/60 border-b'
                        )}
                      >
                        <div className='flex items-start gap-3'>
                          <AnnouncementStatusDot type={item.type} />
                          <div className='flex min-w-0 flex-1 flex-col gap-1.5'>
                            <p className='whitespace-pre-wrap text-sm leading-relaxed font-medium'>
                              {item.content}
                            </p>
                            {item.extra ? (
                              <p className='text-muted-foreground text-xs'>
                                {item.extra}
                              </p>
                            ) : null}
                            <div className='flex items-center justify-between'>
                              {item.publishDate ? (
                                <time className='text-muted-foreground/60 text-xs'>
                                  {formatDateTimeObject(
                                    new Date(item.publishDate)
                                  )}
                                </time>
                              ) : (
                                <span />
                              )}
                              <span className='text-muted-foreground/40 text-xs opacity-0 transition-opacity group-hover:opacity-100'>
                                {t('Click for details')}
                              </span>
                            </div>
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        <AnnouncementDetailModal
          open={open}
          onOpenChange={setOpen}
          announcement={selected}
        />
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
