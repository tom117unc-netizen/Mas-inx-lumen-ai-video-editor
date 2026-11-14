/** Cheap candidate discovery on the ORIGINAL permitted timeline.
 * Signals prompt an audiovisual investigation, not a judgement of importance.
 * Never call a sampled interval continuously watched.
 */
export type EventSignal='speech'|'audio-onset'|'audio-drop'|'visual-change'|'clip-boundary'
export interface SignalCandidate {
  signal:EventSignal
  start:number
  end:number
  strength:number
  description:string
  /** Exact frames or transcript clip identities behind the trigger. */
  visualFrames:number[]
  transcriptClipIds:string[]
}
export interface EventScanInput {
  start:number
  end:number
  fps:number
  /** Scores compare each sampled frame with the one before. */
  visuals:{frame:number;score:number}[]
  /** Peak short-window dBFS, at frame positions, in timeline coordinates. */
  audio:{frame:number;db:number}[]
  speech:{start:number;end:number;text:string;clipId:string}[]
  boundaries:number[]
}
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v))
const median=(xs:number[])=>{
  const s=[...xs].sort((a,b)=>a-b)
  return s.length?(s[Math.floor((s.length-1)/2)]+s[Math.floor(s.length/2)])/2:0
}
const range=(a:number,b:number,scope:Pick<EventScanInput,'start'|'end'>)=>{
  const start=clamp(Math.floor(a),scope.start,scope.end-1)
  const end=clamp(Math.ceil(b),start+1,scope.end)
  return {start,end}
}
/** Aggregate 20 ms audio RMS readings into coarse, robust bins. Silence stays -120 dB. */
export function audioIndexBins(
  levels:ArrayLike<number>, startFrame:number,fps:number,hopSeconds=.02,binSeconds=.2,
):{frame:number;db:number}[]{
  const per=Math.max(1,Math.round(binSeconds/hopSeconds)),out:{frame:number;db:number}[]=[]
  for(let i=0;i<levels.length;i+=per){
    let max=-120
    for(let j=i;j<Math.min(levels.length,i+per);j++)max=Math.max(max,Number(levels[j]))
    out.push({frame:startFrame+Math.round((i+Math.min(per,levels.length-i)/2)*hopSeconds*fps),db:max})
  }
  return out
}
/** Coalesce nearby triggers for investigation, without dropping their time extent. */
function joinNearby(events:SignalCandidate[],gapFrames:number) {
  const out:SignalCandidate[]=[]
  for(const e of [...events].sort((a,b)=>a.start-b.start||a.end-b.end)){
    const prev=out.at(-1)
    if(prev && prev.signal===e.signal && e.start<=prev.end+gapFrames){
      prev.end=Math.max(prev.end,e.end)
      prev.strength=Math.max(prev.strength,e.strength)
      prev.visualFrames=[...new Set([...prev.visualFrames,...e.visualFrames])].slice(0,16)
      prev.transcriptClipIds=[...new Set([...prev.transcriptClipIds,...e.transcriptClipIds])].slice(0,16)
      if(prev.description.length<350)prev.description=(prev.description+' | '+e.description).slice(0,350)
    } else out.push({...e})
  }
  return out
}
export function discoverTimelineEvents(input:EventScanInput):SignalCandidate[]{
  const {start,end,fps}=input
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||end<=start||!Number.isFinite(fps)||fps<=0)
    throw new Error('Invalid indexed timeline range')
  const events:SignalCandidate[]=[]
  const padding=Math.max(1,Math.round(fps*.6))
  for(const line of input.speech){
    const a=Math.floor(line.start*fps),b=Math.ceil(line.end*fps)
    if(b<=start||a>=end)continue
    const r=range(a,b,input)
    events.push({signal:'speech',...r,strength:1,description:'Timed transcript: '+line.text.slice(0,130),
      visualFrames:[],transcriptClipIds:[line.clipId]})
  }
  // Detect only unusually sharp visual changes. Between samples remains unknown.
  const visuals=input.visuals.filter(v=>v.frame>=start&&v.frame<end&&Number.isFinite(v.score))
  const baseline=median(visuals.map(v=>v.score))
  const chosen=visuals.filter((v,i)=>i>0 && v.score>=Math.max(13,baseline*1.8) &&
    v.score>=Math.max(visuals[i-1]?.score??0,visuals[i+1]?.score??0))
    .sort((a,b)=>b.score-a.score).slice(0,20)
  for(const v of chosen){
    const r=range(v.frame-padding,v.frame+padding,input)
    events.push({signal:'visual-change',...r,strength:Math.min(1,v.score/80),
      description:'Sharp visual difference between sampled frames; inspect actual action between samples',
      visualFrames:[v.frame,visuals[visuals.findIndex(x=>x.frame===v.frame)-1]?.frame??v.frame],transcriptClipIds:[]})
  }
  const audio=input.audio.filter(x=>x.frame>=start&&x.frame<end&&Number.isFinite(x.db))
  for(let i=2;i<audio.length-1;i++){
    const before=median(audio.slice(Math.max(0,i-3),i).map(a=>a.db))
    const now=audio[i].db,next=audio[i+1].db
    const rise=now-before,fall=before-now
    const onset=rise>=14&&now>=-32&&next>=before+7
    const drop=fall>=18&&before>=-32&&now<=-42&&next<=before-10
    if(!onset&&!drop)continue
    const r=range(audio[i].frame-padding,audio[i].frame+padding,input)
    events.push({signal:onset?'audio-onset':'audio-drop',...r,strength:Math.min(1,(onset?rise:fall)/48),
      description:onset?'Sudden audible level increase; may be speech, music or gameplay sound':'Abrupt level drop; may mark a pause, stop or transition',
      visualFrames:[],transcriptClipIds:[]})
  }
  for(const f of [...new Set(input.boundaries)].filter(f=>f>start&&f<end).slice(0,50)){
    const r=range(f-padding,f+padding,input)
    events.push({signal:'clip-boundary',...r,strength:.5,description:'Existing timeline clip boundary; check scene/round continuity',
      visualFrames:[],transcriptClipIds:[]})
  }
  const grouped:SignalCandidate[]=[]
  for(const signal of ['speech','audio-onset','audio-drop','visual-change','clip-boundary'] as const){
    const gap=signal==='speech'?Math.round(fps*.55):signal==='clip-boundary'?0:Math.round(fps*.4)
    grouped.push(...joinNearby(events.filter(e=>e.signal===signal),gap))
  }
  return grouped.sort((a,b)=>a.start-b.start||b.strength-a.strength).slice(0,140)
}
