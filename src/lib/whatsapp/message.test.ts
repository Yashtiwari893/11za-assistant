import { describe, expect, it } from 'vitest'

import { truncateWhatsAppMessage } from './message'

describe('truncateWhatsAppMessage', () => {
  it('returns short messages unchanged', () => {
    expect(truncateWhatsAppMessage('hello')).toBe('hello')
  })

  it('truncates long messages with suffix', () => {
    const longMessage = 'a'.repeat(4100)
    const result = truncateWhatsAppMessage(longMessage)

    expect(result.length).toBeLessThanOrEqual(4000)
    expect(result.endsWith('_(truncated)_')).toBe(true)
  })
})
