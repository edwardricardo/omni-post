/**
 * @file useNotificationStream.ts
 * @description React hook that opens an EventSource connection to the backend SSE
 *              notification stream, handles automatic reconnection on error, and
 *              dispatches incoming events to the Zustand notification store.
 *
 *              NOTE: SSE cannot go through the Next.js proxy (it buffers the response).
 *              This hook connects directly to NEXT_PUBLIC_API_URL with withCredentials:true
 *              so the browser sends the customer-session cookie automatically.
 * @layer infrastructure
 */

"use client";

import { useEffect } from "react";
import { useNotificationStore } from "@/lib/stores/notificationStore";
import { env } from "../lib/env";

const SSE_URL = `${env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000"}/notifications/stream`;
const RECONNECT_DELAY_MS = 3_000;

/**
 * @hook useNotificationStream
 * @description Opens a persistent SSE connection for real-time notifications.
 *              Call this once at the dashboard layout level.
 * @param enabled - Set to false to disable the connection (e.g., when logged out)
 */
export function useNotificationStream(enabled = true): void {
  const addNotification = useNotificationStore((s) => s.addNotification);
  const setConnected = useNotificationStore((s) => s.setConnected);
  const setLastEventId = useNotificationStore((s) => s.setLastEventId);

  useEffect(() => {
    if (!enabled) return;

    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let active = true;

    function connect(): void {
      if (!active) return;

      es = new EventSource(SSE_URL, { withCredentials: true });

      es.onopen = () => {
        setConnected(true);
      };

      es.onmessage = (event: MessageEvent<string>) => {
        // Ignore heartbeat comments — EventSource strips leading ": " so we
        // check the data field for the heartbeat sentinel.
        if (!event.data || event.data === ":heartbeat") return;

        try {
          const notification = JSON.parse(
            event.data
          ) as import("@/lib/stores/notificationStore").NotificationItem;
          addNotification(notification);
          if (event.lastEventId) {
            setLastEventId(event.lastEventId);
          }
        } catch {
          // Ignore malformed events
        }
      };

      es.onerror = () => {
        setConnected(false);
        es?.close();
        es = null;

        if (active) {
          reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
        }
      };
    }

    connect();

    return () => {
      active = false;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      es?.close();
      setConnected(false);
    };
  }, [enabled, addNotification, setConnected, setLastEventId]);
}
