/**
 * Production-Grade Logging System
 * Handles structured logging with context, severity levels, and analytics
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal'
export type LogContext = Record<string, any>

export interface LogEntry {
  timestamp: string
  level: LogLevel
  message: string
  context: LogContext
  stackTrace?: string
  traceId?: string
}

let globalTraceId: string | undefined

export function setTraceId(id: string) {
  globalTraceId = id
}

export function getTraceId(): string | undefined {
  return globalTraceId
}

/**
 * Main logging function with structured data
 */
export function log(
  level: LogLevel,
  message: string,
  context?: LogContext,
  error?: Error
): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    context: {
      ...context,
      traceId: globalTraceId,
      env: process.env.NODE_ENV || 'development',
    },
  }

  if (error) {
    entry.stackTrace = error.stack
    entry.context.errorName = error.name
  }

  // Console output for development
  if (process.env.NODE_ENV !== 'production') {
    const color = getColorForLevel(level)
    console.log(`${color}[${level.toUpperCase()}] ${message}`, entry.context)
    if (error) console.error(error)
  }

  // Send to external service in production
  if (process.env.NODE_ENV === 'production') {
    sendToAnalytics(entry)
  }
}

export const logger = {
  debug: (msg: string, ctx?: LogContext) => log('debug', msg, ctx),
  info: (msg: string, ctx?: LogContext) => log('info', msg, ctx),
  warn: (msg: string, ctx?: LogContext) => log('warn', msg, ctx),
  error: (msg: string, ctx?: LogContext, err?: Error) => log('error', msg, ctx, err),
  fatal: (msg: string, ctx?: LogContext, err?: Error) => log('fatal', msg, ctx, err),
}

function getColorForLevel(level: LogLevel): string {
  const colors: Record<LogLevel, string> = {
    debug: '\x1b[36m',    // Cyan
    info: '\x1b[32m',     // Green
    warn: '\x1b[33m',     // Yellow
    error: '\x1b[31m',    // Red
    fatal: '\x1b[35m',    // Magenta
  }
  return colors[level] + '\x1b[0m'
}

async function sendToAnalytics(entry: LogEntry): Promise<void> {
  // TODO: Implement external logging service integration
  // Options: Datadog, New Relic, Sentry, CloudWatch, etc.
  try {
    // Placeholder for production logging service
    if (process.env.LOG_ENDPOINT) {
      await fetch(process.env.LOG_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      }).catch(() => {
        // Silently fail to not block execution
      })
    }
  } catch {
    // Emergency fallback - write to stderr
    console.error('Logging service failed:', entry)
  }
}
