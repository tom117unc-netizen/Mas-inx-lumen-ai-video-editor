import { constructionContinuation, isConstructionExecutionTool } from './construction-continuation'
import { CONSTRUCTION_MICRO_STEPS, CONSTRUCTION_MAX_TRANSIENT_RETRIES, CONSTRUCTION_REQUEST_DEADLINE_MS, constructionRetryDelayMs, constructionTaskPrompt, isTransientConstructionError, waitForRetry } from './construction-task-chain'
import { canReceiveTimelineAudio, validateAudioPayload } from './audio-transport'
import { dynamicTool, generateText, jsonSchema, streamText, type ModelMessage, type ToolSet } from 'ai'
import { COPILOT_INSTRUCTIONS, type AgentErrorCode, type AgentEvent, type AgentEventBody, type AgentRunRequest } from '../../../shared/ai'
import { IPC, type BridgeTool } from '../../../shared/integrations'
import { callEditorTool, editorTools, editorWindow } from '../editor-rpc'
import { prepareAgentToolVisualOutput, type AgentVisualAnalyser, type AgentVisualAnalyserFactory } from './agent-sidecar-integration'
import { deleteHistory, readHistory, writeHistory } from './chats'
import { effortSettings, geminiEfforts, openaiEfforts, type ModelApi } from './effort'
import { forgetLocalSession, runLocal, stopLocal } from './local-agents'
import { detailedProviderError } from './provider-error'
import { createProviderProgressWindow } from './provider-progress-window'
import { languageModel, listModels, MissingKeyError } from './providers'
import { analyseWithVisionSidecar, selectVisionSidecar, VisionEvidenceCache } from './vision-sidecar'

/**
 * The Copilot's brain when it's a model the user brought a key for: an AI SDK
 * tool loop whose tools are the editor's own (the same ones Lumen serves over
 * MCP). Events stream to the editor as they happen.
 */

const histories = new Map<string, ModelMessage[]>()
const controllers = new Map<string, AbortController>()
const MAX_STEPS = 24
const MAX_HISTORY = 40

export function emitAgent(e: AgentEvent) {
  editorWindow()?.webContents.send(IPC.aiEvent, e)
}

export async function startAgentRun(req: AgentRunRequest) {
  if (req.target.kind === 'local') {
    void runLocal(req, emitAgent).catch((err) => emitAgent({ runId: req.runId, type: 'error', code: 'failed', message: message(err) }))
    return
  }
  void runModel(req)
}

export function stopAgentRun(runId: string) {
  controllers.get(runId)?.abort()
  stopLocal(runId)
}

export function forgetConversation(conversationId: string) {
  histories.delete(conversationId)
  deleteHistory(conversationId)
  forgetLocalSession(conversationId)
}

function historyOf(conversationId: string) {
  let h = histories.get(conversationId)
  if (!h) {
    h = readHistory(conversationId) ?? []
    histories.set(conversationId, h)
  }
  return h
}

function thinkingOptions(api: ModelApi, modelId: string): Record<string, Record<string, unknown>> {
  if (api === 'openai' && openaiEfforts(modelId).length) return { openai: { reasoningSummary: 'auto' } }
  if (api === 'google' && geminiEfforts(modelId).length) return { google: { thinkingConfig: { includeThoughts: true } } }
  return {}
}

type ProviderOptions = NonNullable<Parameters<typeof streamText>[0]['providerOptions']>

function mergeOptions(...all: (Record<string, Record<string, unknown>> | undefined)[]) {
  const out: Record<string, Record<string, unknown>> = {}
  for (const opts of all) for (const [provider, values] of Object.entries(opts ?? {})) out[provider] = { ...out[provider], ...values }
  return out
}

function cleanSchema(schema: Record<string, unknown>) {
  const { $schema: _unused, ...rest } = schema
  void _unused
  return { type: 'object', properties: {}, ...rest } as Parameters<typeof jsonSchema>[0]
}

interface Picture {
  data: string
  mimeType: string
}
interface AudioSnippet {data:string;mimeType:'audio/wav'}

interface ToolOutput {
  text: string
  pictures: number
  delivery: 'text' | 'follow' | 'native'
}

const PICTURES_NOTE = 'Media evidence from the tools you just called; audio must be directly interpreted before reporting sound events:'
const FOLLOWS_NOTE = '[The picture follows in the next message.]'
const DROPPED_NOTE = '[picture — not kept]'
const textOnly = new Set<string>()
const noEffort = new Set<string>()

