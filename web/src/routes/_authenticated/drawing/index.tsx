/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { createFileRoute, redirect } from '@tanstack/react-router'

import { Main } from '@/components/layout'
import { DrawingPage } from '@/features/drawing'
import { isSidebarModuleEnabled } from '@/lib/nav-modules'

export const Route = createFileRoute('/_authenticated/drawing/')({
  beforeLoad: () => {
    if (!isSidebarModuleEnabled('drawing', 'draw')) {
      throw redirect({ to: '/dashboard' })
    }
  },
  component: DrawingRoutePage,
})

function DrawingRoutePage() {
  return (
    <Main className='p-0'>
      <DrawingPage />
    </Main>
  )
}
