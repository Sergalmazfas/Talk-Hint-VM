import type { Express, RequestHandler } from "express";
import { CANDIDATE_STT_IDS, candidateBrainModelsForUser, isCandidateStt,
  isCandidateBrainModelForUser, isHintMiniPilotOwner, type CandidatePipelineConfig } from "../candidatePipeline";

export function registerPersonalPipelineRoutes(app: Express, base: string, authorize: RequestHandler,
  storage: { getCandidatePipeline(id:string):Promise<CandidatePipelineConfig>;
    setCandidatePipeline(id:string,cfg:CandidatePipelineConfig):Promise<CandidatePipelineConfig> }) {
  app.get(`${base}/candidate-pipeline`, authorize, async(req,res)=>{
    try {
      const userId=(req as any).user.id;
      res.json({...await storage.getCandidatePipeline(userId),allowedStt:CANDIDATE_STT_IDS,
        allowedBrainModels:candidateBrainModelsForUser(userId),ownerMiniPilot:isHintMiniPilotOwner(userId)});
    } catch(e:any){res.status(500).json({error:String(e?.message??e)});}
  });
  app.put(`${base}/candidate-pipeline`, authorize, async(req,res)=>{
    try {
      const userId=(req as any).user.id;
      const {enabled,stt=null,brainModel=null}=req.body??{};
      if(typeof enabled!=="boolean")return res.status(400).json({error:"enabled must be boolean"});
      if(stt!==null&&!isCandidateStt(stt))return res.status(400).json({error:"unknown candidate STT"});
      if(brainModel!==null&&!isCandidateBrainModelForUser(brainModel,userId))
        return res.status(400).json({error:"unknown or unauthorized candidate Brain model"});
      if(enabled&&stt===null&&brainModel===null)return res.status(400).json({error:"enabled pipeline must select a candidate"});
      res.json(await storage.setCandidatePipeline(userId,{enabled,stt,brainModel}));
    }catch(e:any){res.status(500).json({error:String(e?.message??e)});}
  });
}