function isPictureMessage(m: ModelMessage) {
  return m.role === 'user' && Array.isArray(m.content) && m.content[0]?.type === 'text' && m.content[0].text === PICTURES_NOTE
}

const isImageType = (mediaType: unknown) => typeof mediaType === 'string' && mediaType.startsWith('image')
const isAudioType = (mediaType: unknown) => typeof mediaType === 'string' && mediaType.startsWith('audio/')

function stripPictures(messages: ModelMessage[]): ModelMessage[] {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return {
        ...m,
        content: m.content.map((part) => {
          if (part.type !== 'tool-result') return part
          if (part.output.type === 'text') return part.output.value.includes(FOLLOWS_NOTE) ? { ...part, output: { ...part.output, value: part.output.value.replace(FOLLOWS_NOTE, DROPPED_NOTE) } } : part
          if (part.output.type !== 'content') return part
          const value = part.output.value.map((v) =>
            (v.type === 'file' || v.type === 'image-data' || v.type === 'file-data') && (isImageType(v.mediaType) || isAudioType(v.mediaType)) ? { type: 'text' as const, text: DROPPED_NOTE } : v,
          )
          return { ...part, output: { ...part.output, value } }
        }),
      }
    }
    if (m.role === 'user' && Array.isArray(m.content) && m.content.some((c) => c.type === 'image' || (c.type === 'file' && (isImageType(c.mediaType) || isAudioType(c.mediaType))))) {
      return { ...m, content: m.content.filter((c) => c.type === 'text') }
    }
    return m
  })
}

function forHistory(messages: ModelMessage[]): ModelMessage[] {
  const LIMIT = 6000
  return stripPictures(messages).map((m) => {
    if (m.role !== 'tool') return m
    return {
      ...m,
      content: m.content.map((part) =>
        part.type === 'tool-result' && part.output.type === 'text' && part.output.value.length > LIMIT
          ? { ...part, output: { ...part.output, value: `${part.output.value.slice(0, LIMIT)}\n…[cut for length — call the tool again for the rest]` } }
          : part,
      ),
    }
  })
}

function stripReasoning(messages: ModelMessage[]): ModelMessage[] {
  return messages.flatMap((m) => {
    if (m.role !== 'assistant' || !Array.isArray(m.content)) return [m]
    const content = m.content.filter((part) => part.type !== 'reasoning')
    return content.length ? [{ ...m, content }] : []
  })
}

function isPictureRejection(err: unknown) {
  const code = status(err)
  if (code !== undefined && code !== 400 && code !== 415 && code !== 422) return false
  return /image|vision|multi-?modal|modalit/i.test(detailedProviderError(err))
}

function isEffortRejection(err: unknown) {
  const code = status(err)
  if (code !== undefined && code !== 400 && code !== 422) return false
  return /effort|reasoning|thinking|budget/i.test(detailedProviderError(err))
}

