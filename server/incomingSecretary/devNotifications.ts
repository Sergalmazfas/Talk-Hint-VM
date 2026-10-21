import { X509Certificate, createPrivateKey } from "node:crypto";
import { and,eq } from "drizzle-orm";
import { db } from "../db";
import { deviceTokens } from "@shared/schema";
import { normalizePem } from "../pushChannels/iosPushChannel";

/** Inspection only: no Provider, no network, no token values in the response. */
export function inspectAlertCredentials(certInput?:string,keyInput?:string) {
  const certPem=normalizePem(certInput),keyPem=normalizePem(keyInput);
  const issues:string[]=[];
  if(!certPem)issues.push("Отсутствует отдельный APNS_ALERT_CERT_PEM для обычных уведомлений.");
  if(!keyPem)issues.push("Отсутствует отдельный APNS_ALERT_KEY_PEM для обычных уведомлений.");
  let cert:X509Certificate|undefined,key:ReturnType<typeof createPrivateKey>|undefined;
  if(certPem)try{
    cert=new X509Certificate(certPem);
    if(Date.parse(cert.validTo)<=Date.now())issues.push("Сертификат обычных APNs просрочен.");
    if(Date.parse(cert.validFrom)>Date.now())issues.push("Сертификат обычных APNs ещё не действителен.");
    if(/\.voip(?:\s|$)/i.test(cert.subject)||/VoIP/i.test(cert.subject))issues.push("Предоставлен VoIP-сертификат, а нужен обычный APNs alert.");
  }catch{issues.push("APNS_ALERT_CERT_PEM не распознаётся как PEM-сертификат.");}
  if(keyPem)try{key=createPrivateKey(keyPem);}catch{issues.push("APNS_ALERT_KEY_PEM не распознаётся как незашифрованный приватный ключ.");}
  if(cert&&key)try{if(!cert.checkPrivateKey(key))issues.push("Приватный ключ не соответствует сертификату.");}
  catch{issues.push("Не удалось проверить соответствие ключа сертификату.");}
  return {certificateConfigured:!!certPem,keyConfigured:!!keyPem,credentialsUsable:issues.length===0,
    issues,deliveryTested:false as const};
}
export async function incomingDevNotifications(owner:string) {
  const result=inspectAlertCredentials(process.env.APNS_ALERT_CERT_PEM,process.env.APNS_ALERT_KEY_PEM);
  const tokens=await db.select({environment:deviceTokens.environment,bundleId:deviceTokens.bundleId})
    .from(deviceTokens).where(and(eq(deviceTokens.userId,owner),eq(deviceTokens.platform,"ios_alert"),eq(deviceTokens.isActive,true)));
  const environments=Array.from(new Set(tokens.map(t=>t.environment??"production")));
  const bundleIds=Array.from(new Set(tokens.map(t=>t.bundleId??"app.talkhint")));
  if(!tokens.length)result.issues.push("Для этого владельца нет активного обычного iOS alert-токена. VoIP-токен не подходит.");
  return {...result,activeAlertDevices:tokens.length,deviceEnvironments:environments,bundleIds};
}
