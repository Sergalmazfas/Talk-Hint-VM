function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function formatTimestamp(date = new Date()) {
  return date.toISOString();
}

function log(source, message, data = null) {
  const timestamp = new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  
  if (data) {
    console.log(`${timestamp} [${source}] ${message}`, data);
  } else {
    console.log(`${timestamp} [${source}] ${message}`);
  }
}

function base64ToBuffer(base64) {
  return Buffer.from(base64, 'base64');
}

function bufferToBase64(buffer) {
  return buffer.toString('base64');
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  generateId,
  formatTimestamp,
  log,
  base64ToBuffer,
  bufferToBase64,
  delay
};
