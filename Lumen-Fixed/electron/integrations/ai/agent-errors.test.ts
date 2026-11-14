import { describe, expect, it } from 'vitest'
import { detailedProviderError } from './provider-error'

describe('detailedProviderError', () => {
  it('includes status and provider response body instead of only Bad Request', () => {
    const err = Object.assign(new Error('Bad Request'), {
      statusCode: 400,
      responseBody: JSON.stringify({ error: { message: 'images are not supported in tool messages', code: 'invalid_request' } }),
    })

    expect(detailedProviderError(err)).toContain('400 Bad Request')
    expect(detailedProviderError(err)).toContain('images are not supported in tool messages')
    expect(detailedProviderError(err)).toContain('invalid_request')
  })

  it('extracts nested response data used by OpenAI-compatible providers', () => {
    const err = Object.assign(new Error('Bad Request'), {
      status: 400,
      data: { error: { message: 'unsupported content type: image_url' } },
    })

    expect(detailedProviderError(err)).toContain('unsupported content type: image_url')
  })

  it('does not duplicate an already detailed message', () => {
    const err = Object.assign(new Error('maximum context length is 131072 tokens'), { statusCode: 400 })
    expect(detailedProviderError(err)).toBe('400 maximum context length is 131072 tokens')
  })

  it('explains HTTP 200 parsing failures using their nested SDK cause', () => {
    const err = Object.assign(new Error('Failed to process successful response'), {
      statusCode: 200,
      cause: Object.assign(new TypeError('terminated'), {
        cause: Object.assign(new Error('Body Timeout Error'), { code: 'UND_ERR_BODY_TIMEOUT' }),
      }),
    })
    const message = detailedProviderError(err)
    expect(message).toContain('200 Failed to process successful response')
    expect(message).toContain('terminated')
    expect(message).toContain('UND_ERR_BODY_TIMEOUT')
    expect(message).toContain('resume')
  })

  it('explains malformed HTTP 200 without incorrectly calling it a network timeout', () => {
    const err = Object.assign(new Error('Failed to process successful response'), {
      statusCode: 200,
      cause: new Error('Unexpected JSON response shape'),
    })
    const message = detailedProviderError(err)
    expect(message).toContain('Unexpected JSON response shape')
    expect(message).not.toContain('network timeout')
  })

  it('redacts secrets and provider URLs from nested causes', () => {
    const err = Object.assign(new Error('Failed to process successful response'), {
      statusCode: 200,
      cause: new Error('Bearer sk-secret123456789 api_key=hidden-secret https://provider.example/path?token=private'),
    })
    const message = detailedProviderError(err)
    expect(message).not.toContain('sk-secret123456789')
    expect(message).not.toContain('hidden-secret')
    expect(message).not.toContain('provider.example')
    expect(message).toContain('[redacted]')
  })

  it('redacts obvious credentials from provider payloads', () => {
    const err = Object.assign(new Error('Bad Request'), {
      statusCode: 400,
      data: { error: 'invalid image payload', api_key: 'do-not-show-this' },
    })
    const result = detailedProviderError(err)
    expect(result).toContain('invalid image payload')
    expect(result).not.toContain('do-not-show-this')
    expect(result).toContain('[redacted]')
  })
})
