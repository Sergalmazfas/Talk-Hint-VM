import {describe,it,expect,vi} from "vitest";
import {readFileSync} from "node:fs";
import {deliverSecretaryNotificationOnce} from "../secretary/notificationAttempt";
describe("Secretary notification: no blind retries",()=>{
 it("marks success only after actual successful delivery",async()=>{
  const deliver=vi.fn(async()=>{}),sent=vi.fn(async()=>{}),unknown=vi.fn(async()=>{});
  expect(await deliverSecretaryNotificationOnce(deliver,sent,unknown,vi.fn())).toBe(true);
  expect(deliver).toHaveBeenCalledTimes(1);expect(sent).toHaveBeenCalledTimes(1);expect(unknown).not.toHaveBeenCalled();
 });
 it("retains unknown instead of requeueing missing certificate or transport failure",async()=>{
  for(const message of ["Ordinary APNs alert certificate not configured","timeout after send"]){
   const deliver=vi.fn(async()=>{throw Error(message)}),sent=vi.fn(async()=>{}),unknown=vi.fn(async()=>{});
   expect(await deliverSecretaryNotificationOnce(deliver,sent,unknown,vi.fn())).toBe(false);
   expect(deliver).toHaveBeenCalledTimes(1);expect(sent).not.toHaveBeenCalled();expect(unknown).toHaveBeenCalledTimes(1);
  }
 });
 it("does not repeat provider delivery if saving its receipt fails",async()=>{
  const deliver=vi.fn(async()=>{}),sent=vi.fn(async()=>{throw Error("db")}),unknown=vi.fn(async()=>{});
  expect(await deliverSecretaryNotificationOnce(deliver,sent,unknown,vi.fn())).toBe(false);
  expect(deliver).toHaveBeenCalledTimes(1);expect(unknown).toHaveBeenCalledTimes(1);
 });
 it("SQL claim excludes uncertain sends; expired claims become unknown, not retryable",()=>{
  const source=readFileSync("server/secretary/tasks.ts","utf8").split("async function notifyTerminalTasks")[1].split("export async function processSecretaryTasks")[0];
  expect(source).toContain("SET notification_status = 'unknown'");
  expect(source).toContain("AND notification_status = 'pending'");
  expect(source).not.toContain("OR (notification_status = 'sending'");
  expect(source).not.toContain('notificationStatus: "pending"');
 });
});
