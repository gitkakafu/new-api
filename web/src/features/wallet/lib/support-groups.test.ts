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
import { describe, expect, it } from 'vitest'

import {
  buildQqGroupUrl,
  isQqProtocolUrl,
  resolveSupportGroups,
} from './support-groups'

describe('buildQqGroupUrl', () => {
  it('returns empty for blank input', () => {
    expect(buildQqGroupUrl('')).toBe('')
    expect(buildQqGroupUrl('   ')).toBe('')
  })

  it('keeps full http(s) join links as-is', () => {
    const url = 'https://qm.qq.com/q/AbCdEfGhIj'
    expect(buildQqGroupUrl(url)).toBe(url)
    expect(buildQqGroupUrl('http://example.com/join')).toBe(
      'http://example.com/join'
    )
  })

  it('keeps mqq protocol links as-is', () => {
    const url =
      'mqqapi://card/show_pslcard?src_type=internal&version=1&uin=123&card_type=group'
    expect(buildQqGroupUrl(url)).toBe(url)
  })

  it('uses mqqapi deep link for pure numeric group ids (not qm.qq.com/q/<number>)', () => {
    const url = buildQqGroupUrl('949531417')
    expect(url).toMatch(/^mqqapi:\/\//)
    expect(url).toContain('uin=949531417')
    expect(url).toContain('card_type=group')
    expect(url).not.toContain('qm.qq.com')
  })

  it('uses qm.qq.com short-key path for non-numeric share keys', () => {
    expect(buildQqGroupUrl('AbCdEfGhIj')).toBe('https://qm.qq.com/q/AbCdEfGhIj')
  })
})

describe('isQqProtocolUrl', () => {
  it('detects mqqapi schemes', () => {
    expect(isQqProtocolUrl('mqqapi://card/show_pslcard?uin=1')).toBe(true)
    expect(isQqProtocolUrl('https://qm.qq.com/q/x')).toBe(false)
  })
})

describe('resolveSupportGroups', () => {
  it('builds qqGroupUrl from numeric support_qq_group', () => {
    const groups = resolveSupportGroups({ support_qq_group: '949531417' })
    expect(groups.qqGroup).toBe('949531417')
    expect(groups.qqGroupUrl).toContain('mqqapi://')
    expect(groups.qqGroupUrl).toContain('uin=949531417')
  })

  it('uses full URL when admin stores an official join link', () => {
    const join = 'https://qm.qq.com/q/OfficialKey123'
    const groups = resolveSupportGroups({ support_qq_group: join })
    expect(groups.qqGroup).toBe(join)
    expect(groups.qqGroupUrl).toBe(join)
  })
})
