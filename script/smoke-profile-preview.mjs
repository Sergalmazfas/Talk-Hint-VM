// Synthetic Dev UI only. Chromium/CDP, no login and no number assignments.
import {spawn} from "node:child_process";
import {once} from "node:events";
import WebSocket from "ws";
const browser=spawn("chromium",["--headless","--no-sandbox","--disable-dev-shm-usage",
  "--remote-debugging-port=9337",`--user-data-dir=/tmp/talkhint-preview-${process.pid}`,"about:blank"],{stdio:"ignore"});
let socket;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
try{
  let tabs;
  for(let i=0;i<70;i++){try{tabs=await(await fetch("http://127.0.0.1:9337/json")).json();if(tabs.length)break;}catch{}await pause(100);}
  if(!tabs?.length)throw Error("Chromium did not start");
  const tab=tabs.find(t=>t.type==="page");
  if(!tab)throw Error("Chromium has no page target");
  socket=new WebSocket(tab.webSocketDebuggerUrl);await once(socket,"open");
  let id=0;const pending=new Map();
  socket.on("message",raw=>{const e=JSON.parse(raw.toString());const p=pending.get(e.id);
    if(p){pending.delete(e.id);e.error?p.reject(Error(e.error.message)):p.resolve(e.result);}});
  const cdp=(method,params={})=>new Promise((resolve,reject)=>{
    const n=++id;pending.set(n,{resolve,reject});socket.send(JSON.stringify({id:n,method,params}));
  });
  const evaluate=async expression=>{
    const r=await cdp("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});
    if(r.exceptionDetails)throw Error(r.exceptionDetails.text);
    return r.result.value;
  };
  const check=(v,msg)=>{if(!v)throw Error(msg);};
  await cdp("Page.enable");
  await cdp("Page.addScriptToEvaluateOnNewDocument",{source:`window.__apiCalls=[];const f=window.fetch;window.fetch=(...a)=>{if(String(a[0]).includes("/api/")){window.__apiCalls.push(String(a[0]));throw Error("Synthetic preview attempted API access");}return f(...a);};`});
  await cdp("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
  const open=async()=>{
    await cdp("Page.navigate",{url:"http://127.0.0.1:5000/settings/call-profiles?preview=1"});
    for(let i=0;i<200;i++){if((await evaluate("document.body?.innerText||''")).includes("Только фреймы"))return;await pause(100);}
    throw Error("Preview did not render choices: "+await evaluate("document.body?.innerText?.slice(0,1600)||location.href"));
  };
  const click=async text=>{
    const clicked=await evaluate(`(()=>{const b=[...document.querySelectorAll("button")].find(b=>b.innerText.includes(${JSON.stringify(text)}));if(!b||b.disabled)return false;b.click();return true})()`);
    check(clicked,`Cannot click ${text}`);await pause(150);
  };
  for(const choice of ["Только фреймы","Только работа","Оба номера"]){
    await open();await click(choice);await click("Продолжить с выбранным путём");
    const state=await evaluate(`({text:document.body.innerText,calls:window.__apiCalls,overflow:document.documentElement.scrollWidth>innerWidth+2})`);
    check(!state.calls.length,"Preview requested an authenticated API");
    check(!state.overflow,"Mobile layout overflows");
    check(!state.text.includes("Ошибка сети"),"Choice failed");
    console.log("UI_CHOICE_OK",choice);
  }
  console.log("UI_PREVIEW_OK: three interactive choices, phone viewport, no API writes or requests");
}finally{socket?.close();browser.kill("SIGTERM");}
