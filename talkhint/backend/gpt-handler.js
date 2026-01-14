import WebSocket from 'ws';
import { getRealtimePrompt } from '../shared/prompt-realtime.js';

export class GPTRealtimeHandler {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.OPENAI_API_KEY;
    this.mode = options.mode || 'universal';
    this.ws = null;
    this.isConnected = false;
    this.sessionId = null;
    
    this.onTranscript = options.onTranscript || (() => {});
    this.onResponse = options.onResponse || (() => {});
    this.onAudio = options.onAudio || (() => {});
    this.onError = options.onError || (() => {});
  }

  connect() {
    return new Promise((resolve, reject) => {
      const url = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01';
      
      this.ws = new WebSocket(url, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'OpenAI-Beta': 'realtime=v1'
        }
      });

      this.ws.on('open', () => {
        console.log('[gpt-handler] Connected to OpenAI Realtime API');
        this.isConnected = true;
        this.initSession();
        resolve();
      });

      this.ws.on('message', (data) => {
        this.handleMessage(JSON.parse(data.toString()));
      });

      this.ws.on('error', (err) => {
        console.error('[gpt-handler] WebSocket error:', err.message);
        this.onError(err);
        reject(err);
      });

      this.ws.on('close', () => {
        console.log('[gpt-handler] WebSocket closed');
        this.isConnected = false;
      });
    });
  }

  initSession() {
    const sessionConfig = {
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        instructions: this.getSystemPrompt(),
        voice: 'alloy',
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: {
          model: 'whisper-1'
        },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 700
        }
      }
    };

    this.send(sessionConfig);
  }

  getSystemPrompt() {
    return getRealtimePrompt(this.mode);
  }

  setMode(mode) {
    this.mode = mode;
    if (this.isConnected) {
      this.initSession();
    }
  }

  send(message) {
    if (this.ws && this.isConnected) {
      this.ws.send(JSON.stringify(message));
    }
  }

  sendAudio(base64PCM) {
    this.send({
      type: 'input_audio_buffer.append',
      audio: base64PCM
    });
  }

  commitAudio() {
    this.send({
      type: 'input_audio_buffer.commit'
    });
  }

  handleMessage(message) {
    switch (message.type) {
      case 'session.created':
        this.sessionId = message.session?.id;
        console.log('[gpt-handler] Session created:', this.sessionId);
        break;

      case 'session.updated':
        console.log('[gpt-handler] Session updated');
        break;

      case 'conversation.item.input_audio_transcription.completed':
        if (message.transcript) {
          console.log('[gpt-handler] Transcript (user):', message.transcript);
          this.onTranscript({
            role: 'user',
            text: message.transcript
          });
        }
        break;

      case 'response.audio_transcript.delta':
        if (message.delta) {
          this.onResponse({
            type: 'transcript_delta',
            text: message.delta
          });
        }
        break;

      case 'response.audio_transcript.done':
        if (message.transcript) {
          console.log('[gpt-handler] Transcript (assistant):', message.transcript);
          this.onTranscript({
            role: 'assistant',
            text: message.transcript
          });
        }
        break;

      case 'response.audio.delta':
        if (message.delta) {
          this.onAudio(message.delta);
        }
        break;

      case 'response.audio.done':
        console.log('[gpt-handler] Audio response complete');
        break;

      case 'response.done':
        console.log('[gpt-handler] Response complete');
        break;

      case 'error':
        console.error('[gpt-handler] API Error:', message.error);
        this.onError(message.error);
        break;

      default:
        break;
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
    }
  }
}
