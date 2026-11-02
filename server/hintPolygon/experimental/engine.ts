export type EngineHint={en:string;translation:string;native:string;firstAt:number;fullAt:number;translationAt:number|null;
 inputTokens:number;outputTokens:number;systemHash?:string;systemChars?:number};
export interface HintEngine{
 open():Promise<void>;
 frame(role:"owner"|"guest",frame:Buffer):void;
 owner(text:string):void;
 generate(turnId:string,text:string,history:string,providerTurnKey?:string):Promise<EngineHint>;
 partial?(providerTurnKey:string,text:string,history:string):void;
 settle?():Promise<void>;
 close():Promise<void>;
 audit?():unknown[];
 metadata():{systemHash:string;systemChars:number;promptVersion:string;contextProvenance:string};
}
