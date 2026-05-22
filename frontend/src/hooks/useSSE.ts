import { useEffect, useRef } from 'react';

type SSEHandler = (data: unknown) => void;

/**
 * Subscribes to the backend SSE stream and fires the given handler whenever
 * the specified event arrives. Automatically reconnects on disconnect.
 */
export function useSSE(event: string, handler: SSEHandler): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let destroyed = false;

    function connect() {
      const token = localStorage.getItem('access_token');
      if (!token) return;

      es = new EventSource(`/api/events/stream?token=${encodeURIComponent(token)}`);

      es.addEventListener(event, (e: MessageEvent) => {
        try {
          handlerRef.current(JSON.parse(e.data));
        } catch {
          handlerRef.current(null);
        }
      });

      es.onerror = () => {
        es?.close();
        es = null;
        if (!destroyed) {
          reconnectTimeout = setTimeout(connect, 5_000);
        }
      };
    }

    connect();

    return () => {
      destroyed = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      es?.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event]);
}
