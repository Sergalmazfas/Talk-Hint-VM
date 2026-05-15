import { useEffect, useCallback } from 'react';
import { wsClient } from '../services/websocket';
import { useAppStore } from '../store/appStore';

export function useWebSocket() {
  const serverUrl = useAppStore((s) => s.serverUrl);
  const isConnected = useAppStore((s) => s.isConnected);

  useEffect(() => {
    if (serverUrl) {
      wsClient.connect(serverUrl);
    }
    return () => {
      wsClient.disconnect();
    };
  }, [serverUrl]);

  const send = useCallback((data: object) => {
    wsClient.send(data);
  }, []);

  const setGoal = useCallback((goal: string) => {
    useAppStore.getState().setGoal(goal);
    wsClient.send({ type: 'set_goal', goal });
  }, []);

  const setLanguage = useCallback((language: 'ru' | 'es') => {
    useAppStore.getState().setLanguage(language);
    wsClient.send({ type: 'set_language', language });
  }, []);

  const askAI = useCallback((question: string) => {
    wsClient.send({ type: 'ask_ai', question });
  }, []);

  return { isConnected, send, setGoal, setLanguage, askAI };
}
