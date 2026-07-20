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
import { zodResolver } from '@hookform/resolvers/zod'
import type { ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import * as z from 'zod'

import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'

import { FormDirtyIndicator } from '../components/form-dirty-indicator'
import { FormNavigationGuard } from '../components/form-navigation-guard'
import {
  SettingsForm,
  SettingsFormGrid,
  SettingsFormGridItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useSettingsForm } from '../hooks/use-settings-form'
import { useUpdateOption } from '../hooks/use-update-option'

const MAX_QR_SIZE_BYTES = 800 * 1024

const groupManagementSchema = z.object({
  SupportQQGroup: z.string().optional(),
  SupportWeChatGroupQRCode: z.string().optional(),
  SupportDouyinGroupQRCode: z.string().optional(),
})

type GroupManagementFormValues = z.infer<typeof groupManagementSchema>

type GroupManagementSectionProps = {
  defaultValues: GroupManagementFormValues
}

function normalizeValue(value: unknown): string {
  if (value === undefined || value === null) return ''
  return typeof value === 'string' ? value : String(value)
}

function readImageAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('Failed to read image'))
      }
    })
    reader.addEventListener('error', () => {
      reject(reader.error ?? new Error('Failed to read image'))
    })
    reader.readAsDataURL(file)
  })
}

function QrPreview({
  value,
  emptyLabel,
}: {
  value?: string
  emptyLabel: string
}) {
  const src = value?.trim()
  if (!src) {
    return (
      <div className='text-muted-foreground flex h-36 w-36 items-center justify-center rounded-md border border-dashed text-center text-xs'>
        {emptyLabel}
      </div>
    )
  }
  return (
    <img
      src={src}
      alt=''
      className='h-36 w-36 rounded-md border object-contain bg-white'
    />
  )
}

export function GroupManagementSection({
  defaultValues,
}: GroupManagementSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()

  const normalizedDefaults: GroupManagementFormValues = {
    SupportQQGroup: normalizeValue(defaultValues.SupportQQGroup),
    SupportWeChatGroupQRCode: normalizeValue(
      defaultValues.SupportWeChatGroupQRCode
    ),
    SupportDouyinGroupQRCode: normalizeValue(
      defaultValues.SupportDouyinGroupQRCode
    ),
  }

  const { form, handleSubmit, handleReset, isDirty, isSubmitting } =
    useSettingsForm<GroupManagementFormValues>({
      resolver: zodResolver(groupManagementSchema),
      defaultValues: normalizedDefaults,
      onSubmit: async (_data, changedFields) => {
        for (const [key, value] of Object.entries(changedFields)) {
          const res = await updateOption.mutateAsync({
            key,
            value: normalizeValue(value),
          })
          if (!res.success) {
            return
          }
        }
      },
    })

  const handleQrFileChange = async (
    event: ChangeEvent<HTMLInputElement>,
    fieldName: 'SupportWeChatGroupQRCode' | 'SupportDouyinGroupQRCode'
  ) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    if (!file.type.startsWith('image/')) {
      toast.error(t('Please select an image file'))
      return
    }
    if (file.size > MAX_QR_SIZE_BYTES) {
      toast.error(t('QR image must be 800 KB or smaller'))
      return
    }

    try {
      const dataUrl = await readImageAsDataUrl(file)
      form.setValue(fieldName, dataUrl, {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      })
    } catch {
      toast.error(t('Failed to read image file'))
    }
  }

  return (
    <>
      <FormNavigationGuard when={isDirty} />

      <SettingsSection title={t('Group Management')}>
        <Form {...form}>
          <SettingsForm onSubmit={handleSubmit}>
            <SettingsPageFormActions
              onSave={handleSubmit}
              onReset={handleReset}
              isSaving={isSubmitting || updateOption.isPending}
              isResetDisabled={!isDirty}
            />
            <FormDirtyIndicator isDirty={isDirty} />

            <SettingsFormGrid>
              <SettingsFormGridItem span='full'>
                <FormField
                  control={form.control}
                  name='SupportQQGroup'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('QQ Group Number')}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder={t('e.g. 949531417')}
                          autoComplete='off'
                          value={field.value ?? ''}
                          onChange={(event) =>
                            field.onChange(event.target.value)
                          }
                          name={field.name}
                          onBlur={field.onBlur}
                          ref={field.ref}
                        />
                      </FormControl>
                      <FormDescription>
                        {t(
                          'Shown in Wallet and About when set. Enter a numeric group id, or paste the full official join link (https://qm.qq.com/q/...). Leave empty to hide.'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </SettingsFormGridItem>

              <SettingsFormGridItem>
                <FormField
                  control={form.control}
                  name='SupportWeChatGroupQRCode'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('WeChat Group QR Code')}</FormLabel>
                      <FormControl>
                        <div className='flex flex-col gap-3'>
                          <QrPreview
                            value={field.value}
                            emptyLabel={t('No image uploaded')}
                          />
                          <div className='flex flex-wrap gap-2'>
                            <label className='inline-flex cursor-pointer'>
                              <span className='border-border bg-background hover:bg-muted inline-flex h-8 items-center justify-center rounded-lg border px-2.5 text-sm font-medium'>
                                {t('Upload image')}
                              </span>
                              <input
                                type='file'
                                accept='image/*'
                                className='sr-only'
                                onChange={(event) =>
                                  void handleQrFileChange(
                                    event,
                                    'SupportWeChatGroupQRCode'
                                  )
                                }
                              />
                            </label>
                            {field.value ? (
                              <Button
                                type='button'
                                variant='ghost'
                                onClick={() =>
                                  form.setValue('SupportWeChatGroupQRCode', '', {
                                    shouldDirty: true,
                                    shouldTouch: true,
                                    shouldValidate: true,
                                  })
                                }
                              >
                                {t('Clear')}
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      </FormControl>
                      <FormDescription>
                        {t(
                          'Upload a WeChat group QR image. Leave empty to hide it on Wallet and About.'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </SettingsFormGridItem>

              <SettingsFormGridItem>
                <FormField
                  control={form.control}
                  name='SupportDouyinGroupQRCode'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Douyin Group QR Code')}</FormLabel>
                      <FormControl>
                        <div className='flex flex-col gap-3'>
                          <QrPreview
                            value={field.value}
                            emptyLabel={t('No image uploaded')}
                          />
                          <div className='flex flex-wrap gap-2'>
                            <label className='inline-flex cursor-pointer'>
                              <span className='border-border bg-background hover:bg-muted inline-flex h-8 items-center justify-center rounded-lg border px-2.5 text-sm font-medium'>
                                {t('Upload image')}
                              </span>
                              <input
                                type='file'
                                accept='image/*'
                                className='sr-only'
                                onChange={(event) =>
                                  void handleQrFileChange(
                                    event,
                                    'SupportDouyinGroupQRCode'
                                  )
                                }
                              />
                            </label>
                            {field.value ? (
                              <Button
                                type='button'
                                variant='ghost'
                                onClick={() =>
                                  form.setValue(
                                    'SupportDouyinGroupQRCode',
                                    '',
                                    {
                                      shouldDirty: true,
                                      shouldTouch: true,
                                      shouldValidate: true,
                                    }
                                  )
                                }
                              >
                                {t('Clear')}
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      </FormControl>
                      <FormDescription>
                        {t(
                          'Upload a Douyin group QR image. Leave empty to hide it on Wallet and About.'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </SettingsFormGridItem>
            </SettingsFormGrid>
          </SettingsForm>
        </Form>
      </SettingsSection>
    </>
  )
}
