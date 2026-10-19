import type { ContextBankTranscriptWriteRequest } from '@shared/context-bank-analysis'
import { getProject } from '@/editor/store'
import { desktop } from '@/lib/platform'
import { flushContextBankWrites } from './context-bank-runtime'
import { useSession } from './session'

export type ContextBankTranscriptDetail = Omit<ContextBankTranscriptWriteRequest, 'projectPath' | 'projectId' | 'assetId'>

/**
 * Persists reusable transcript detail without making Context Bank availability
 * part of transcription success. The bank is supplementary cache/project
 * knowledge; the editable Asset.transcript remains authoritative in Lumen.
 */
export async function persistTranscriptAnalysis(assetId: string, detail: ContextBankTranscriptDetail): Promise<void> {
  const initialPath = useSession.getState().path
  if (!desktop?.contextBank || !initialPath) return
  const initialProjectId = getProject().id

  try {
    // Ensure the current source-asset mirror (and therefore its authoritative
    // fingerprint) has landed before the analysis record tries to bind to it.
    await flushContextBankWrites()

    // A project may have been opened/saved elsewhere while the barrier waited.
    // Never attach analysis captured for one project to another project/path.
    const projectPath = useSession.getState().path
    const projectId = getProject().id
    if (!projectPath || projectPath !== initialPath || projectId !== initialProjectId) return

    await desktop.contextBank.putTranscript({
      projectPath,
      projectId,
      assetId,
      ...detail,
    })
  } catch (error) {
    console.warn('[context-bank] Could not persist transcript analysis:', error)
  }
}
