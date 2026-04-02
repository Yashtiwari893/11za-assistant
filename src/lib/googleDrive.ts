// src/lib/googleDrive.ts
// Google Drive integration — upload, fetch, token refresh

import { getSupabaseClient } from '@/lib/infrastructure/database'
import { GOOGLE } from '@/config'

const supabase = getSupabaseClient()

const GOOGLE_TOKEN_URL = GOOGLE.TOKEN_URL
const GOOGLE_DRIVE_UPLOAD_URL = GOOGLE.DRIVE_UPLOAD_URL
const GOOGLE_DRIVE_FILES_URL = GOOGLE.DRIVE_FILES_URL

// ─── GET USER'S GOOGLE TOKENS ─────────────────────────────────
export async function getGoogleTokens(userId: string) {
  const { data } = await supabase
    .from('users')
    .select('google_access_token, google_refresh_token, google_token_expiry, google_drive_folder_id')
    .eq('id', userId)
    .single()
  return data
}

// ─── CHECK IF DRIVE IS CONNECTED ──────────────────────────────
export async function isDriveConnected(userId: string): Promise<boolean> {
  const tokens = await getGoogleTokens(userId)
  return !!(tokens?.google_refresh_token)
}

// ─── REFRESH ACCESS TOKEN ─────────────────────────────────────
async function refreshAccessToken(userId: string, refreshToken: string): Promise<string | null> {
  try {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GOOGLE.CLIENT_ID,
        client_secret: GOOGLE.CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      })
    })

    const data = await res.json()
    if (!data.access_token) return null

    // Save new access token
    const expiry = new Date(Date.now() + (data.expires_in * 1000)).toISOString()
    await supabase
      .from('users')
      .update({
        google_access_token: data.access_token,
        google_token_expiry: expiry
      })
      .eq('id', userId)

    return data.access_token
  } catch (err) {
    console.error('[googleDrive] Token refresh failed:', err)
    return null
  }
}

// ─── GET VALID ACCESS TOKEN (auto-refresh if expired) ─────────
export async function getValidAccessToken(userId: string): Promise<string | null> {
  const tokens = await getGoogleTokens(userId)
  if (!tokens?.google_refresh_token) return null

  // Check expiry (refresh 5 min before expiry)
  const expiry = tokens.google_token_expiry ? new Date(tokens.google_token_expiry) : null
  const isExpired = !expiry || expiry.getTime() < Date.now() + 5 * 60 * 1000

  if (!isExpired && tokens.google_access_token) {
    return tokens.google_access_token
  }

  // Refresh
  return refreshAccessToken(userId, tokens.google_refresh_token)
}

// ─── GET OR CREATE ZARA FOLDER IN USER'S DRIVE ────────────────
async function getOrCreateZaraFolder(accessToken: string, userId: string): Promise<string | null> {
  // Check if folder ID already stored
  const tokens = await getGoogleTokens(userId)
  if (tokens?.google_drive_folder_id) return tokens.google_drive_folder_id

  try {
    // Search for existing ZARA folder
    const searchRes = await fetch(
      `${GOOGLE_DRIVE_FILES_URL}?q=name%3D'ZARA+Vault'+and+mimeType%3D'application%2Fvnd.google-apps.folder'+and+trashed%3Dfalse&fields=files(id,name)`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    const searchData = await searchRes.json()

    let folderId: string

    if (searchData.files?.length > 0) {
      folderId = searchData.files[0].id
    } else {
      // Create ZARA Vault folder
      const createRes = await fetch(GOOGLE_DRIVE_FILES_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: 'ZARA Vault',
          mimeType: 'application/vnd.google-apps.folder'
        })
      })
      const folder = await createRes.json()
      folderId = folder.id
    }

    // Save folder ID to DB
    await supabase
      .from('users')
      .update({ google_drive_folder_id: folderId })
      .eq('id', userId)

    return folderId
  } catch (err) {
    console.error('[googleDrive] Folder create/get failed:', err)
    return null
  }
}

// ─── UPLOAD FILE TO GOOGLE DRIVE ──────────────────────────────
export async function uploadToDrive(params: {
  userId: string
  fileBuffer: Buffer
  fileName: string
  mimeType: string
}): Promise<{ fileId: string; webViewLink: string } | null> {
  const { userId, fileBuffer, fileName, mimeType } = params

  const accessToken = await getValidAccessToken(userId)
  if (!accessToken) return null

  const folderId = await getOrCreateZaraFolder(accessToken, userId)
  if (!folderId) return null

  try {
    // Multipart upload: metadata + file content
    const metadata = JSON.stringify({
      name: fileName,
      parents: [folderId]
    })

    const boundary = '-------314159265358979323846'
    const body = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      metadata,
      `--${boundary}`,
      `Content-Type: ${mimeType}`,
      '',
      '', // file content added below as Buffer
    ].join('\r\n')

    // Build multipart body manually using Buffer
    const bodyStart = Buffer.from(body, 'utf8')
    const bodyEnd = Buffer.from(`\r\n--${boundary}--`, 'utf8')
    const multipartBody = Buffer.concat([bodyStart, fileBuffer, bodyEnd])

    const uploadRes = await fetch(
      `${GOOGLE_DRIVE_UPLOAD_URL}?uploadType=multipart&fields=id,webViewLink`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary="${boundary}"`,
          'Content-Length': multipartBody.length.toString()
        },
        body: multipartBody
      }
    )

    const file = await uploadRes.json()
    if (!file.id) {
      console.error('[googleDrive] Upload failed:', file)
      return null
    }

    // Make file shareable (anyone with link can view)
    await fetch(`${GOOGLE_DRIVE_FILES_URL}/${file.id}/permissions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ role: 'reader', type: 'anyone' })
    })

    return { fileId: file.id, webViewLink: file.webViewLink }
  } catch (err) {
    console.error('[googleDrive] Upload error:', err)
    return null
  }
}

// ─── GET DOWNLOAD LINK FOR A FILE ─────────────────────────────
export async function getDriveFileLink(userId: string, driveFileId: string): Promise<string | null> {
  const accessToken = await getValidAccessToken(userId)
  if (!accessToken) return null

  try {
    const res = await fetch(
      `${GOOGLE_DRIVE_FILES_URL}/${driveFileId}?fields=webViewLink,webContentLink`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    const data = await res.json()
    // webContentLink = direct download, webViewLink = view in browser
    return data.webViewLink || data.webContentLink || null
  } catch (err) {
    console.error('[googleDrive] Get file link error:', err)
    return null
  }
}

// ─── GENERATE OAUTH URL ───────────────────────────────────────
export function generateGoogleOAuthUrl(phone: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/drive.file',
    access_type: 'offline',
    prompt: 'consent',  // Force to always return refresh_token
    state: phone        // We'll use this to identify user after callback
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

// ─── EXCHANGE CODE FOR TOKENS ─────────────────────────────────
export async function exchangeCodeForTokens(code: string): Promise<{
  access_token: string
  refresh_token: string
  expires_in: number
} | null> {
  try {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
        grant_type: 'authorization_code'
      })
    })
    const data = await res.json()
    return data.access_token ? data : null
  } catch (err) {
    console.error('[googleDrive] Token exchange failed:', err)
    return null
  }
}