function buildTools(
  defs: BridgeTool[],
  pictures: Map<string, Picture[]>,
  audioSamples: Map<string, AudioSnippet[]>,
  audioSupported: boolean,
  modes: () => { native: boolean; vision: boolean },
  getAnalyse?: AgentVisualAnalyserFactory,
  onToolExecution?: (toolName:string)=>void,
  onEditorOperation?: (operation:Promise<unknown>)=>void,
): ToolSet {
  const tools: ToolSet = {}
  for (const def of defs) {
    tools[def.name] = dynamicTool({
      description: def.description,
      inputSchema: jsonSchema(cleanSchema(def.inputSchema)),
      execute: async (input, { toolCallId }): Promise<ToolOutput> => {
        onToolExecution?.(def.name)
        const pending=callEditorTool(def.name, (input ?? {}) as Record<string, unknown>)
        onEditorOperation?.(pending)
        const res = await pending
        const text = res.content.flatMap((c) => (c.type === 'text' ? [c.text] : [])).join('\n')
        if (res.isError) throw new Error(text || 'The tool failed.')
        const pics = res.content.flatMap((c) => (c.type === 'image' ? [{ data: c.data, mimeType: c.mimeType }] : []))
        const audio = res.content.flatMap(c=>c.type==='audio'?[{data:c.data,mimeType:c.mimeType}]:[])
        if(audio.length) {
          if(!audioSupported) throw new Error('This selected model cannot receive timeline audio. Choose a supported Gemini audio-understanding model in Lumen to listen; audio has not been interpreted.')
          if(audio.length!==1)throw new Error('Audio evidence must contain exactly one WAV sample')
          audioSamples.set(toolCallId,[validateAudioPayload(audio[0])])
        } else audioSamples.delete(toolCallId)
        const prepared = await prepareAgentToolVisualOutput({ toolText: text, pictures: pics, ...modes(), getAnalyse })
        if (prepared.pictures.length) pictures.set(toolCallId, prepared.pictures)
        else pictures.delete(toolCallId)
        return { text: audio.length?`${prepared.text}\n\n[The captured WAV is attached to the next model step; analyse its actual sound, not only the transcript.]`:prepared.text, pictures: prepared.pictures.length, delivery: prepared.delivery }
      },
      toModelOutput: ({ toolCallId, output }) => {
        const out = output as ToolOutput
        const pics = pictures.get(toolCallId) ?? []
        if (!pics.length || out.delivery === 'text') return { type: 'text', value: out.text }
        if (out.delivery === 'follow') return { type: 'text', value: `${out.text}\n\n${FOLLOWS_NOTE}` }
        return {
          type: 'content',
          value: [{ type: 'text', text: out.text }, ...pics.map((p) => ({ type: 'file' as const, mediaType: p.mimeType, data: { type: 'data' as const, data: p.data } }))],
        }
      },
    })
  }
  return tools
}

function withMedia(messages: ModelMessage[], pictures: Map<string, Picture[]>, audioSamples:Map<string,AudioSnippet[]>): ModelMessage[] | undefined {
  const last = messages[messages.length - 1]
  if (last?.role !== 'tool') return undefined
  const pics = last.content.flatMap((part) => (part.type === 'tool-result' ? (pictures.get(part.toolCallId) ?? []) : []))
  const audio = last.content.flatMap((part) => (part.type === 'tool-result' ? (audioSamples.get(part.toolCallId) ?? []) : []))
  if (!pics.length && !audio.length) return undefined
  // The WAV bytes are needed only in this model step, not in the next batch.
  for(const part of last.content) if(part.type==='tool-result') audioSamples.delete(part.toolCallId)
  const earlier = messages.map((m) => (isPictureMessage(m) ? { role: 'user' as const, content: [{ type: 'text' as const, text: '[Earlier pictures — no longer attached.]' }] } : m))
  return [...earlier, { role: 'user', content: [{ type: 'text', text: PICTURES_NOTE }, ...pics.map((p) => ({ type: 'image' as const, image: p.data, mediaType: p.mimeType })), ...audio.map(a=>({type:'file' as const,data:a.data,mediaType:a.mimeType}))] }]
}

function trim(history: ModelMessage[]) {
  if (history.length <= MAX_HISTORY) return history
  let start = history.length - MAX_HISTORY
  while (start < history.length && history[start].role !== 'user') start++
  return history.slice(start)
}

