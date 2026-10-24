import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card,CardHeader,CardTitle,CardContent } from "@/components/ui/card";

export function IncomingSecretaryCalendar({token,numberId}:{token:string;numberId:string}){
  const [busy,setBusy]=useState(false),[status,setStatus]=useState<any>(null),[result,setResult]=useState<any>(null);
  const [error,setError]=useState(""),[start,setStart]=useState(""),[duration,setDuration]=useState(60);
  async function run(check:boolean){
    if(busy)return;setBusy(true);setError("");setResult(null);
    try{
      const r=await fetch(`/api/incoming-secretary/dev/calendar/${encodeURIComponent(numberId)}${check?"/check":""}`,{
        method:check?"POST":"GET",headers:{Authorization:`Bearer ${token}`,...(check?{"Content-Type":"application/json"}:{})},
        ...(check?{body:JSON.stringify({startLocal:start,durationMinutes:duration})}:{})});
      const b=await r.json();if(!r.ok)throw Error(b.error||"calendar_unavailable");
      if(check)setResult(b);else setStatus(b);
    }catch(e){setError(e instanceof Error?e.message:"calendar_unavailable");}
    finally{setBusy(false);}
  }
  return <details><summary className="cursor-pointer text-sm underline">Google Calendar · подготовка рабочего календаря</summary>
    <Card><CardHeader><CardTitle>Только Dev-проверка занятости</CardTitle></CardHeader>
    <CardContent className="space-y-3">
      <p className="text-sm text-muted-foreground">«TalkHint — Work» · America/New_York. События не создаются.
        Проверка не подключает календарь к голосовому диалогу и не включает бронирование.</p>
      <Button disabled={busy} variant="outline" onClick={()=>void run(false)}>Проверить доступ к календарю</Button>
      {status&&<p>Доступ подтверждён: <a className="underline" href={status.url} target="_blank" rel="noreferrer">{status.summary}</a> · {status.timeZone}</p>}
      <div className="flex flex-wrap gap-3">
        <label className="text-sm">Дата и время в America/New_York
          <input className="block border rounded p-2" type="datetime-local" value={start} onChange={e=>setStart(e.target.value)}/></label>
        <label className="text-sm">Минуты для проверки, не настройка услуги
          <input className="block border rounded p-2 w-28" type="number" min="1" max="480" value={duration} onChange={e=>setDuration(Number(e.target.value))}/></label>
      </div>
      <Button disabled={busy||!start||!status} onClick={()=>void run(true)}>Проверить время без создания записи</Button>
      {result&&<p role="status">{result.reason==="outside_working_hours"?"Вне рабочего расписания.":
        result.available?"По календарю свободно, включая время на переезд. Это не бронь и не подтверждение услуги.":
        "Есть занятое время или недостаточно времени на переезд."}</p>}
      {error&&<p role="alert" className="text-destructive">{error==="business_timezone_must_match_calendar"?
        "В рабочих настройках Secretary нужно явно выбрать America/New_York. Часовой пояс автоматически не менялся.":
        error==="calendar_owner_required"?"Доступ только для владельца подключённого Google Calendar, вошедшего в свой административный аккаунт TalkHint.":error}</p>}
      <p className="text-xs text-muted-foreground">Личный календарь и названия событий не читаются.
        Рабочие дни, часы работы и минимум 30 минут переезда проверяются сервером.
        Секретарь по-прежнему принимает заявку для решения владельца, а не обещает запись.</p>
    </CardContent></Card></details>;
}
