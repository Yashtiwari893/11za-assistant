/**
 * Production-Grade Error Handling
 * Structured error responses, error categorization, and recovery strategies
 */

import { NextResponse } from 'next/server'
import { logger } from './logger'

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'AUTHENTICATION_ERROR'
  | 'AUTHORIZATION_ERROR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'SERVICE_UNAVAILABLE'
  | 'TIMEOUT'

export interface AppError extends Error {
  code: ErrorCode
  statusCode: number
  userMessage: string
  context?: Record<string, any>
  isRetryable: boolean
}

export class AppErrorImpl extends Error implements AppError {
  code: ErrorCode
  statusCode: number
  userMessage: string
  context?: Record<string, any>
  isRetryable: boolean

  constructor(
    message: string,
    code: ErrorCode,
    statusCode: number,
    userMessage: string = message,
    isRetryable: boolean = false,
    context?: Record<string, any>
  ) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.statusCode = statusCode
    this.userMessage = userMessage
    this.isRetryable = isRetryable
    this.context = context
    Object.setPrototypeOf(this, AppErrorImpl.prototype)
  }
}

/**
 * Safe error response for APIs
 * Hides internal details in production
 */
export function createErrorResponse(error: unknown, traceId?: string) {
  let appError: AppError

  if (error instanceof AppErrorImpl) {
    appError = error
  } else if (error instanceof Error) {
    appError = new AppErrorImpl(
      error.message,
      'INTERNAL_ERROR',
      500,
      'An unexpected error occurred. Please try again.',
      false
    )
  } else {
    appError = new AppErrorImpl(
      'Unknown error',
      'INTERNAL_ERROR',
      500,
      'An unexpected error occurred. Please try again.',
      false
    )
  }

  // Log the error
  logger.error(appError.message, {
    code: appError.code,
    statusCode: appError.statusCode,
    context: appError.context,
    traceId,
  }, appError)

  // Return safe response (hide stack trace in production)
  const response: Record<string, any> = {
    error: appError.userMessage,
    code: appError.code,
    isRetryable: appError.isRetryable,
  }

  if (process.env.NODE_ENV !== 'production') {
    response.details = appError.message
    response.traceId = traceId
  }

  return NextResponse.json(response, { status: appError.statusCode })
}

/**
 * Common error factories
 */
export const createError = {
  validation: (msg: string, ctx?: Record<string, any>) =>
    new AppErrorImpl(msg, 'VALIDATION_ERROR', 400, `Invalid input: ${msg}`, false, ctx),

  auth: (msg: string = 'Authentication required', ctx?: Record<string, any>) =>
    new AppErrorImpl(msg, 'AUTHENTICATION_ERROR', 401, 'You must be authenticated', false, ctx),

  notFound: (resource: string, ctx?: Record<string, any>) =>
    new AppErrorImpl(`${resource} not found`, 'NOT_FOUND', 404, `${resource} not found`, false, ctx),

  conflict: (msg: string, ctx?: Record<string, any>) =>
    new AppErrorImpl(msg, 'CONFLICT', 409, msg, false, ctx),

  rateLimited: (retryAfter?: number, ctx?: Record<string, any>) =>
    new AppErrorImpl(
      `Rate limited${retryAfter ? ` - retry after ${retryAfter}s` : ''}`,
      'RATE_LIMITED',
      429,
      `Too many requests. Please try again later.`,
      true,
      ctx
    ),

  internal: (msg: string, ctx?: Record<string, any>) =>
    new AppErrorImpl(msg, 'INTERNAL_ERROR', 500, 'Internal server error', false, ctx),

  serviceUnavailable: (service: string, ctx?: Record<string, any>) =>
    new AppErrorImpl(
      `${service} unavailable`,
      'SERVICE_UNAVAILABLE',
      503,
      'Service temporarily unavailable. Please try again later.',
      true,
      ctx
    ),

  timeout: (operation: string, ctx?: Record<string, any>) =>
    new AppErrorImpl(
      `${operation} timeout`,
      'TIMEOUT',
      504,
      'Request timed out. Please try again.',
      true,
      ctx
    ),
}

/**
 * Retry utility for transient failures
 */
export async function retryWithExponentialBackoff<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 100
): Promise<T> {
  let lastError: Error | undefined

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error as Error

      // Check if error is retryable
      if (error instanceof AppErrorImpl && !error.isRetryable) {
        throw error
      }

      // Don't retry on last attempt
      if (attempt === maxRetries - 1) {
        throw error
      }

      // Exponential backoff with jitter
      const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000
      await new Promise(resolve => setTimeout(resolve, delay))

      logger.warn(`Retrying operation (attempt ${attempt + 1}/${maxRetries})`, {
        delay,
        error: lastError.message,
      })
    }
  }

  throw lastError
}
