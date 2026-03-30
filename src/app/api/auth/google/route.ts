// src/app/api/auth/google/route.ts
// Initiates Google OAuth flow — redirects user to Google consent screen

import { NextRequest, NextResponse } from 'next/server'
import { generateGoogleOAuthUrl } from '@/lib/googleDrive'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const phone = searchParams.get('phone')

  if (!phone) {
    return NextResponse.json({ error: 'Phone number required' }, { status: 400 })
  }

  const oauthUrl = generateGoogleOAuthUrl(phone)
  return NextResponse.redirect(oauthUrl)
}
