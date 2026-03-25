import { sendWhatsAppMessage as legacySender } from '../whatsappSender'
import { createClient } from '@supabase/supabase-js'

// Use admin client to bypass RLS and securely fetch sensitive credentials
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export type WhatsAppButton = {
  id: string
  title: string
}

export type SendMessageOptions = {
  to: string
  message: string
  from?: string // The bot's phone number
  buttons?: WhatsAppButton[]
  mediaUrl?: string
  mediaType?: 'image' | 'document' | 'audio'
}

/**
 * Modern WhatsApp Client wrapper for 11za
 * Handles credential lookup and advanced message types (buttons)
 */
export async function sendWhatsAppMessage(options: SendMessageOptions) {
  const { to, message, from, buttons, mediaUrl, mediaType } = options

  // 1. Resolve credentials
  let authToken = process.env.WHATSAPP_AUTH_TOKEN
  let origin = process.env.WHATSAPP_ORIGIN

  // Try to find the specific bot number, or fallback to ANY available number if 'from' is omitted
  let query = supabaseAdmin.from('phone_document_mapping').select('auth_token, origin');
  if (from) {
      query = query.eq('phone_number', from);
  }
  
  const { data: mappings } = await query.limit(1)

  if (mappings && mappings.length > 0) {
    authToken = mappings[0].auth_token
    origin = mappings[0].origin
  }

  if (!authToken || !origin) {
    console.error('WhatsApp credentials not found. Tried finding for bot:', from || 'any')
    return { success: false, error: 'Credentials missing' }
  }

  // Temporary fallback: Since 11za's button API might have a different undocumented format,
  // we will safely send buttons as purely text options using the reliable legacySender.
  if (buttons && buttons.length > 0) {
    const textWithButtons = message + "\n\n" + buttons.map(b => `- ${b.title}`).join('\n')
    return await legacySender(to, textWithButtons, authToken, origin)
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
        return await legacySender(to, `${message}\n\nLink: ${shortLink}`, authToken, origin);
      }
      return data;
    } catch (err) {
      console.error("11za Fetch Error:", err);
      const shortLink = await shortenUrl(mediaUrl).catch(() => mediaUrl);
      return await legacySender(to, `${message}\n\nLink: ${shortLink}`, authToken, origin);
    }
  }

  return await legacySender(to, message, authToken, origin)
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
