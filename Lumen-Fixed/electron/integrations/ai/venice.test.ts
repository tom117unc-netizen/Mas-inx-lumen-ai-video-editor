import { describe, expect, it } from 'vitest'
import { parseVeniceModels, veniceBaseURL } from './venice'

describe('Venice model capability routing', () => {
  it('recognises Venice API URLs configured through the custom provider', () => {
    expect(veniceBaseURL('https://api.venice.ai/api/v1')).toBe('https://api.venice.ai/api/v1')
    expect(veniceBaseURL('https://api.venice.ai/api/v1/')).toBe('https://api.venice.ai/api/v1')
    expect(veniceBaseURL('https://example.com/v1')).toBeUndefined()
  })

  it('maps authoritative Venice capability flags onto Lumen model metadata', () => {
    const models = parseVeniceModels({
      data: [
        {
          id: 'deepseek-v3-2',
          name: 'DeepSeek V3.2',
          model_spec: {
            availableContextTokens: 160000,
            capabilities: { supportsFunctionCalling: true, supportsVision: false, supportsReasoning: true },
          },
        },
        {
          id: 'vision-model',
          model_spec: {
            availableContextTokens: 1000000,
            capabilities: { supportsFunctionCalling: true, supportsVision: true, supportsMultipleImages: true },
          },
        },
        {
          id: 'no-tools',
          model_spec: { capabilities: { supportsFunctionCalling: false, supportsVision: true } },
        },
      ],
    })

    expect(models).toEqual([
      expect.objectContaining({ id: 'deepseek-v3-2', vision: false, context: 160000 }),
      expect.objectContaining({ id: 'vision-model', vision: true, context: 1000000 }),
    ])
  })
})
