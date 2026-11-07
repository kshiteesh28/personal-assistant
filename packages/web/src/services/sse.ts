import { useEffect, useRef } from 'react';
import { getAuthToken } from './api';

export function useEventStream(onEvent: (type: string, payload: any) => void) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    let abortController = new AbortController();
    let reconnectTimeout: any;

    const connect = async () => {
      try {
        const res = await fetch('/api/events/stream', {
          headers: { 'Authorization': `Bearer ${getAuthToken()}` },
          signal: abortController.signal
        });

        if (!res.body) return;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() || '';
          
          for (const part of parts) {
            if (part.startsWith('data:')) {
              const dataStr = part.slice(5).trim();
              if (dataStr && dataStr !== 'keepalive') {
                try {
                  const data = JSON.parse(dataStr);
                  onEventRef.current(data.type, data.payload);
                } catch (e) {
                  // Ignore JSON parse err
                }
              }
            }
          }
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          reconnectTimeout = setTimeout(connect, 3000);
        }
      }
    };

    connect();

    return () => {
      abortController.abort();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, []);
}
