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
