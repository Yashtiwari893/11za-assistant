/**
 * Production-Grade Input Validation
 * Prevents SQL injection, XSS, type mismatches, and invalid data
 */

import { createError } from './errorHandler'

/**
 * Phone number validation and normalization
 */
export function validatePhone(phone: string | unknown): string {
  if (typeof phone !== 'string' || !phone.trim()) {
    throw createError.validation('Phone number is required')
  }

  // Remove all non-digits
  const cleaned = phone.replace(/\D/g, '')

  // Check length (10-15 digits for international support)
  if (cleaned.length < 10 || cleaned.length > 15) {
    throw createError.validation('Phone number must be 10-15 digits', { phone })
  }

  return cleaned
}

/**
 * Email validation
 */
export function validateEmail(email: string | unknown): string {
  if (typeof email !== 'string' || !email.trim()) {
    throw createError.validation('Email is required')
  }

  // RFC 5322 simplified regex
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  const trimmed = email.trim().toLowerCase()

  if (!emailRegex.test(trimmed) || trimmed.length > 254) {
    throw createError.validation('Invalid email address', { email })
  }

  return trimmed
}

/**
 * String validation with length bounds
 */
export function validateString(
  value: string | unknown,
  minLength: number = 1,
  maxLength: number = 10000,
  fieldName: string = 'String'
): string {
  if (typeof value !== 'string') {
    throw createError.validation(`${fieldName} must be a string`)
  }

  const trimmed = value.trim()

  if (trimmed.length < minLength) {
    throw createError.validation(`${fieldName} must be at least ${minLength} characters`, {
      fieldName,
      minLength,
    })
  }

  if (trimmed.length > maxLength) {
    throw createError.validation(`${fieldName} must not exceed ${maxLength} characters`, {
      fieldName,
      maxLength,
    })
  }

  return trimmed
}

/**
 * Plain text validation (remove potentially dangerous characters)
 */
export function validatePlainText(text: string | unknown, maxLength: number = 1000): string {
  const validated = validateString(text, 0, maxLength, 'Text')

  // Remove control characters and dangerous patterns
  const cleaned = validated
    .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '') // Remove control chars
    .replace(/<script[^>]*>.*?<\/script>/gi, '') // Remove scripts
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+\s*=/gi, '') // Remove event handlers
    .trim()

  return cleaned
}

/**
 * Enum validation
 */
export function validateEnum<T>(
  value: any,
  validValues: readonly T[],
  fieldName: string = 'Value'
): T {
  if (!validValues.includes(value)) {
    throw createError.validation(
      `${fieldName} must be one of: ${(validValues as any[]).join(', ')}`,
      { fieldName, validValues, received: value }
    )
  }

  return value as T
}

/**
 * Language code validation
 */
export function validateLanguage(lang: any): 'en' | 'hi' | 'gu' {
  return validateEnum(lang, ['en', 'hi', 'gu'] as const, 'Language') as 'en' | 'hi' | 'gu'
}

/**
 * Integer validation
 */
export function validateInteger(
  value: any,
  min: number = Number.MIN_SAFE_INTEGER,
  max: number = Number.MAX_SAFE_INTEGER,
  fieldName: string = 'Number'
): number {
  const num = Number(value)

  if (!Number.isInteger(num)) {
    throw createError.validation(`${fieldName} must be an integer`, { fieldName, value })
  }

  if (num < min || num > max) {
    throw createError.validation(
      `${fieldName} must be between ${min} and ${max}`,
      { fieldName, min, max, received: num }
    )
  }

  return num
}

/**
 * ISO date string validation
 */
export function validateISODate(value: any, fieldName: string = 'Date'): string {
  if (typeof value !== 'string') {
    throw createError.validation(`${fieldName} must be an ISO date string`, { fieldName })
  }

  // Try to parse as date
  const date = new Date(value)
  if (isNaN(date.getTime())) {
    throw createError.validation(`${fieldName} is not a valid date`, { fieldName, value })
  }

  return value
}

/**
 * UUID v4 validation
 */
export function validateUUID(value: any, fieldName: string = 'ID'): string {
  if (typeof value !== 'string') {
    throw createError.validation(`${fieldName} must be a string`, { fieldName })
  }

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(value)) {
    throw createError.validation(`${fieldName} must be a valid UUID`, { fieldName, value })
  }

  return value
}

/**
 * URL validation
 */
export function validateUrl(value: any, fieldName: string = 'URL'): string {
  if (typeof value !== 'string') {
    throw createError.validation(`${fieldName} must be a string`, { fieldName })
  }

  try {
    new URL(value)
    return value
  } catch {
    throw createError.validation(`${fieldName} must be a valid URL`, { fieldName, value })
  }
}

/**
 * JSON payload validation
 */
export function validateJSON(body: any, requiredFields: string[]): Record<string, any> {
  if (typeof body !== 'object' || body === null) {
    throw createError.validation('Request body must be valid JSON')
  }

  // Check required fields
  for (const field of requiredFields) {
    if (!(field in body) || body[field] === undefined) {
      throw createError.validation(`Missing required field: ${field}`, { requiredFields, received: Object.keys(body) })
    }
  }

  return body
}

/**
 * Sanitize object to prevent injection attacks
 */
export function sanitizeObject(obj: Record<string, any>, maxDepth: number = 3): Record<string, any> {
  if (maxDepth <= 0) {
    return {}
  }

  const sanitized: Record<string, any> = {}

  for (const [key, value] of Object.entries(obj)) {
    // Sanitize key
    const cleanKey = key
      .replace(/[^a-zA-Z0-9_]/g, '')
      .substring(0, 100)

    if (!cleanKey) continue

    // Sanitize value based on type
    if (typeof value === 'string') {
      sanitized[cleanKey] = validatePlainText(value, 10000)
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      sanitized[cleanKey] = value
    } else if (typeof value === 'boolean') {
      sanitized[cleanKey] = value
    } else if (value === null) {
      sanitized[cleanKey] = null
    } else if (Array.isArray(value)) {
      sanitized[cleanKey] = value
        .slice(0, 100) // Limit array size
        .map(v => (typeof v === 'string' ? validatePlainText(v, 1000) : v))
    } else if (typeof value === 'object') {
      sanitized[cleanKey] = sanitizeObject(value, maxDepth - 1)
    }
  }

  return sanitized
}

/**
 * File type validation
 */
export function validateFileType(
  mimeType: string | unknown,
  allowedTypes: string[]
): string {
  if (typeof mimeType !== 'string') {
    throw createError.validation('Invalid file type')
  }

  const normalized = mimeType.split(';')[0].trim().toLowerCase()

  if (!allowedTypes.includes(normalized)) {
    throw createError.validation(
      `File type not allowed. Accepted: ${allowedTypes.join(', ')}`,
      { received: normalized, allowed: allowedTypes }
    )
  }

  return normalized
}

/**
 * File size validation
 */
export function validateFileSize(size: number, maxSizeBytes: number, fieldName: string = 'File'): number {
  if (!Number.isInteger(size) || size < 0) {
    throw createError.validation(`${fieldName} size must be a positive integer`)
  }

  if (size > maxSizeBytes) {
    const maxSizeMB = (maxSizeBytes / (1024 * 1024)).toFixed(2)
    throw createError.validation(
      `${fieldName} size exceeds ${maxSizeMB}MB limit`,
      { maxSizeBytes, received: size }
    )
  }

  return size
}

/**
 * Safe DB query parameter (prevents LIKE injection)
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[%_\\]/g, '\\$&')
}
