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

export interface PushSendOptions {
  // APNs has separate sandbox/production hosts. VoIP certs work for both,
  // but each device token is bound to the environment of the build that
  // produced it. Defaults to "production" when unknown.
  environment?: string;
}

export interface PushChannel {
  platform: string;
  isConfigured(): boolean;
  sendIncomingCall(
    token: string,
    payload: IncomingCallPushPayload,
    options?: PushSendOptions
  ): Promise<void>;
  sendGeneric?(token: string, payload: GenericPushPayload): Promise<void>;
}
