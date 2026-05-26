export interface IncomingCallPushPayload {
  callSid: string;
  fromNumber: string;
  userId: string;
}

export interface GenericPushPayload {
  title: string;
  body: string;
  data?: Record<string, any>;
}

export interface PushChannel {
  platform: string;
  isConfigured(): boolean;
  sendIncomingCall(token: string, payload: IncomingCallPushPayload): Promise<void>;
  sendGeneric?(token: string, payload: GenericPushPayload): Promise<void>;
}
