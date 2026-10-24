import WebSocket from "ws";
import type { IntakeSession } from "./session";
import { LiveConversation } from "./liveConversation";
import { SecretaryNativePlayback } from "../secretary/nativePlayback";

type Approval={session:IntakeSession;instructions:string;cleanup:()=>void};
type Conversation=Pick<LiveConversation,"start"|"input"|"stop"|"closed">;
/** Existing authenticated incoming intake, using the same Live coordinator as the microphone bench. */
export function handleIncomingLivePhone(ws:WebSocket,
  authorize:(start:any,stop:()=>void)=>Promise<Approval>,
  create=(a:Approval,peer:any):Conversation=>new LiveConversation(a.session,a.instructions,peer,undefined,false)){
  let approved:Approval|undefined,voice:Conversation|undefined,sid="",closed=false,starting=false,ready=false;
  let stopping:Promise<void>|undefined,reason="connection ended",markSequence=0;
  const marks=new Map<string,{resolve:()=>void;reject:()=>void;cleanup:()=>void}>();
  const send=(e:object)=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(e));};
  const playback=new SecretaryNativePlayback({ws,streamSid:()=>sid,continuous:true,
    truncate:()=>{},playedText:()=>{},audio:()=>{},fail:r=>{void end(r)},
    waitMark:(name,signal)=>new Promise<void>((resolve,reject)=>{
      const cancel=()=>{cleanup();reject(new Error("mark interrupted"))};
      const timer=setTimeout(cancel,10000);timer.unref?.();
      const cleanup=()=>{clearTimeout(timer);signal.removeEventListener("abort",cancel);marks.delete(name)};
      marks.set(name,{resolve:()=>{cleanup();resolve()},reject:cancel,cleanup});
      signal.addEventListener("abort",cancel,{once:true});if(signal.aborted)cancel();
    }),
  });
  const lifetime=setTimeout(()=>void end("call time limit"),15*60_000);lifetime.unref?.();
  const startTimer=setTimeout(()=>void end("missing authenticated start"),10000);startTimer.unref?.();
  function end(why:string):Promise<void>{
    if(stopping)return stopping;closed=true;ready=false;reason=why;
    clearTimeout(lifetime);clearTimeout(startTimer);playback.close();
    Array.from(marks.values()).forEach(mark=>mark.reject());
    stopping=(async()=>{
      try{if(voice)await voice.stop(why);else if(approved)await approved.session.end(why)}
      catch{console.error("[IncomingSecretary Live] Finalization failed; partial request requires recovery")}
      finally{approved?.cleanup();if(ws.readyState===WebSocket.OPEN)ws.close();}
    })();return stopping;
  }
  const peer={
    get readyState(){return ws.readyState},get bufferedAmount(){return ws.bufferedAmount},
    send(raw:string){
      if(closed)return;const e=JSON.parse(raw);
      if(e.type==="audio")playback.audio(e.responseId,"",Buffer.from(e.audio,"base64"));
      if(e.type==="clear"){playback.interrupt();send({event:"clear",streamSid:sid});}
      if(e.type==="error")void end("AI or request persistence failed");
    },close(){void end("AI connection ended")},
  };
  ws.on("message",raw=>{
    if(closed)return;
    if(raw.toString().length>160000){void end("media message safety limit");return;}
    let e:any;try{e=JSON.parse(raw.toString())}catch{return}
    if(e.event==="start"&&!starting){
      starting=true;clearTimeout(startTimer);
      sid=String(e.start?.streamSid??e.streamSid??"");
      if(!sid||sid.length>100||e.start?.mediaFormat?.encoding!=="audio/x-mulaw"||e.start?.mediaFormat?.sampleRate!==8000){
        void end("unsupported media");return;
      }
      void (async()=>{
        const candidate=await authorize(e.start,()=>{void end("owner changed or disabled incoming settings")});
        approved=candidate;
        if(closed){await candidate.session.end(reason);candidate.cleanup();return;}
        voice=create(candidate,peer);await voice.start();
        if(closed||voice.closed){void end("AI connection ended");return;}ready=true;
      })().catch(()=>void end("incoming authorization or Live setup failed"));
    }
    if(e.event==="media"&&ready&&e.media?.track!=="outbound")voice?.input({type:"audio",audio:e.media?.payload});
    if(e.event==="mark"&&typeof e.mark?.name==="string")marks.get(e.mark.name)?.resolve();
    if(e.event==="stop")void end("connection ended");
  });
  ws.on("close",()=>void end("connection lost"));
  ws.on("error",()=>void end("media connection error"));
}
