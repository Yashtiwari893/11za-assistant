// src/app/api/auth/google/callback/route.ts
// Handles OAuth callback from Google, saves tokens to DB, notifies user on WhatsApp

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { exchangeCodeForTokens } from '@/lib/googleDrive'
import { sendWhatsAppMessage } from '@/lib/whatsapp/client'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const phone = searchParams.get('state') // phone number passed in state during OAuth init
  const error = searchParams.get('error')

  // User denied permission
  if (error || !code || !phone) {
    return new NextResponse(
      `<html><body style="font-family:sans-serif;text-align:center;padding:40px">
        <h2>❌ Drive connection cancelled</h2>
        <p>You can try again anytime by sending a document on WhatsApp.</p>
      </body></html>`,
      { headers: { 'Content-Type': 'text/html' } }
    )
  }

  try {
    // 1. Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code)
    if (!tokens) {
      throw new Error('Token exchange failed')
    }

    // 2. Find user by phone
    const { data: user } = await supabase
      .from('users')
      .select('id, name, language')
      .eq('phone', phone)
      .single()

    if (!user) {
      throw new Error('User not found')
    }

    // 3. Save tokens to DB
    console.log('[google/callback] Updating tokens for user:', user.id)
    const expiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    const { error: updateErr } = await supabase
      .from('users')
      .update({
        google_access_token: tokens.access_token,
        google_refresh_token: tokens.refresh_token,
        google_token_expiry: expiry,
      })
      .eq('id', user.id)

    if (updateErr) {
      console.error('[google/callback] DB Update Error:', updateErr)
      throw new Error(`DB Update failed: ${updateErr.message}`)
    }

    console.log('[google/callback] Tokens saved successfully')

    // 4. Send WhatsApp confirmation
    const lang = (user.language as string) || 'hi'
    const confirmMsg = lang === 'hi'
      ? `✅ *Google Drive Connect ho gayi!*\n\nAb se jo bhi document save karoge, wo apni Google Drive mein *ZARA Vault* folder mein jayega 📁\n\nDobara connect karne ki zarurat nahi! 😊`
      : `✅ *Google Drive Connected!*\n\nYour documents will now be saved in your Google Drive under the *ZARA Vault* folder 📁\n\nYou won't need to connect again! 😊`

    // Get auth token for this user's phone config
    const { data: phoneConfig } = await supabase
      .from('phone_document_mapping')
      .select('auth_token, origin')
      .eq('phone_number', phone)
      .limit(1)
      .single()

    await sendWhatsAppMessage({
      to: phone,
      message: confirmMsg,
    })

    // 5. Show success page
    return new NextResponse(
      `<html><body style="font-family:sans-serif;text-align:center;padding:40px;background:#f0fdf4">
        <div style="max-width:400px;margin:auto">
          <div style="font-size:26px">Zara Powered By 11za</div>
          <h2 style="color:#15803d">Google Drive Connected!</h2>
          <p style="color:#374151">Your documents will now be saved directly to your Google Drive in the <strong>ZARA Vault</strong> folder.</p>
          <p style="color:#6b7280;font-size:14px">You can close this tab and go back to WhatsApp.</p>
        </div>
      </body></html>`,
      { headers: { 'Content-Type': 'text/html' } }
    )
  } catch (err) {
    console.error('[google/callback] Error:', err)
    return new NextResponse(
      `<html><body style="font-family:sans-serif;text-align:center;padding:40px">
        <h2>❌ Something went wrong</h2>
        <p>Please try again by sending a document on WhatsApp.</p>
      </body></html>`,
      { headers: { 'Content-Type': 'text/html' } }
    )
  }
}