async function runModel(req: AgentRunRequest) {
  if (req.target.kind !== 'model') return
  const { runId } = req
  const controller = new AbortController()
  controllers.set(runId, controller)
  const emit = (e: AgentEventBody) => emitAgent({ runId, ...e })
  try {
    const { provider, model: modelId } = req.target
    const { model, api, vision: canSee, headers } = await languageModel(provider, modelId, req.conversationId)
    const key = `${provider}:${modelId}`
    const native = api === 'anthropic'
    let vision = canSee !== false && !textOnly.has(key)
    let effort = req.target.effort && !noEffort.has(key) ? req.target.effort : undefined
    const pictures = new Map<string, Picture[]>()
    const audioSamples = new Map<string,AudioSnippet[]>()
    const audioSupported=canReceiveTimelineAudio(provider,modelId)
    let constructionActive=false
    let anyEditorToolExecuted=false
    const inFlightEditorOperations=new Set<Promise<unknown>>()
    const visionCache = new VisionEvidenceCache()
    let activeBatchSignal:AbortSignal=controller.signal
    let analyserPromise: Promise<AgentVisualAnalyser | undefined> | undefined
    const getAnalyse: AgentVisualAnalyserFactory = () => {
      analyserPromise ??= (async () => {
        const { models } = await listModels(provider)
        const sidecarModel = selectVisionSidecar(models.filter((candidate) => candidate.id !== modelId))
        if (!sidecarModel) return undefined
        const sidecar = await languageModel(provider, sidecarModel.id, req.conversationId)
        emit({ type: 'status', message: `Using ${sidecarModel.name} to inspect pictures for this text-only model.` })
        const analyse: AgentVisualAnalyser = (toolText, sidecarPictures) =>
          analyseWithVisionSidecar({
            modelId: `${provider}:${sidecarModel.id}`,
            toolText,
            pictures: sidecarPictures,
            cache: visionCache,
            run: async (messages) => {
              const signal=activeBatchSignal
              const result = await generateText({
                model: sidecar.model,
                messages,
                headers: sidecar.headers,
                abortSignal: signal,
              })
              return result.text
            },
          })
        return analyse
      })().catch(() => {
        // A transient sidecar deadline should not permanently disable visual
        // inspection for the rest of a long construction run.
        analyserPromise=undefined
        return undefined
      })
      return analyserPromise
    }
    const tools = buildTools(await editorTools(), pictures,audioSamples,audioSupported, () => ({ native, vision }), getAnalyse,
      name=>{anyEditorToolExecuted=true;if(isConstructionExecutionTool(name))constructionActive=true},
      pending=>{
        inFlightEditorOperations.add(pending)
        void pending.then(()=>inFlightEditorOperations.delete(pending),()=>inFlightEditorOperations.delete(pending))
      })

    const stored = historyOf(req.conversationId)
    const history = native ? stripReasoning(stored) : stored
    const user: ModelMessage = { role: 'user', content: req.context ? `${req.context}\n\n${req.prompt}` : req.prompt }
    let carried: ModelMessage[] = []
    let completed: ModelMessage[] = []
    let wroteText = false
    let afterTool = false
    let usage: { inputTokens?: number; outputTokens?: number } | undefined
    const retried = { pictures: false, effort: false }
    let constructionBatches = 0
    let constructionProgress: string | undefined
    let transientRetries = 0
    let currentHistory = history
    let currentUser = user
    const carry = (steps: ModelMessage[]) => {
      const kept = stripPictures(steps)
      return native ? stripReasoning(kept) : kept
    }

    for (;;) {
      // A single remote/model batch is deliberately limited. An interrupted
      // stream does not invalidate already-saved editor checkpoints.
      const deadline=createProviderProgressWindow(CONSTRUCTION_REQUEST_DEADLINE_MS)
      const requestSignal=AbortSignal.any([controller.signal,deadline.signal])
      activeBatchSignal=requestSignal
      try {
        const effortOpts = effortSettings(api, effort)
        const result = streamText({
          model,
          system: req.instructions ? `${COPILOT_INSTRUCTIONS}\n\n${req.instructions}` : COPILOT_INSTRUCTIONS,
          // The full chat is retained on disk, but construction micro-steps
          // rebuild their working context from persistent editor state. This
          // avoids sending an ever-growing transcript to every short call.
          messages: [...(constructionActive && constructionBatches>0 ? [] : currentHistory), currentUser, ...carried],
          tools,
          headers,
          ...effortOpts,
          providerOptions: mergeOptions(effortOpts.providerOptions, thinkingOptions(api, modelId)) as ProviderOptions,
          stopWhen: ({ steps }) => steps.length >= (constructionActive ? CONSTRUCTION_MICRO_STEPS : MAX_STEPS),
          abortSignal: requestSignal,
          // Outer retries re-check durable editor state before repeating work;
          // avoid SDK retries that could make an interrupted call opaque.
          maxRetries:constructionActive?0:1,
          prepareStep: ({ messages, responseMessages }) => {
            completed = responseMessages as ModelMessage[]
            if (native || (!vision && !audioSupported)) return undefined
            const next = withMedia(messages, pictures,audioSamples)
            return next ? { messages: next } : undefined
          },
        })
        for await (const part of result.fullStream) {
          switch (part.type) {
            case 'text-delta':
              if (!part.text) break
              deadline.progress()
              emit({ type: 'text', delta: afterTool && wroteText ? `\n\n${part.text}` : part.text })
              wroteText = true
              afterTool = false
              break
            case 'reasoning-delta':
              if (part.text) { deadline.progress(); emit({ type: 'reasoning', delta: part.text }) }
              break
            case 'tool-call':
              deadline.progress()
              if (isConstructionExecutionTool(part.toolName)) constructionActive = true
              afterTool = true
              emit({ type: 'tool-start', callId: part.toolCallId, tool: part.toolName, input: part.input })
              break
            case 'tool-result':
              deadline.progress()
              emit({ type: 'tool-end', callId: part.toolCallId, tool: part.toolName, ok: true, summary: brief((part.output as ToolOutput | undefined)?.text ?? part.output) })
              break
            case 'tool-error':
              deadline.progress()
              emit({ type: 'tool-end', callId: part.toolCallId, tool: part.toolName, ok: false, summary: brief(detailedProviderError(part.error)) })
              break
            case 'error':
              throw part.error
            case 'finish':
              deadline.progress()
              usage = {
                inputTokens:(usage?.inputTokens??0)+(part.totalUsage.inputTokens??0),
                outputTokens:(usage?.outputTokens??0)+(part.totalUsage.outputTokens??0),
              }
              break
          }
        }
        const steps = (await result.responseMessages) as ModelMessage[]
        // No raw image or WAV bytes need to survive a completed model step.
        // Without this, multi-hour chains can retain hundreds of images in RAM.
        pictures.clear()
        audioSamples.clear()
        visionCache.clear()
        const next = trim(forHistory([...currentHistory, currentUser, ...carried, ...steps]))
        histories.set(req.conversationId, next)
        writeHistory(req.conversationId, next)
        transientRetries=0
        if (constructionActive) {
          let report = await callEditorTool('get_construction_checkpoint', { limit: 5 })
          let indexJob = (report.structuredContent as {indexing?:{state?:string;percent?:number;error?:string}}|undefined)?.indexing
          if(!report.isError && (indexJob?.state==='running'||indexJob?.state==='pausing')) {
            // The renderer's index worker is crunching original media locally.
            // DO NOT spend provider steps polling it, and DO NOT keep a model
            // request alive while hours of footage are being analysed. The AI
            // conversation remains open; the source job checkpoints each
            // completed section to disk and can resume after interruptions.
            deadline.close()
            emit({type:'status',message:'Indexing original footage locally; no AI model calls are required during this phase.'})
            let reportedPercent=-1
            try {
              while(indexJob?.state==='running'||indexJob?.state==='pausing') {
                await waitForRetry(2500,controller.signal)
                report=await callEditorTool('get_construction_checkpoint',{limit:5})
                if(report.isError)break
                indexJob=(report.structuredContent as {indexing?:{state?:string;percent?:number;error?:string}}|undefined)?.indexing
                const rounded=Math.floor((indexJob?.percent??0)/10)*10
                if(rounded>reportedPercent){
                  reportedPercent=rounded
                  emit({type:'status',message:`Original footage indexing: ${Math.round(indexJob?.percent??0)}% saved.`})
                }
              }
            } finally {
              if(controller.signal.aborted) {
                // User cancellation also stops the local indexing worker at
                // the next safe boundary; it never starts an extra scan.
                try {await callEditorTool('pause_construction_indexing',{})} catch{}
              }
            }
            if(indexJob?.state==='completed')emit({type:'status',message:'Original footage index completed. Resuming source-grounded story analysis.'})
          }
          const decision = constructionContinuation(report.isError ? null : report.structuredContent, constructionBatches, constructionProgress)
          if (decision.continue && !controller.signal.aborted) {
            constructionBatches++
            constructionProgress = decision.progress
            currentHistory = next
            currentUser = { role: 'user', content: constructionTaskPrompt(report.structuredContent) }
            carried = []
            completed = []
            emit({ type: 'status', message: `Continuing saved video construction (batch ${constructionBatches + 1}).` })
            continue
          }
          if (report.isError || report.structuredContent?.status && !(report.structuredContent.status as { complete?: boolean }).complete) {
            const message = report.isError ? 'Construction status could not be verified. Do not treat this run as a completed video.' : decision.reason
            emit({ type: 'text', delta: `\n\n${message}` })
          }
        }
        emit({ type: 'done', usage })
        return
      } catch (err) {
        if (controller.signal.aborted) throw err
        if (vision && !retried.pictures && isPictureRejection(err)) {
          retried.pictures = true
          textOnly.add(key)
          vision = false
          carried = carry([...carried, ...completed])
          emit({ type: 'status', message: 'This model can’t look at images — carrying on without them.' })
          continue
        }
        if (effort && !retried.effort && isEffortRejection(err)) {
          retried.effort = true
          noEffort.add(key)
          effort = undefined
          carried = carry([...carried, ...completed])
          emit({ type: 'status', message: 'This model doesn’t take that effort setting — carrying on with its default.' })
          continue
        }
        // A remote timeout does not necessarily cancel an IPC editor operation.
        // Never run another task concurrently with an unconfirmed pending edit:
        // it could produce a duplicate or race the persisted checkpoint.
        if(inFlightEditorOperations.size && isTransientConstructionError(err,deadline.signal.aborted)) {
          throw new Error('AI request was interrupted while an editor operation is still pending. Automatic retry is paused to avoid duplicate edits. Check the saved construction status and explicitly resume after the operation settles.')
        }
        // Before the first editor operation, retrying a failed initial provider
        // request is safe: there is no tool side effect to repeat.
        if(!constructionActive && !anyEditorToolExecuted && !wroteText &&
           transientRetries<2 && isTransientConstructionError(err,deadline.signal.aborted)) {
          transientRetries++
          emit({type:'status',message:`Reconnecting to AI provider (attempt ${transientRetries}/2); no editing tools have run.`})
          await waitForRetry(constructionRetryDelayMs(transientRetries,err),controller.signal)
          carried=[]
          completed=[]
          continue
        }
        if(constructionActive && isTransientConstructionError(err,deadline.signal.aborted)) {
          // The failed model call may already have edited and checkpointed a
          // scene. Never replay its partial tool-call transcript: recover the
          // saved state and request the next idempotent, bounded work unit.
          const report=await callEditorTool('get_construction_checkpoint',{limit:5})
          const snapshot=report.structuredContent as {status?:{stage?:string;complete?:boolean}}|undefined
          if(!report.isError && snapshot?.status?.complete) {
            // The last provider response was lost but the editor's persisted
            // state confirms that all construction/review gates passed.
            emit({type:'text',delta:'\n\nThe provider response was interrupted, but Lumen verified that video construction and its saved review are complete.'})
            emit({type:'done',usage})
            return
          }
          if(transientRetries<CONSTRUCTION_MAX_TRANSIENT_RETRIES && !report.isError && snapshot?.status?.stage &&
             !['stale','paused','complete'].includes(snapshot.status.stage) &&
             !snapshot.status.complete) {
            transientRetries++
            const delay=constructionRetryDelayMs(transientRetries,err)
            emit({type:'status',message:`Temporary provider interruption. Saved construction is intact; retrying a small step (${transientRetries}/${CONSTRUCTION_MAX_TRANSIENT_RETRIES}).`})
            await waitForRetry(delay,controller.signal)
            pictures.clear()
            audioSamples.clear()
            visionCache.clear()
            currentUser={role:'user',content:constructionTaskPrompt(report.structuredContent,
              deadline.signal.aborted?'The previous short provider call hit its deadline':'The previous short provider call was interrupted')}
            carried=[]
            completed=[]
            continue
          }
        }
        throw err
      } finally {
        deadline.close()
      }
    }
  } catch (err) {
    if (controller.signal.aborted) emit({ type: 'error', code: 'cancelled', message: 'Stopped.' })
    else emit({ type: 'error', code: classify(err), message: friendly(err) })
  } finally {
    controllers.delete(runId)
  }
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

function brief(value: unknown) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return (text ?? '').replace(/\s+/g, ' ').trim().slice(0, 160)
}

function status(err: unknown): number | undefined {
  const e = err as { statusCode?: number; status?: number; response?: { status?: number }; cause?: { statusCode?: number; status?: number } }
  return e?.statusCode ?? e?.status ?? e?.response?.status ?? e?.cause?.statusCode ?? e?.cause?.status
}

function classify(err: unknown): AgentErrorCode {
  if (err instanceof MissingKeyError) return 'no-key'
  const code = status(err)
  if (code === 401 || code === 403) return 'auth'
  if (code === 429) return 'rate-limit'
  return 'failed'
}

function friendly(err: unknown) {
  const code = status(err)
  if (code === 401 || code === 403) return 'The provider rejected the API key. Update it in Integrations › AI models.'
  if (code === 429) return 'The provider is rate-limiting requests right now — try again in a moment.'
  if (code === 404) return `The provider doesn’t know that model. Pick another one. (${detailedProviderError(err)})`
  return detailedProviderError(err)
}
