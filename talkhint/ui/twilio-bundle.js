import { Device } from '@twilio/voice-sdk';

(function() {
  window.TwilioDevice = Device;
  console.log('[TalkHint] Twilio Voice SDK loaded, TwilioDevice:', typeof Device);
})();
