import { useState, useCallback, useRef } from 'react';
import { Audio } from 'expo-av';
import { Alert } from 'react-native';
import { wsClient } from '../services/websocket';
import { useAppStore } from '../store/appStore';

export function useMicrophone() {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const setMicActive = useAppStore((s) => s.setMicActive);
  const isMicActive = useAppStore((s) => s.isMicActive);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      const granted = status === 'granted';
      setHasPermission(granted);
      if (!granted) {
        Alert.alert(
          'Microphone Required',
          'TalkHint needs microphone access to transcribe your calls. Please enable it in iPhone Settings → Privacy → Microphone.',
          [{ text: 'OK' }]
        );
      }
      return granted;
    } catch (e) {
      console.error('[Mic] Permission error:', e);
      return false;
    }
  }, []);

  const startRecording = useCallback(async () => {
    const granted = hasPermission ?? (await requestPermission());
    if (!granted) return;

    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );

      recordingRef.current = recording;
      setMicActive(true);
      wsClient.send({ type: 'start', sessionId: Date.now().toString(36) });
    } catch (err) {
      console.error('[Mic] Start error:', err);
      setMicActive(false);
    }
  }, [hasPermission, requestPermission, setMicActive]);

  const stopRecording = useCallback(async () => {
    const rec = recordingRef.current;
    if (!rec) return;

    recordingRef.current = null;
    setMicActive(false);

    try {
      await rec.stopAndUnloadAsync();
    } catch (err) {
      console.error('[Mic] Stop error:', err);
    }

    // Restore audio mode safely
    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
    } catch {}
  }, [setMicActive]);

  const toggleMic = useCallback(async () => {
    if (isMicActive) {
      await stopRecording();
    } else {
      await startRecording();
    }
  }, [isMicActive, startRecording, stopRecording]);

  return {
    hasPermission,
    isMicActive,
    requestPermission,
    toggleMic,
    startRecording,
    stopRecording,
  };
}
