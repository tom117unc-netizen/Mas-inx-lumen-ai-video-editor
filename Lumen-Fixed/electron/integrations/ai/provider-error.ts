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
  if (!detail || detail === base || prefix.includes(detail)) return prefix.slice(0, MAX_DETAIL)
  return `${prefix}\nProvider response: ${detail}`.slice(0, MAX_DETAIL)
}
