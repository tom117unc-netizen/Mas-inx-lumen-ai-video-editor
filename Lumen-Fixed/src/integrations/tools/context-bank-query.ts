import type { ContextBankQuery } from '@shared/context-bank'
import type { ToolArgs } from './kit'

export const DEFAULT_CONTEXT_ITEMS = 80
export const MAX_CONTEXT_ITEMS = 200
export const DEFAULT_CONTEXT_CHARACTERS = 12_000
export const MAX_CONTEXT_CHARACTERS = 28_000

function optionalFrame(args: ToolArgs, key: 'start_frame' | 'end_frame') {
  const value = args[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`${key} must be a non-negative integer frame`)
  return value
}

function budget(args: ToolArgs, key: 'max_items' | 'max_characters', fallback: number, min: number, max: number) {
  const value = args[key]
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${key} must be a number`)
  return Math.max(min, Math.min(max, Math.floor(value)))
}

/** Turns model arguments into a strict, bounded request for the local Context Bank. */
export function makeContextBankQuery(args: ToolArgs, projectPath: string | null, projectId: string): ContextBankQuery {
  if (!projectPath) throw new Error('Save the project before querying its Context Bank.')
  if (!projectId.trim()) throw new Error('Project id is required')
  const rawPurpose = typeof args.purpose === 'string' ? args.purpose.trim() : ''
  if (!rawPurpose) throw new Error('A query purpose is required so Context Bank retrieval can stay focused.')
  const purpose = rawPurpose.slice(0, 500)
  const sequenceId = typeof args.sequence_id === 'string' && args.sequence_id.trim() ? args.sequence_id.trim() : undefined
  const startFrame = optionalFrame(args, 'start_frame')
  const endFrame = optionalFrame(args, 'end_frame')
  if (startFrame !== undefined && endFrame !== undefined && endFrame <= startFrame) throw new Error('end_frame must be after start_frame')

  return {
    projectPath,
    projectId,
    ...(sequenceId ? { sequenceId } : {}),
    ...(startFrame === undefined ? {} : { startFrame }),
    ...(endFrame === undefined ? {} : { endFrame }),
    purpose,
    maxItems: budget(args, 'max_items', DEFAULT_CONTEXT_ITEMS, 1, MAX_CONTEXT_ITEMS),
    maxCharacters: budget(args, 'max_characters', DEFAULT_CONTEXT_CHARACTERS, 500, MAX_CONTEXT_CHARACTERS),
  }
}
