import { describe, expect, it } from 'vitest'

import { escapeHtml } from './escapeHtml'

describe('escapeHtml', () => {
  it('leaves ordinary labels untouched', () => {
    expect(escapeHtml('office-nas · 99.8%')).toBe('office-nas · 99.8%')
  })

  it('neutralises a tag, which is the case that matters', () => {
    // An Agent hostname or display name reaching an ECharts tooltip formatter is
    // assigned to innerHTML; this is the payload that would otherwise run.
    expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe(
      '&lt;img src=x onerror=alert(1)&gt;',
    )
  })

  it('escapes quotes so a value cannot break out of an attribute', () => {
    expect(escapeHtml(`" onmouseover='x'`)).toBe('&quot; onmouseover=&#39;x&#39;')
  })

  it('escapes ampersands first so nothing is double-decoded', () => {
    expect(escapeHtml('a & <b>')).toBe('a &amp; &lt;b&gt;')
  })
})
