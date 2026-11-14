/** Short mixed-audio measurements at a constructed join.
 * Signal anomalies are review leads, not semantic listening or proof of bad editing.
 */
export interface JoinAudioReport {
  audible:boolean
  flags:('silent-or-unverifiable'|'possible-click'|'abrupt-level-shift')[]
  discontinuity:number
  localDerivative:number
  beforeRms:number
  afterRms:number
  peak:number
  note:string
}

export function assessJoinAudio(channels:Float32Array[],sampleRate:number,joinSample:number):JoinAudioReport {
  if(!channels.length || !channels[0]?.length || channels.some(c=>c.length!==channels[0].length))
    throw new Error('Join audio requires equal-length channels')
  if(!Number.isFinite(sampleRate)||sampleRate<=0)throw new Error('Invalid audio sample rate')
  if(!Number.isSafeInteger(joinSample)||joinSample<1||joinSample>=channels[0].length)
    throw new Error('Join sample lies outside available audio')
  const width=Math.min(Math.floor(sampleRate*.1),joinSample,channels[0].length-joinSample)
  if(width<1)throw new Error('Join audio window is too short')
  let left=0,right=0,peak=0,step=0
  for(const ch of channels) {
    for(let i=joinSample-width;i<joinSample;i++){left+=ch[i]*ch[i];peak=Math.max(peak,Math.abs(ch[i]))}
    for(let i=joinSample;i<joinSample+width;i++){right+=ch[i]*ch[i];peak=Math.max(peak,Math.abs(ch[i]))}
    step=Math.max(step,Math.abs(ch[joinSample]-ch[joinSample-1]))
  }
  const denom=channels.length*width
  const beforeRms=Math.sqrt(left/denom),afterRms=Math.sqrt(right/denom)
  // Compare the sample jump against ordinary local slopes. A musical transient
  // may produce a false alarm; only actual audition/visual context can resolve it.
  let derivative=0,n=0
  const radius=Math.min(256,width)
  for(const ch of channels)for(const [start,end] of [
    [joinSample-radius+1,joinSample],[joinSample+1,joinSample+radius],
  ]) for(let i=start;i<end;i++){derivative+=Math.abs(ch[i]-ch[i-1]);n++}
  const localDerivative=n?derivative/n:0
  const audible=peak>=.002
  const flags:JoinAudioReport['flags']=[]
  if(!audible)flags.push('silent-or-unverifiable')
  if(audible&&step>.3&&step>Math.max(.025,localDerivative*8))flags.push('possible-click')
  const loud=Math.max(beforeRms,afterRms),quiet=Math.min(beforeRms,afterRms)
  if(loud>.06&&loud>Math.max(.015,quiet)*4)flags.push('abrupt-level-shift')
  return {audible,flags,discontinuity:+step.toFixed(4),
    localDerivative:+localDerivative.toFixed(4),
    beforeRms:+beforeRms.toFixed(4),afterRms:+afterRms.toFixed(4),
    peak:+peak.toFixed(4),
    note:'Measurements describe PCM amplitude around the join. They cannot detect a joke, sarcasm, laughter, dialogue meaning, game events or whether an abrupt cut was intentional.'}
}
