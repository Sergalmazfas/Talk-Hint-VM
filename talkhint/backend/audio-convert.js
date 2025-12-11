import { spawn } from 'child_process';
import { PassThrough } from 'stream';

export class AudioConverter {
  constructor() {
    this.ffmpeg = null;
    this.inputStream = null;
    this.outputStream = null;
  }

  start() {
    this.inputStream = new PassThrough();
    this.outputStream = new PassThrough();

    this.ffmpeg = spawn('ffmpeg', [
      '-f', 'mulaw',
      '-ar', '8000',
      '-ac', '1',
      '-i', 'pipe:0',
      '-f', 's16le',
      '-ar', '16000',
      '-ac', '1',
      'pipe:1'
    ], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.inputStream.pipe(this.ffmpeg.stdin);
    this.ffmpeg.stdout.pipe(this.outputStream);

    this.ffmpeg.stderr.on('data', (data) => {
    });

    this.ffmpeg.on('error', (err) => {
      console.error('[audio-convert] ffmpeg error:', err.message);
    });

    this.ffmpeg.on('close', (code) => {
      console.log(`[audio-convert] ffmpeg closed with code ${code}`);
    });

    return this;
  }

  writeBase64Chunk(base64Payload) {
    if (!this.inputStream) return;
    
    const buffer = Buffer.from(base64Payload, 'base64');
    this.inputStream.write(buffer);
  }

  getOutputStream() {
    return this.outputStream;
  }

  stop() {
    if (this.inputStream) {
      this.inputStream.end();
    }
    if (this.ffmpeg) {
      this.ffmpeg.kill('SIGTERM');
    }
  }
}

export function convertMulawToPCM16(base64Payload) {
  return new Promise((resolve, reject) => {
    const inputBuffer = Buffer.from(base64Payload, 'base64');
    
    const ffmpeg = spawn('ffmpeg', [
      '-f', 'mulaw',
      '-ar', '8000',
      '-ac', '1',
      '-i', 'pipe:0',
      '-f', 's16le',
      '-ar', '16000',
      '-ac', '1',
      'pipe:1'
    ], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const chunks = [];

    ffmpeg.stdout.on('data', (chunk) => {
      chunks.push(chunk);
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        const pcmBuffer = Buffer.concat(chunks);
        resolve(pcmBuffer.toString('base64'));
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });

    ffmpeg.on('error', reject);

    ffmpeg.stdin.write(inputBuffer);
    ffmpeg.stdin.end();
  });
}

export function convertPCM16ToMulaw(base64PCM) {
  return new Promise((resolve, reject) => {
    const inputBuffer = Buffer.from(base64PCM, 'base64');
    
    const ffmpeg = spawn('ffmpeg', [
      '-f', 's16le',
      '-ar', '16000',
      '-ac', '1',
      '-i', 'pipe:0',
      '-f', 'mulaw',
      '-ar', '8000',
      '-ac', '1',
      'pipe:1'
    ], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const chunks = [];

    ffmpeg.stdout.on('data', (chunk) => {
      chunks.push(chunk);
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        const mulawBuffer = Buffer.concat(chunks);
        resolve(mulawBuffer.toString('base64'));
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });

    ffmpeg.on('error', reject);

    ffmpeg.stdin.write(inputBuffer);
    ffmpeg.stdin.end();
  });
}
