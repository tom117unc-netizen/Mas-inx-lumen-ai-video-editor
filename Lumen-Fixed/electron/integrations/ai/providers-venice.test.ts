import { describe, expect, it } from 'vitest'
import { compatibleModelsFromJson } from './providers'

describe('custom provider capability discovery', () => {
  it('preserves Venice vision and context metadata instead of flattening models to ids', () => {
    const models = compatibleModelsFromJson('https://api.venice.ai/api/v1', {
      data: [
        {
          id: 'deepseek-v3-2',
          name: 'DeepSeek V3.2',
          model_spec: {
            availableContextTokens: 160000,
            capabilities: { supportsFunctionCalling: true, supportsVision: false },
          },
        },
        {
          id: 'vision-model',
          name: 'Vision Model',
          model_spec: {
            availableContextTokens: 1000000,
            capabilities: { supportsFunctionCalling: true, supportsVision: true, supportsMultipleImages: true },
          },
        },
      ],
    })

    expect(models).toEqual([
      expect.objectContaining({ id: 'deepseek-v3-2', vision: false, context: 160000 }),
      expect.objectContaining({ id: 'vision-model', vision: true, context: 1000000 }),
    ])
  })

  it('keeps ordinary OpenAI-compatible model lists working', () => {
    expect(compatibleModelsFromJson('https://example.com/v1', { data: [{ id: 'model-a' }] }))
      .toEqual([expect.objectContaining({ id: 'model-a', name: 'model-a' })])
  })
})
