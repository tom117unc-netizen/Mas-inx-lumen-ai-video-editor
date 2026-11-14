type ProviderError = {
  message?: unknown
  statusCode?: unknown
  status?: unknown
  responseBody?: unknown
  data?: unknown
  body?: unknown
  response?: { body?: unknown; data?: unknown; status?: unknown }
  cause?: unknown
}

const MAX_DETAIL = 4000
const SECRET_KEY = /^(authorization|api[-_]?key|token|secret|password|cookie|set-cookie)$/i

function safeValue(value: unknown): unknown {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return undefined
    try {
      return safeValue(JSON.parse(trimmed))
    } catch {
      return trimmed
    }
  }
  if (Array.isArray(value)) return value.map(safeValue)
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY.test(key)) out[key] = '[redacted]'
      else {
        const cleaned = safeValue(item)
        if (cleaned !== undefined) out[key] = cleaned
      }
    }
    return out
  }
  return value
}

function printable(value: unknown) {
  const cleaned = safeValue(value)
  if (cleaned === undefined) return ''
  if (typeof cleaned === 'string') return cleaned
  try {
    return JSON.stringify(cleaned)
  } catch {
    return String(cleaned)
  }
}

function statusOf(err: ProviderError): number | undefined {
  const values = [err.statusCode, err.status, err.response?.status]
  for (const value of values) if (typeof value === 'number') return value
  const cause = err.cause as ProviderError | undefined
  if (cause && cause !== err) return statusOf(cause)
  return undefined
}

function detailOf(err: ProviderError): string {
  const candidates = [err.responseBody, err.data, err.body, err.response?.body, err.response?.data]
  for (const candidate of candidates) {
    const text = printable(candidate)
    if (text) return text
  }
  const cause = err.cause as ProviderError | undefined
  if (cause && cause !== err) return detailOf(cause)
  return ''
}

/** A 200 response can still fail while reading the body or validating the model's
 * schema. The AI SDK retains the real cause but normally hides it behind a generic
 * "Failed to process successful response" message. Never print request URLs,
 * request bodies, response headers or secrets in the visible diagnostic. */
function safeCause(error: unknown): string {
  const parts: string[] = []
  const seen = new Set<unknown>()
  let current: unknown = (error as ProviderError | null)?.cause
  for (let depth = 0; current && depth < 4 && !seen.has(current); depth++) {
    seen.add(current)
    if (typeof current === 'object') {
      const cause = current as { message?: unknown; code?: unknown; cause?: unknown }
      const msg = typeof cause.message === 'string' ? cause.message.trim() : ''
      const code = typeof cause.code === 'string' && /^[A-Z][A-Z0-9_]{2,64}$/.test(cause.code) ? cause.code : ''
      if (msg || code) {
        const safe = msg
          .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
          .replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, '[redacted]')
          .replace(/\b(api[_-]?key|token|authorization|password)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
          .replace(/https?:\/\/[^\s]+/gi, '[redacted URL]')
          .slice(0, 260)
        parts.push([safe, code && !safe.includes(code) ? `(${code})` : ''].filter(Boolean).join(' '))
      }
      current = cause.cause
    } else {
      break
    }
  }
  return parts.filter((x, i) => parts.indexOf(x) === i).join(' → ')
}

/**
 * Turns opaque SDK/provider failures such as `Bad Request` into a useful,
 * copyable diagnostic while redacting obvious credential fields.
 */
export function detailedProviderError(error: unknown) {
  const err = (error && typeof error === 'object' ? error : {}) as ProviderError
  const base = error instanceof Error ? error.message : typeof error === 'string' ? error : printable(error) || 'Provider request failed'
  const code = statusOf(err)
  const detail = detailOf(err)
  const prefix = code ? `${code} ${base}` : base
  if (code === 200 && /Failed to process successful response/i.test(base)) {
    const why = safeCause(error)
    return [prefix, why ? `Underlying response error: ${why}` : 'The provider response could not be read or decoded.', 'Previously completed editor tools may still be saved. Check construction status and resume; do not blindly replay edits.'].join('\n').slice(0, MAX_DETAIL)
  }
  if (!detail || detail === base || prefix.includes(detail)) return prefix.slice(0, MAX_DETAIL)
  return `${prefix}\nProvider response: ${detail}`.slice(0, MAX_DETAIL)
}
