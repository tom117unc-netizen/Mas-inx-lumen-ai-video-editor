/** Stitch two bounded, REAL original-timeline rendered audio handles in the
 * exact proposed output order. It is a PREVIEW, not a replacement for inspecting
 * the published result (which may change fades and transitions).
 */
import {assessJoinAudio} from './construction-join-audio'
export interface SpliceBuffer {
  sampleRate:number
  numberOfChannels:number
  length:number
  getChannelData(channel:number):Float32Array
}
export function previewAudioSplice(left:SpliceBuffer,right:SpliceBuffer){
  if(!Number.isSafeInteger(left.sampleRate)||left.sampleRate<8000 ||
     left.sampleRate!==right.sampleRate)
    throw new Error('Splice audio handles need matching valid sample rates')
  if(!Number.isSafeInteger(left.numberOfChannels)||left.numberOfChannels<1||
     left.numberOfChannels>8||right.numberOfChannels!==left.numberOfChannels)
    throw new Error('Splice audio handles need matching channel layouts')
  if(!Number.isSafeInteger(left.length)||!Number.isSafeInteger(right.length)||
     left.length<1||right.length<1||left.length+right.length>left.sampleRate*12)
    throw new Error('Splice audio handle length is invalid or exceeds 12 seconds')
  const samples:Float32Array[]=[]
  for(let c=0;c<left.numberOfChannels;c++){
    const a=left.getChannelData(c),b=right.getChannelData(c)
    if(a.length!==left.length||b.length!==right.length)
      throw new Error('Splice audio channel length does not match its buffer')
    const joined=new Float32Array(a.length+b.length)
    joined.set(a,0);joined.set(b,a.length)
    samples.push(joined)
  }
  const report=assessJoinAudio(samples,left.sampleRate,left.length)
  // encodeWav only reads these four AudioBuffer members; avoid creating
  // an extra OfflineAudioContext or decoding/re-encoding the source.
  const pcm={
    sampleRate:left.sampleRate,numberOfChannels:left.numberOfChannels,
    length:left.length+right.length,
    getChannelData:(c:number)=>samples[c],
  } as AudioBuffer
  return {pcm,report,joinSample:left.length,duration:pcm.length/pcm.sampleRate}
}
