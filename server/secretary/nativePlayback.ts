import WebSocket from "ws";

type Turn = { id: string; itemId: string; tail: Buffer; frames: Buffer[]; abort: AbortController; generated: number;
  texts:Array<{text:string;through:number}>;liveMarking?:boolean;
  sent: number; startedAt?: number; ended: boolean; marking: boolean; played: boolean; text: string; saved: boolean };
/** Bounded 20ms Twilio playback, cancellable independently of model generation. */
export class SecretaryNativePlayback {
  private current?: Turn;
  private draining = false;
  private closed = false;
  private sequence = 0;
  constructor(private io: {
    ws: WebSocket; streamSid: () => string;
    waitMark: (name: string, signal: AbortSignal) => Promise<void>;
    truncate: (item: string, milliseconds: number) => void;
    playedText: (text: string) => void; audio: (payload: string) => void;
    fail: (reason: string) => void;
    continuous?:boolean;
  }) {}
  audio(id: string, itemId: string, mulaw: Buffer) {
    if (this.closed) return;
    if (this.current?.id !== id) {
      this.interrupt();
      this.current = { id, itemId, tail: Buffer.alloc(0), frames: [], abort: new AbortController(),
        sent: 0, generated: 0, ended: false, marking: false, played: false, text: "", saved: false,texts:[] };
    }
    const t = this.current!;
    if (t.ended || t.abort.signal.aborted) return;
    t.generated += mulaw.length;
    if (itemId) t.itemId = itemId;
    const bytes = Buffer.concat([t.tail, mulaw]);
    if (bytes.length + t.frames.length * 160 > 160_000) return this.io.fail("Secretary native audio queue exceeded twenty seconds");
    let offset = 0;
    for (; offset + 160 <= bytes.length; offset += 160) t.frames.push(bytes.subarray(offset, offset + 160));
    t.tail = bytes.subarray(offset);
    void this.pump();
  }
  done(id: string) {
    const t = this.current;
    if (!t || t.id !== id || t.ended || this.closed) return;
    t.ended = true;
    if (t.tail.length) { const frame = Buffer.alloc(160, 0xff); t.tail.copy(frame); t.frames.push(frame); t.tail = Buffer.alloc(0); }
    void this.pump();
  }
  transcript(id: string, text: string) {
    const t = this.current;
    if (!t || t.id !== id || this.closed) return;
    if(this.io.continuous){
      if(t.texts.length>=32)return this.io.fail("Secretary Live transcript queue exceeded its safety limit");
      t.texts.push({text,through:t.generated});this.markLive(t);return;
    }
    t.text = text; this.save(t);
  }
  private markLive(t:Turn){
    const pending=t.texts[0];
    if(!this.io.continuous||t.liveMarking||!pending||t.sent<pending.through||t.abort.signal.aborted||this.closed)return;
    t.liveMarking=true;t.texts.shift();
    const name=`secretary-live-${++this.sequence}`;
    const ack=this.io.waitMark(name,t.abort.signal);
    this.send({event:"mark",streamSid:this.io.streamSid(),mark:{name}});
    void ack.then(()=>{
      if(this.current===t&&!t.abort.signal.aborted&&!this.closed)this.io.playedText(pending.text);
    }).catch(()=>{/* interruption does not report unplayed text */}).finally(()=>{
      t.liveMarking=false;this.markLive(t);
    });
  }
  interrupt() {
    const t = this.current;
    this.current = undefined;
    if (!t) return;
    t.abort.abort(); t.frames = []; t.tail = Buffer.alloc(0);
    if (!t.played && t.sent > 0) {
      this.send({ event: "clear", streamSid: this.io.streamSid() });
      this.io.truncate(t.itemId, Math.min(t.sent / 8, t.generated / 8, Date.now() - (t.startedAt ?? Date.now())));
    }
  }
  close() { this.closed = true; this.current?.abort.abort(); this.current = undefined; }
  private async pump() {
    if (this.draining || this.closed || !this.current) return;
    const t = this.current;
    this.draining = true;
    try {
      while (this.current === t && t.frames.length && !t.abort.signal.aborted && !this.closed) {
        const frame = t.frames.shift()!, payload = frame.toString("base64");
        if (this.io.ws.bufferedAmount > 512 * 1024) throw new Error("Secretary Twilio audio buffer exceeded its safety limit");
        if (!this.send({ event: "media", streamSid: this.io.streamSid(), media: { payload } })) return;
        t.startedAt ??= Date.now(); t.sent += frame.length; this.io.audio(payload);
        this.markLive(t);
        await new Promise<void>((resolve, reject) => {
          const abort = () => { clearTimeout(timer); t.abort.signal.removeEventListener("abort", abort); reject(new Error("interrupted")); };
          const timer = setTimeout(() => { t.abort.signal.removeEventListener("abort", abort); resolve(); }, 20);
          t.abort.signal.addEventListener("abort", abort, { once: true });
          if (t.abort.signal.aborted) abort();
        });
      }
      if (this.current === t && t.ended && !t.marking && !t.abort.signal.aborted && t.sent) {
        t.marking = true;
        const name = `secretary-native-${++this.sequence}`;
        const ack = this.io.waitMark(name, t.abort.signal);
        this.send({ event: "mark", streamSid: this.io.streamSid(), mark: { name } });
        await ack;
        if (this.current === t && !t.abort.signal.aborted && !this.closed) { t.played = true; this.save(t); }
      }
    } catch (error) {
      if (!this.closed && !t.abort.signal.aborted) this.io.fail(error instanceof Error ? error.message : "Secretary native playback failed");
    } finally {
      this.draining = false;
      if (!this.closed && this.current && (this.current.frames.length || (this.current.sent > 0 && this.current.ended && !this.current.marking)))
        void this.pump();
    }
  }
  private save(t: Turn) {
    if (t.played && t.text && !t.saved && !this.closed && !t.abort.signal.aborted) {
      t.saved = true; this.io.playedText(t.text);
    }
  }
  private send(event: object) {
    if (this.io.ws.readyState !== WebSocket.OPEN) return false;
    this.io.ws.send(JSON.stringify(event)); return true;
  }
}
