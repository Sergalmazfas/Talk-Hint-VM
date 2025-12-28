import { type Call, type InsertCall } from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  getCall(id: string): Promise<Call | undefined>;
  getCallByCallSid(callSid: string): Promise<Call | undefined>;
  createCall(call: InsertCall): Promise<Call>;
  updateCall(id: string, updates: Partial<Call>): Promise<Call | undefined>;
  getAllCalls(): Promise<Call[]>;
}

export class MemStorage implements IStorage {
  private calls: Map<string, Call>;

  constructor() {
    this.calls = new Map();
  }

  async getCall(id: string): Promise<Call | undefined> {
    return this.calls.get(id);
  }

  async getCallByCallSid(callSid: string): Promise<Call | undefined> {
    return Array.from(this.calls.values()).find(
      (call) => call.callSid === callSid,
    );
  }

  async createCall(insertCall: InsertCall): Promise<Call> {
    const id = randomUUID();
    const call: Call = { 
      callSid: insertCall.callSid,
      fromNumber: insertCall.fromNumber,
      toNumber: insertCall.toNumber,
      status: insertCall.status || "active",
      id,
      startedAt: new Date(),
      endedAt: insertCall.endedAt || null,
      transcript: insertCall.transcript || null,
      metadata: insertCall.metadata || null
    };
    this.calls.set(id, call);
    return call;
  }

  async updateCall(id: string, updates: Partial<Call>): Promise<Call | undefined> {
    const call = this.calls.get(id);
    if (!call) return undefined;
    
    const updatedCall = { ...call, ...updates };
    this.calls.set(id, updatedCall);
    return updatedCall;
  }

  async getAllCalls(): Promise<Call[]> {
    return Array.from(this.calls.values());
  }
}

export const storage = new MemStorage();
