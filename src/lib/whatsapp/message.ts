// src/lib/whatsapp/message.ts
// Shared helpers for formatting WhatsApp messages safely.

import { APP } from '@/config'

const TRUNCATION_SUFFIX = '...\n\n_(truncated)_'

export function truncateWhatsAppMessage(message: string, maxLength: number = APP.MAX_MESSAGE_LENGTH): string {
  if (message.length <= maxLength) {
    return message
  }

  const safeLength = Math.max(0, maxLength - TRUNCATION_SUFFIX.length)
  return `${message.slice(0, safeLength)}${TRUNCATION_SUFFIX}`
}
