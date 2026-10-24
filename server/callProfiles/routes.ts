import type { Express,RequestHandler } from "express";
import { z } from "zod";
import { numberProfile,PROFILE_KEYS } from "./policy";
import { NumberSetupError,type Choice,type Purpose } from "./assign";
interface Dependencies {
  numbers(owner:string):Promise<Array<{id:string;userId:string;twilioNumber:string;name:string;type:string}>>;
  pool():Promise<Array<{id:string;twilioNumber:string;isAssigned:boolean}>>;
  user(owner:string):Promise<{plan?:string|null}|undefined>;
  connect(owner:string,choice:Choice,selected?:Partial<Record<Purpose,string>>,name?:string):Promise<unknown>;
}
const input=z.object({choice:z.enum(["frames","work","both"])}).strict();
export function registerCallProfileRoutes(app:Express,auth:RequestHandler,deps:Dependencies) {
  app.get("/api/call-profiles",auth,async(req,res)=>{
    try {
      const owner=req.user!.id;
      const [numbers,pool,user]=await Promise.all([deps.numbers(owner),deps.pool(),deps.user(owner)]);
      const free=pool.filter(n=>!n.isAssigned);
      res.json({
        profiles:PROFILE_KEYS.map(id=>({id,label:id==="personal"?"Фреймы":"Работа",
          numbers:numbers.filter(n=>n.userId===owner&&numberProfile(n.type)===id)
            .map(n=>({id:n.id,phoneNumber:n.twilioNumber,name:n.name,type:n.type})),
          secretaryOutboundReady:numbers.some(n=>n.userId===owner&&numberProfile(n.type)===id)})),
        recommendedWorkNumber:free[0]?{id:free[0].id,phoneNumber:free[0].twilioNumber,available:true}:null,
        onboarding:{choices:["frames","work","both"],subscribed:!!user?.plan&&!["free","none"].includes(user.plan),availableCount:free.length},
        incomingAiEnabled:false,calendarConnected:false,
      });
    }catch{res.status(503).json({error:"Не удалось загрузить профили звонков."});}
  });
  const write:RequestHandler=(req,res,next)=>{
    if(!req.is("application/json"))return res.sendStatus(415);
    if(req.get("origin")){try{
      const origin=new URL(req.get("origin")!);
      if(origin.host!==req.get("host")||!["http:","https:"].includes(origin.protocol))return res.sendStatus(403);
    }catch{return res.sendStatus(403);}}
    next();
  };
  const fail=(res:any,e:any)=>{
    const messages:Record<string,string>={subscription_required:"Для назначения номера нужна подписка TalkHint.",
      pool_unavailable:"Недостаточно свободных номеров. Назначение не выполнено; обновите список и повторите позже.",
      purpose_already_connected:"Номер этого назначения уже подключён. Он не изменён.",
      number_route_not_ready:"Номер пока не готов к работе с TalkHint. Назначение не выполнено."};
    if(e instanceof z.ZodError)return res.status(400).json({error:"Выберите только фреймы, только работу или оба номера."});
    return res.status(e instanceof NumberSetupError?e.status:503).json({error:messages[e?.code]||"Назначение не подтверждено. Обновите список номеров перед повтором.",code:e instanceof NumberSetupError?e.code:"assignment_unavailable"});
  };
  app.post("/api/call-profiles/connect",auth,write,async(req,res)=>{
    try {const data=input.parse(req.body);res.json(await deps.connect(req.user!.id,data.choice));}
    catch(e){fail(res,e);}
  });
  // Older native clients keep working, but there is no creator-specific adoption.
  app.post("/api/call-profiles/work-number",auth,write,async(req,res)=>{
    try {const data=z.object({numberId:z.string().min(1).max(100)}).strict().parse(req.body);
      const result:any=await deps.connect(req.user!.id,"work",{work:data.numberId});
      res.json({...result,phoneNumber:result.phoneNumbers?.find((n:any)=>n.type==="work")});}
    catch(e){fail(res,e);}
  });
}
