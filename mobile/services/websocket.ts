import { useAppStore } from '../store/appStore';

type MessageHandler = (msg: any) => void;

// WebSocket readyState constants (matches both DOM and React Native)
const WS_OPEN = 1;

class TalkHintWebSocket {
  private ws: WebSocket | null = null;
  private url: string = '';
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private handlers: Set<MessageHandler> = new Set();
  private intentionallyClosed = false;

  connect(serverUrl: string) {
    this.intentionallyClosed = false;
    // Replace http(s) with ws(s) for WebSocket URL
    const wsUrl = serverUrl
      .replace(/^https:\/\//, 'wss://')
      .replace(/^http:\/\//, 'ws://')
      .replace(/\/$/, '');
    this.url = `${wsUrl}/ui`;

    this.cleanup();

    try {
      this.ws = new (global as any).WebSocket(this.url);
    } catch (e) {
      console.error('[WS] Failed to create WebSocket:', e);
      return;
    }

    this.ws!.onopen = () => {
      console.log('[WS] Connected to TalkHint backend:', this.url);
      useAppStore.getState().setConnected(true);
      const { language, goal } = useAppStore.getState();
      if (language) this.send({ type: 'set_language', language });
      if (goal) this.send({ type: 'set_goal', goal });
    };

    this.ws!.onmessage = (event: any) => {
      try {
        const msg = JSON.parse(event.data);
        this.handlers.forEach((h) => h(msg));
        this.handleInternal(msg);
      } catch {
        // ignore malformed messages
      }
    };

    this.ws!.onclose = () => {
      console.log('[WS] Disconnected');
      useAppStore.getState().setConnected(false);
      if (!this.intentionallyClosed) {
        this.reconnectTimer = setTimeout(() => this.connect(serverUrl), 3000);
      }
    };

    this.ws!.onerror = (err: any) => {
      console.log('[WS] Error', err);
    };
  }

  private handleInternal(msg: any) {
    const store = useAppStore.getState();

    switch (msg.type) {
      case 'guest_transcript':
        if (msg.text) {
          store.addTranscript({ speaker: 'gst', text: msg.text, isFinal: msg.isFinal ?? true });
        }
        break;

      case 'owner_transcript':
      case 'hon_transcript':
        if (msg.text) {
          store.addTranscript({ speaker: 'hon', text: msg.text, isFinal: msg.isFinal ?? true });
        }
        break;

      case 'translation':
        if (msg.translation) {
          store.addTranscript({
            speaker: 'gst',
            text: msg.original || '',
            translation: msg.translation,
            isFinal: true,
          });
        }
        break;

      case 'hint':
        if (msg.suggestion) {
          store.setHints([{ en: msg.suggestion.en || '', translation: msg.suggestion.translation || '' }]);
        }
        break;

      case 'hints':
        if (Array.isArray(msg.hints)) {
          store.setHints(msg.hints);
        }
        break;

      case 'goal_state_update':
        store.setGoalState(msg);
        break;

      case 'goal_achieved':
        store.setGoalAchieved(true);
        break;
    }
  }

  send(data: object) {
    if (this.ws && this.ws.readyState === WS_OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  addHandler(h: MessageHandler) {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  disconnect() {
    this.intentionallyClosed = true;
    this.cleanup();
    useAppStore.getState().setConnected(false);
  }

  private cleanup() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
  }
}

export const wsClient = new TalkHintWebSocket();
