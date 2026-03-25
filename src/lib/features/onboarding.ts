// src/lib/features/onboarding.ts
// User Onboarding — Bulletproof version with guardrails

import { createClient } from '@supabase/supabase-js'
import { sendWhatsAppMessage } from '@/lib/whatsapp/client'
import { type Language } from '@/lib/whatsapp/templates'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ─── GET OR CREATE USER ───────────────────────────────────────
export async function getOrCreateUser(phone: string, name?: string | null) {
  // ── GUARDRAIL 1: Phone number validate ────────────────────
  if (!phone || phone.length < 10) {
    console.error('[onboarding] Invalid phone number:', phone)
    return null
  }

  // Phone normalize — leading + ensure, spaces/dashes hata do
  const normalizedPhone = phone.replace(/[\s\-().]/g, '')

  // ── Try to find existing user ──────────────────────────────
  const { data: existing } = await supabase
    .from('users')
    .select('*')
    .eq('phone', normalizedPhone)
    .single()

  if (existing) {
    // ── Name update karo agar pehle nahi tha ─────────────────
    if (name && !existing.name) {
      await supabase
        .from('users')
        .update({ name: name.trim() })
        .eq('id', existing.id)
      existing.name = name.trim()
    }
    return existing
  }

  // ── New user — create with defaults ───────────────────────
  const { data: newUser, error } = await supabase
    .from('users')
    .insert({
      phone: normalizedPhone,
      name: name?.trim() ?? null,
      onboarded: false,
      language: 'en',
    })
    .select()
    .single()

  if (error) {
    console.error('[onboarding] User creation failed:', error)
    return null
  }

  return newUser
}

// ─── DETECT LANGUAGE FROM MESSAGE ─────────────────────────────
function detectLanguageFromMessage(message: string): Language | null {
  const hindiWords = /\b(karo|karna|bhai|aaj|kal|mera|meri|hai|hain|nahi|aur|yaad|dilana|list|add)\b/i
  const gujaratiWords = /\b(chhe|nathi|karvu|mari|tamaru|ane|ke|ma|thi|pan|chhu)\b/i

  if (gujaratiWords.test(message)) return 'gu'
  if (hindiWords.test(message)) return 'hi'
  return null
}

// ─── ONBOARDING FLOW ──────────────────────────────────────────
export async function handleOnboarding(
  user: { id: string; phone: string; language: string; onboarded: boolean; name?: string | null },
  incomingMessage: string,
  buttonId?: string | null,
) {
  const phone = user.phone

  // ── GUARDRAIL 2: Already onboarded? (race condition fix) ──
  if (user.onboarded) return

  // ── Auto-detect language from first message ────────────────
  const detectedLang = detectLanguageFromMessage(incomingMessage)
  const lang: Language = detectedLang ?? 'en'

  // ── Mark as onboarded + save detected language ─────────────
  const { error: updateErr } = await supabase
    .from('users')
    .update({
      onboarded: true,
      language: lang,
    })
    .eq('id', user.id)

  if (updateErr) {
    console.error('[onboarding] Update failed:', updateErr)
  }

  // ── Welcome message based on detected language ─────────────
  const welcomeMessages: Record<Language, string> = {
    en: `Hey${user.name ? ` ${user.name}` : ''}! 👋 I'm *ZARA* — your personal assistant on WhatsApp.\n\nI can help you with:\n⏰ Reminders — _"Remind me to call Mom at 6pm"_\n📋 Lists — _"Add milk to grocery list"_\n📁 Documents — _Send any photo or PDF to save it_\n🤖 Questions — _Ask me anything!_\n\nJust talk to me naturally — in Hindi, English, or Gujarati! 😊`,

    hi: `Namaste${user.name ? ` ${user.name}` : ''}! 👋 Main hoon *ZARA* — aapka WhatsApp personal assistant.\n\nMain aapki madad kar sakta hoon:\n⏰ Reminders — _"Kal 6 bje mama ko call karna yaad dilana"_\n📋 Lists — _"Grocery mein milk add karo"_\n📁 Documents — _Koi bhi photo ya PDF bhejo — save ho jayega_\n🤖 Sawaal — _Kuch bhi puch sakte ho!_\n\nBas naturally baat karo — Hindi mein, English mein, ya Gujarati mein! 😊`,

    gu: `Kem cho${user.name ? ` ${user.name}` : ''}! 👋 Hu chu *ZARA* — aapno WhatsApp personal assistant.\n\nHu madad kari shakish:\n⏰ Reminders\n📋 Lists\n📁 Documents\n🤖 Sawal\n\nBas swabhavik rite vaat karo! 😊`,
  }

  // ── GUARDRAIL 3: Send with error handling ─────────────────
  try {
    await sendWhatsAppMessage({
      to: phone,
      message: welcomeMessages[lang]
    })
  } catch (sendErr) {
    console.error('[onboarding] Welcome message failed:', sendErr)
    // Rollback onboarded = false taaki next message pe phir try ho
    await supabase
      .from('users')
      .update({ onboarded: false })
      .eq('id', user.id)
  }
}

// ─── UPDATE USER LANGUAGE ─────────────────────────────────────
// User baad mein language change kare — "Hindi mein baat karo"
export async function updateUserLanguage(params: {
  userId: string
  phone: string
  language: Language
}) {
  const { userId, phone, language } = params

  await supabase
    .from('users')
    .update({ language })
    .eq('id', userId)

  const confirmMessages: Record<Language, string> = {
    en: '✅ Got it! I\'ll reply in English from now on.',
    hi: '✅ Theek hai! Ab main Hindi mein jawab dunga.',
    gu: '✅ Saru! Hu havethe Gujarati ma jawab aapish.',
  }

  await sendWhatsAppMessage({
    to: phone,
    message: confirmMessages[language]
  })
}

// ─── HANDLE RETURNING USER GREETING ──────────────────────────
// Jab user sirf "Hi" ya "Hello" bheje after onboarding
export async function handleGreeting(params: {
  userId: string
  phone: string
  language: Language
  name?: string | null
}) {
  const { phone, language, name } = params
  const displayName = name?.trim() || ''

  const greetings: Record<Language, string> = {
    en: `Hey${displayName ? ` ${displayName}` : ''}! 👋 How can I help you today?\n\n_Say *"help"* to see everything I can do._`,
    hi: `Namaste${displayName ? ` ${displayName}` : ''}! 👋 Aaj kya madad karun?\n\n_*"help"* likho to dekho main kya kya kar sakta hoon._`,
    gu: `Kem cho${displayName ? ` ${displayName}` : ''}! 👋 Aaj shu madad karu?\n\n_*"help"* lakho._`,
  }

  await sendWhatsAppMessage({
    to: phone,
    message: greetings[language]
  })
}