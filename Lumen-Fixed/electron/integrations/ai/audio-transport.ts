/** One optional multimodal route, never a generic claim that every model hears.
 * Audio is explicitly delivered to the selected Gemini provider as a WAV file.
 */
import type { ProviderId } from '../../../shared/ai'

export function canReceiveTimelineAudio(provider:ProviderId,modelId:string) {
  return provider==='gemini' && /^gemini-/.test(modelId)
}
export function validateAudioPayload(value:{data:string;mimeType:string}):{data:string;mimeType:'audio/wav'} {
  if(value.mimeType!=='audio/wav')throw new Error('Only WAV audio is supported for timeline inspection')
  if(!value.data || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.data))
    throw new Error('Invalid base64 audio sample')
  if(value.data.length>4_000_000)throw new Error('Inline audio exceeds the 3 MB safety size limit')
  return {data:value.data,mimeType:'audio/wav'}
}
