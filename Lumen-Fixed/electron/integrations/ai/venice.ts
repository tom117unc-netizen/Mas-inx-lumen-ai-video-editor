import type { ModelInfo } from '../../../shared/ai'

interface VeniceCapabilities {
  supportsFunctionCalling?: boolean
  supportsVision?: boolean
  supportsMultipleImages?: boolean
  supportsReasoning?: boolean
}

interface VeniceModel {
  id?: string
  name?: string
  model_spec?: {
    availableContextTokens?: number
    contextTokens?: number
    capabilities?: VeniceCapabilities
  }
}

export function veniceBaseURL(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    if (parsed.hostname !== 'api.venice.ai') return undefined
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`
  } catch {
    return undefined
  }
}

export function parseVeniceModels(json: unknown): ModelInfo[] {
  const data = (json as { data?: VeniceModel[] } | undefined)?.data ?? []
  return data.flatMap((entry) => {
    if (!entry.id) return []
    const caps = entry.model_spec?.capabilities
    if (caps?.supportsFunctionCalling === false) return []
    return [{
      id: entry.id,
      name: entry.name ?? entry.id,
      context: entry.model_spec?.availableContextTokens ?? entry.model_spec?.contextTokens,
      vision: caps?.supportsVision,
    } satisfies ModelInfo]
  })
}

export function parseVeniceVisionTrait(json: unknown): string | undefined {
  const data = (json as { data?: Record<string, unknown> } | undefined)?.data
  const value = data?.default_vision ?? data?.['text:default_vision']
  return typeof value === 'string' && value ? value : undefined
}
