import WebSocket from 'ws';
const BASE='https://ai-tutor-engine.replit.app';
const KEY=process.env.TUTOR_ENGINE_API_KEY;
// try roleplay mode first
for (const mode of ['roleplay','exam']) {
  const r=await fetch(BASE+'/api/v1/sessions',{method:'POST',headers:{Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'},body:JSON.stringify({user_id:'probe-agent',scenario_id:'english_free_talk',tutor_id:'emma_us_01',mode,target_language:'en',native_language:'ru'})});
  console.log('mode',mode,r.status,(await r.text()).slice(0,200));
}
// voice-command hint probe
const tts=await fetch('https://api.openai.com/v1/audio/speech',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:'gpt-4o-mini-tts',voice:'onyx',input:'Помоги мне, подскажи, что сказать?',response_format:'pcm'})});
const pcm=Buffer.from(await tts.arrayBuffer());
const sess=await (await fetch(BASE+'/api/v1/sessions',{method:'POST',headers:{Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'},body:JSON.stringify({user_id:'probe-agent',scenario_id:'english_free_talk',tutor_id:'emma_us_01',mode:'practice',target_language:'en',native_language:'ru'})})).json();
const ws=new WebSocket(BASE.replace('https','wss')+sess.realtime.connection_url);
ws.on('open',()=>ws.send(JSON.stringify({type:'auth',token:sess.realtime.token,session_id:sess.session_id})));
let sent=false;
ws.on('message',(d,bin)=>{
  if(bin)return;
  let m;try{m=JSON.parse(d.toString())}catch{return}
  if(['tutor.audio.chunk','avatar.lipsync','speech.partial','tutor.text.delta'].includes(m.type))return;
  console.log('<<',JSON.stringify(m).slice(0,450));
  if(m.type==='session.ready'&&!sent){sent=true;
    ws.send(JSON.stringify({type:'turn.start'}));
    let off=0;const iv=setInterval(()=>{
      if(off>=pcm.length){clearInterval(iv);ws.send(JSON.stringify({type:'audio.end'}));return;}
      const b=pcm.subarray(off,off+4800);
      ws.send(JSON.stringify({type:'audio.chunk',format:'pcm16',sample_rate:24000,size:b.length}));ws.send(b);off+=4800;
    },100);}
});
setTimeout(()=>process.exit(0),40000);
