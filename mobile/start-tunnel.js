#!/usr/bin/env node
/**
 * Downloads bore binary (if needed), creates a TCP tunnel for Metro port,
 * then launches Expo bundler. Expo Go connects via exp://bore.pub:PORT
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const net = require('net');

const METRO_PORT = 8081;
const BORE_BIN = '/tmp/bore';
const BORE_SERVER = 'bore.pub';
const BORE_URL = 'https://github.com/ekzhang/bore/releases/download/v0.5.0/bore-v0.5.0-x86_64-unknown-linux-musl.tar.gz';

function log(msg) { console.log(`[tunnel] ${msg}`); }

async function ensureBore() {
  if (fs.existsSync(BORE_BIN)) { log('bore binary found'); return; }
  log('Downloading bore binary...');
  await new Promise((resolve, reject) => {
    const file = fs.createWriteStream('/tmp/bore.tar.gz');
    https.get(BORE_URL, (res) => {
      if (res.statusCode >= 300 && res.headers.location) {
        https.get(res.headers.location, (r) => { r.pipe(file); file.on('finish', resolve); });
      } else {
        res.pipe(file); file.on('finish', resolve);
      }
    }).on('error', reject);
  });
  execSync('tar -xzf /tmp/bore.tar.gz -C /tmp/ && chmod +x /tmp/bore');
  log('bore installed');
}

async function startBore() {
  return new Promise((resolve, reject) => {
    // Try fixed port 8081 first; bore.pub will assign a random one if taken
    const bore = spawn(BORE_BIN, ['local', String(METRO_PORT), '--to', BORE_SERVER], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let remotePort = null;
    const timeout = setTimeout(() => {
      if (!remotePort) reject(new Error('bore timed out - bore.pub may be unreachable'));
    }, 15000);

    function handleOutput(data) {
      const text = data.toString();
      process.stdout.write(`[bore] ${text}`);
      // bore outputs: "listening at bore.pub:NNNNN"
      const m = text.match(/bore\.pub:(\d+)/);
      if (m && !remotePort) {
        remotePort = parseInt(m[1], 10);
        clearTimeout(timeout);
        resolve({ bore, remotePort });
      }
    }

    bore.stdout.on('data', handleOutput);
    bore.stderr.on('data', handleOutput);
    bore.on('exit', (code) => {
      if (!remotePort) reject(new Error(`bore exited (code ${code})`));
    });
  });
}

async function main() {
  await ensureBore();

  log(`Starting bore TCP tunnel: localhost:${METRO_PORT} → bore.pub:?`);
  const { bore, remotePort } = await startBore();

  const expoUrl = `exp://${BORE_SERVER}:${remotePort}`;
  log(`\n${'━'.repeat(50)}`);
  log(`✅ Tunnel ready!`);
  log(`   Expo Go URL : ${expoUrl}`);
  log(`   bore.pub:${remotePort} → localhost:${METRO_PORT}`);
  log(`${'━'.repeat(50)}`);
  log(`   iPhone → Expo Go → Enter URL manually → ${expoUrl}\n`);

  // Persist for /expo page
  try { fs.writeFileSync('/tmp/expo-tunnel-url.txt', expoUrl, 'utf8'); } catch(_) {}

  bore.on('exit', () => log('bore tunnel closed'));

  // Start Metro bundler on same port
  log(`Starting Metro on port ${METRO_PORT} with hostname=${BORE_SERVER}\n`);

  const expo = spawn('npx', ['expo', 'start', '--port', String(METRO_PORT), '--lan'], {
    cwd: __dirname,
    env: {
      ...process.env,
      REACT_NATIVE_PACKAGER_HOSTNAME: BORE_SERVER,
    },
    stdio: 'inherit',
  });

  expo.on('exit', (code) => {
    log(`Metro exited (code ${code})`);
    bore.kill();
    process.exit(code ?? 0);
  });

  process.on('SIGTERM', () => { bore.kill(); expo.kill('SIGTERM'); });
  process.on('SIGINT',  () => { bore.kill(); expo.kill('SIGINT'); });
}

main().catch((err) => {
  console.error(`[tunnel] Fatal: ${err.message}`);
  process.exit(1);
});
