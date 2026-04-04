import { sendWhatsAppMessage as legacySender } from './sender'
import { getSupabaseClient } from '@/lib/infrastructure/database'
import type { SendMessageOptions } from '@/types'

// Use admin client to bypass RLS and securely fetch sensitive credentials
const supabaseAdmin = getSupabaseClient()

interface PersistOutgoingMessageParams {
  toNumber: string
  fromNumber?: string
  contentType: 'text' | 'image' | 'document' | 'audio'
  contentText?: string
  providerResponse?: unknown
}

async function persistOutgoingMessage(params: PersistOutgoingMessageParams): Promise<void> {
  const { toNumber, fromNumber, contentType, contentText, providerResponse } = params

  if (!toNumber?.trim()) return

  const messageId = `mt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  const { error } = await supabaseAdmin.from('whatsapp_messages').insert({
    message_id: messageId,
    channel: 'whatsapp',
    from_number: fromNumber?.trim() || 'bot',
    to_number: toNumber.trim(),
    received_at: new Date().toISOString(),
    content_type: contentType,
    content_text: contentText || null,
    sender_name: 'ZARA',
    event_type: 'MtMessage',
    is_in_24_window: true,
    is_responded: true,
    response_sent_at: new Date().toISOString(),
    raw_payload: {
      source: 'whatsapp_client',
      provider_response: providerResponse ?? null,
    },
  })

  if (error) {
    console.warn('[whatsappClient] Failed to persist outgoing message:', error.message)
  }
}

/**
 * Modern WhatsApp Client wrapper for 11za
 * Handles credential lookup and advanced message types (buttons)
 */
export async function sendWhatsAppMessage(options: SendMessageOptions) {
  const { 
    to, 
    message, 
    from, 
    buttons, 
    mediaUrl, 
    mediaType, 
    authToken: explicitToken, 
    origin: explicitOrigin 
  } = options

  // 1. Resolve credentials (Priority: Explicit Override > DB Lookup > Env Var)
  let authToken = explicitToken || process.env.WHATSAPP_AUTH_TOKEN
  let origin = explicitOrigin || process.env.WHATSAPP_ORIGIN
  let resolvedFromNumber = from

  // Only perform DB lookup if we don't have explicit credentials
  if (!explicitToken || !explicitOrigin) {
    // Try to find the specific bot number, or fallback to ANY available number if 'from' is omitted
    let query = supabaseAdmin.from('phone_document_mapping').select('auth_token, origin, phone_number');
    if (from) {
        query = query.eq('phone_number', from);
    }
    
    const { data: mappings } = await query.limit(1)

    if (mappings && mappings.length > 0) {
      if (!explicitToken) authToken = mappings[0].auth_token
      if (!explicitOrigin) origin = mappings[0].origin
      if (!resolvedFromNumber) resolvedFromNumber = mappings[0].phone_number
    }
  }

  if (!authToken || !origin) {
    console.error('WhatsApp credentials not found. Tried finding for bot:', from || 'any')
    return { success: false, error: 'Credentials missing' }
  }

  // Temporary fallback: Since 11za's button API might have a different undocumented format,
  // we will safely send buttons as purely text options using the reliable legacySender.
  if (buttons && buttons.length > 0) {
    const textWithButtons = message + "\n\n" + buttons.map(b => `- ${b.title}`).join('\n')
    const result = await legacySender(to, textWithButtons, authToken, origin)
    if (result.success) {
      await persistOutgoingMessage({
        toNumber: to,
        fromNumber: resolvedFromNumber,
        contentType: 'text',
        contentText: textWithButtons,
        providerResponse: result.response,
      })
    }
    return result
  }

  if (mediaUrl) {
    const payload = {
        sendto: to,
        authToken: authToken,
        originWebsite: origin,
        contentType: mediaType === 'document' ? 'document' : 'image',
        myfile: mediaUrl,
        caption: message
    };
    
    try {
      const res = await fetch("https://api.11za.in/apis/sendMessage/sendMessages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
      });
      const data = await res.json();
      
      // If media fails, fallback to sending just the text/link via legacySender
      if (!res.ok) {
        console.error("11za Media Send Failed:", data);
        const shortLink = await shortenUrl(mediaUrl);
        const fallbackText = `${message}\n\nLink: ${shortLink}`
        const fallbackResult = await legacySender(to, fallbackText, authToken, origin)
        if (fallbackResult.success) {
          await persistOutgoingMessage({
            toNumber: to,
            fromNumber: resolvedFromNumber,
            contentType: 'text',
            contentText: fallbackText,
            providerResponse: fallbackResult.response,
          })
        }
        return fallbackResult
      }
      await persistOutgoingMessage({
        toNumber: to,
        fromNumber: resolvedFromNumber,
        contentType: mediaType === 'document' ? 'document' : 'image',
        contentText: message,
        providerResponse: data,
      })
      return data;
    } catch (err) {
      console.error("11za Fetch Error:", err);
      const shortLink = await shortenUrl(mediaUrl).catch(() => mediaUrl);
      const fallbackText = `${message}\n\nLink: ${shortLink}`
      const fallbackResult = await legacySender(to, fallbackText, authToken, origin)
      if (fallbackResult.success) {
        await persistOutgoingMessage({
          toNumber: to,
          fromNumber: resolvedFromNumber,
          contentType: 'text',
          contentText: fallbackText,
          providerResponse: fallbackResult.response,
        })
      }
      return fallbackResult
    }
  }

  const result = await legacySender(to, message, authToken, origin)
  if (result.success) {
    await persistOutgoingMessage({
      toNumber: to,
      fromNumber: resolvedFromNumber,
      contentType: 'text',
      contentText: message,
      providerResponse: result.response,
    })
  }

  return result
}

/**
 * Shorten URL using TinyURL API
 */
async function shortenUrl(url: string): Promise<string> {
  try {
    const response = await fetch(`http://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`);
    if (response.ok) {
      return await response.text();
    }
  } catch (error) {
    console.error("URL shortening failed:", error);
  }
  return url;
}
