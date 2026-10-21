// Explicit Dev-only synthetic provider probe. No phone, mic, owner data or DB writes.
import { IncomingAudio } from "../server/incomingSecretary/audio";
import { DevConversation } from "../server/incomingSecretary/devConversation";
import { IntakeSession } from "../server/incomingSecretary/session";
import { MemoryRequests } from "../server/incomingSecretary/store";
import { defaults,buildInstructions } from "../server/incomingSecretary/policy";
import {encodePcmu,floatToPcm16,resampleLinear} from "../client/src/lib/incoming-secretary-audio";

async function syntheticSpeech(text:string){
  const response=await fetch("https://api.openai.com/v1/audio/speech",{
    method:"POST",headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},
    body:JSON.stringify({model:"gpt-4o-mini-tts",voice:"alloy",input:text,response_format:"pcm",
      instructions:"Clearly pronounce the supplied text in its language. Pronounce phone digits accurately; do not omit, merge or change digits."}),
    signal:AbortSignal.timeout(30000),
  });
  if(!response.ok)throw new Error(`Synthetic fixture generation HTTP ${response.status}`);
  const pcm=Buffer.from(await response.arrayBuffer()),floats=new Float32Array(pcm.length/2);
  for(let i=0;i<floats.length;i++)floats[i]=pcm.readInt16LE(i*2)/32768;
  return encodePcmu(floatToPcm16(resampleLinear(floats,24000,8000)));
}

async function main(){
  if(process.env.NODE_ENV!=="development")throw new Error("Development only");
  const audioMode=process.argv.includes("--audio");
  const texts=process.argv.includes("--uncertain-phone")?[
    "Здравствуйте. Меня зовут Анна Тест. Номер пять пять пять ноль один ноль ноль. Код страны не помню, сначала уточните, не угадывайте.",
    "Код страны один. Номер: два ноль два, пять пять пять, ноль один шесть два. Повторите перед сохранением.",
    "Код страны один. Исправьте номер: два ноль два, пять пять пять, ноль один семь три. Прочитайте исправленный номер и спросите подтверждение.",
    "Да, подтверждаю именно исправленный номер, который вы только что прочитали. Других данных пока нет.",
  ]:audioMode?[
    "Hello. Please stop for a moment. My name is Ana Test.",
    "Здравствуйте, давайте по-русски. Меня зовут Анна Тест. Я хочу оставить заявку на массаж.",
    "Hola, ¿podemos hablar en español? Mi nombre es Ana Prueba. ¡Gracias!",
  ]:[
    "Hello, my name is Ana Test. I want to request a massage. My callback number is +15550000111 and the address is 10 Example Street. Please save those details.",
    "Здравствуйте, давайте по-русски. Имя Анна Тест. Исправьте адрес: 20 Example Street.",
    "Hola, ¿podemos hablar en español? ¡Gracias! Quiero corregir mi nombre a Ana Prueba.",
  ];
  // TTS is solely the synthetic caller fixture, never a replacement Secretary.
  const clips=audioMode?await Promise.all(texts.map(syntheticSpeech)):[];
  const store=new MemoryRequests(),settings={...defaults("synthetic-work"),timeZone:"UTC"};
  const session=new IntakeSession("synthetic-owner","synthetic-dialogue",settings,store);await session.begin();
  let audio:IncomingAudio,doneCount=0,completedCount=0,closed=false,audioBytes=0,clears=0,active=false,last=Date.now();
  const errors:string[]=[],events:string[]=[];let feeding=false;
  const wait=async(predicate:()=>boolean)=>{
    const until=Date.now()+20000;
    while(!predicate()&&!closed&&Date.now()<until)await new Promise(r=>setTimeout(r,50));
    if(!predicate())throw new Error("Probe timed out or closed");
  };
  const c=new DevConversation(session,buildInstructions(settings,[]),{
    readyState:1,send(s){const e=JSON.parse(s);if(e.type==="audio")audioBytes+=Buffer.byteLength(e.audio,"base64");
      if(e.type==="clear")clears++;if(e.type==="error")console.log("DEV_ERROR",e.error);},
    close(){closed=true;},
  },(instructions,callback)=>{
    audio=new IncomingAudio(instructions,e=>{
      if(!String(e.type).endsWith(".delta"))events.push(String(e.type));
      if(e.type==="error"){
        const code=String(e.error?.code??"unknown").replace(/[^a-zA-Z0-9_]/g,"").slice(0,80);
        errors.push(code);console.log("PROVIDER_ERROR_CODE",code);
      }
      if(e.type==="response.created"){active=true;last=Date.now();}
      if(e.type==="response.done"){doneCount++;if(e.response?.status==="completed")completedCount++;active=false;last=Date.now();}
      callback(e);
    });return audio;
  });
  const silence=Buffer.alloc(160,255).toString("base64");
  // A real browser keeps streaming quiet frames between utterances. Semantic
  // VAD cannot finish endpointing if this probe simply stops sending audio.
  const pump=audioMode?setInterval(()=>{if(!feeding&&!closed&&c.ready)c.input({type:"audio",audio:silence});},20):undefined;
  try{
    await c.start();await wait(()=>audioMode?audioBytes>0:doneCount>=1);
    for(let index=0;index<texts.length;index++){
      const before=completedCount;
      if(audioMode){
        feeding=true;
        const clip=clips[index];
        for(let offset=0;offset<clip.length+9600;offset+=160){
          if(closed)throw new Error("Probe session closed");
          const frame=Buffer.alloc(160,255);
          if(offset<clip.length)frame.set(clip.subarray(offset,offset+160));
          c.input({type:"audio",audio:frame.toString("base64")});
          await new Promise(r=>setTimeout(r,20));
        }
        feeding=false;
      }else{
        audio!.send({type:"conversation.item.create",item:{type:"message",role:"user",content:[{type:"input_text",text:texts[index]}]}});
        audio!.send({type:"response.create"});
      }
      await wait(()=>completedCount>before&&!active&&Date.now()-last>500);
      if(closed)break;
    }
    if(process.argv.includes("--uncertain-phone")){
      const fields=store.records.get("synthetic-dialogue")?.fields;
      if(fields?.phone!=="+12025550173"||fields.callbackConfirmed!==true)
        throw new Error("Phone correction and reconfirmation did not complete");
    }
    console.log("PROBE_RESULT",JSON.stringify({errors,closed,audioBytes,clears,doneCount,
      savedFields:store.records.get("synthetic-dialogue")?.fields,
      recognizedCallerTexts:store.records.get("synthetic-dialogue")?.turns.filter(t=>t.role==="caller").map(t=>t.text),
      syntheticAudio:audioMode,phoneCalls:false,microphoneTested:false}));
  }catch(error){
    console.log("PROBE_STATE",JSON.stringify({closed,active,clears,doneCount,completedCount,audioBytes,errors,
      failure:error instanceof Error&&error.message==="Phone correction and reconfirmation did not complete"?"phone_not_confirmed":"timeout_or_closed",
      syntheticFields:store.records.get("synthetic-dialogue")?.fields,
      syntheticCallerTexts:store.records.get("synthetic-dialogue")?.turns.filter(t=>t.role==="caller").map(t=>t.text),
      recentEvents:events.slice(-20)}));throw new Error("Probe did not complete");
  }finally{if(pump)clearInterval(pump);await c.stop("completed");}
}
main().catch(()=>{console.log("PROBE_FAILED");process.exitCode=1;});
