// Explicit Dev-only provider probe. Synthetic caller, in-memory store, no phone or owner data.
import { LiveAudio } from "../server/incomingSecretary/liveAudio";
import { LiveConversation } from "../server/incomingSecretary/liveConversation";
import { IntakeSession } from "../server/incomingSecretary/session";
import { MemoryRequests } from "../server/incomingSecretary/store";
import { defaults,buildInstructions } from "../server/incomingSecretary/policy";
import {encodePcmu,floatToPcm16,resampleLinear} from "../client/src/lib/incoming-secretary-audio";
async function speech(text:string){
  const r=await fetch("https://api.openai.com/v1/audio/speech",{
    method:"POST",headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},
    body:JSON.stringify({model:"gpt-4o-mini-tts",voice:"alloy",input:text,response_format:"pcm"}),signal:AbortSignal.timeout(30000),
  });if(!r.ok)throw new Error("Fixture failed");
  const b=Buffer.from(await r.arrayBuffer()),f=new Float32Array(b.length/2);
  for(let i=0;i<f.length;i++)f[i]=b.readInt16LE(i*2)/32768;
  return encodePcmu(floatToPcm16(resampleLinear(f,24000,8000)));
}
async function main(){
  if(process.env.NODE_ENV!=="development")throw new Error("Dev only");
  const audioMode=process.argv.includes("--audio");
  const texts=["Hello. Are you open on Mondays?",
    "Давайте по-русски. Меня зовут Анна Тест. Сохраните моё имя и русский язык общения. Остальные данные я сообщу позже.",
    "Hola, hablemos español. Corrija y guarde mi nombre: Ana Prueba. Es una solicitud, no una reserva."];
  const clips=audioMode?await Promise.all(texts.map(speech)):[];
  const settings={...defaults("synthetic-work"),timeZone:"UTC"},store=new MemoryRequests();
  const session=new IntakeSession("synthetic-owner","synthetic-live",settings,store);await session.begin();
  let native!:LiveAudio,audioBytes=0,closed=false,feeding=false,backendResponses=0,backendStarted=0;
  const errors:any[]=[],types=new Set<string>(),events:any[]=[];
  const c=new LiveConversation(session,buildInstructions(settings,[]),{readyState:1,
    send(s){const e=JSON.parse(s);events.push(e);if(e.type==="audio")audioBytes+=Buffer.byteLength(e.audio,"base64");},
    close(){closed=true},
  },(instructions,cb)=>{
    native=new LiveAudio(instructions,e=>{
      types.add(e.type);
      if(e.type==="error")errors.push({code:e.error?.code,param:e.error?.param});
      if(e.type==="response.event"&&e.event?.type==="response.completed")backendResponses++;
      if(e.type==="response.event"&&e.event?.type==="response.created")backendStarted++;
      cb(e);
    });return native;
  });
  const wait=async(test:()=>boolean,timeout=30000)=>{const until=Date.now()+timeout;
    while(!test()&&!closed&&Date.now()<until)await new Promise(r=>setTimeout(r,100));
    if(!test())throw new Error("Probe expectation not met");};
  await c.start();
  const pump=setInterval(()=>{if(c.ready&&!feeding)c.input({type:"audio",audio:Buffer.alloc(160,255).toString("base64")});},20);
  try{
    await wait(()=>audioBytes>0);
    if(audioMode){
      await new Promise(r=>setTimeout(r,1500));
      for(let k=0;k<clips.length;k++){
        feeding=true;const clip=clips[k];
        for(let i=0;i<clip.length&&!closed;i+=160){
          const frame=Buffer.alloc(160,255);Buffer.from(clip.subarray(i,i+160)).copy(frame);
          c.input({type:"audio",audio:frame.toString("base64")});await new Promise(r=>setTimeout(r,20));
        }feeding=false;
        if(k===0){await wait(()=>backendResponses>0);await new Promise(r=>setTimeout(r,3000));}
        else if(k===1)await wait(()=>store.records.get("synthetic-live")?.fields.language==="ru");
        else await wait(()=>store.records.get("synthetic-live")?.fields.language==="es"&&store.records.get("synthetic-live")?.fields.name==="Ana Prueba");
      }
      await new Promise(r=>setTimeout(r,2500));
      await wait(()=>backendResponses>=backendStarted);
    }else{native.send({type:"response.create"});await wait(()=>backendResponses>0);}
    if(errors.length||closed)throw new Error("Provider failed");
    console.log("LIVE_PROBE_OK",JSON.stringify({audioMode,audioBytes,backendResponses,fields:store.records.get("synthetic-live")?.fields,
      turns:store.records.get("synthetic-live")?.turns,errors,phoneCalls:false,microphoneTested:false}));
  }catch{
    console.log("LIVE_PROBE_FAILED",JSON.stringify({closed,audioBytes,backendResponses,errors,types:[...types],
      fields:store.records.get("synthetic-live")?.fields,turns:store.records.get("synthetic-live")?.turns}));
    process.exitCode=1;
  }finally{clearInterval(pump);await c.stop("completed");}
}
main().catch(()=>{console.error("LIVE_PROBE_STARTUP_FAILED");process.exitCode=1});
