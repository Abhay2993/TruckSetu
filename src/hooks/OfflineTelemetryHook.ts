/**
 * Feature D — Offline-first GPS telemetry (deliverable 2).
 *
 * `useOfflineTelemetry` is the single integration point between:
 *   • NetInfo        — reachability signal,
 *   • useTelemetryStore — the AsyncStorage-persisted point queue,
 *   • api            — the (mock) backend.
 *
 * Behaviour:
 *   ONLINE  → recordPoint() pushes the fix straight to the backend; if that
 *             push fails mid-flight the point falls back into the queue, so
 *             a fix is never dropped.
 *   OFFLINE → recordPoint() appends the fix to the persisted local cache.
 *   OFFLINE→ONLINE transition (or new points arriving while online) fires
 *             the flush effect: the whole cache is sent as one batch and
 *             only the points that were actually in that batch are drained.
 *
 * Concurrency: `flushInFlight` (a ref, not state — it must not trigger
 * re-renders and must be readable synchronously) guarantees a single flush
 * at a time even if NetInfo flaps rapidly.
 */

import NetInfo from '@react-native-community/netinfo';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { useTelemetryStore } from '../stores/useTelemetryStore';
import type { TelemetryPoint } from '../types';

export interface OfflineTelemetry {
  /** Record a GPS fix — routes to live push or offline cache automatically. */
  recordPoint: (point: TelemetryPoint) => void;
  /** Force a flush attempt (e.g. pull-to-refresh). Safe to call anytime. */
  flushNow: () => Promise<void>;
  isOnline: boolean;
  isSyncing: boolean;
  /** Points currently cached on-device awaiting sync. */
  queuedCount: number;
  /** Lifetime count of points confirmed by the backend. */
  totalSyncedCount: number;
  lastSyncAt: number | null;
}

export function useOfflineTelemetry(): OfflineTelemetry {
  // Optimistic default: assume online until NetInfo says otherwise, so the
  // first fixes of a trip aren't needlessly queued.
  const [isOnline, setIsOnline] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const flushInFlight = useRef(false);
  // Mirrors isOnline for use inside stable callbacks without re-creating them.
  const isOnlineRef = useRef(true);

  const queuedCount = useTelemetryStore((s) => s.queue.length);
  const totalSyncedCount = useTelemetryStore((s) => s.totalSyncedCount);
  const lastSyncAt = useTelemetryStore((s) => s.lastSyncAt);

  // --- Reachability subscription -----------------------------------------
  useEffect(() => {
    const applyState = (connected: boolean | null, reachable: boolean | null | undefined) => {
      // Treat "connected but internet unverified" as online; only a hard
      // negative from either signal flips us offline.
      const online = Boolean(connected) && reachable !== false;
      isOnlineRef.current = online;
      setIsOnline(online);
    };

    // Seed with the current state (the listener only fires on *changes*).
    NetInfo.fetch()
      .then((state) => applyState(state.isConnected, state.isInternetReachable))
      .catch(() => {
        /* keep optimistic default */
      });

    const unsubscribe = NetInfo.addEventListener((state) =>
      applyState(state.isConnected, state.isInternetReachable),
    );
    return unsubscribe; // prevents leaked listeners on unmount
  }, []);

  // --- Flush --------------------------------------------------------------
  const flushNow = useCallback(async () => {
    if (flushInFlight.current || !isOnlineRef.current) return;

    // Snapshot via getState() rather than a hook subscription: the flush
    // must see the queue as-of-now, and new points appended during the
    // network call must survive the drain.
    const batch = useTelemetryStore.getState().queue;
    if (batch.length === 0) return;

    flushInFlight.current = true;
    setIsSyncing(true);
    try {
      const result = await api.syncTelemetryBatch(batch);
      useTelemetryStore.getState().drain(batch.length, result.syncedAt);
    } catch (error) {
      // Keep the queue intact — the next connectivity event or recorded
      // point retries automatically. At-least-once, never data loss.
      console.warn('[telemetry] batch sync failed, will retry', error);
    } finally {
      flushInFlight.current = false;
      setIsSyncing(false);
    }
  }, []);

  // Fires on the offline→online edge AND whenever points exist while online
  // (covers points queued during a failed flush or a live-push fallback).
  useEffect(() => {
    if (isOnline && queuedCount > 0) {
      void flushNow();
    }
  }, [isOnline, queuedCount, flushNow]);

  // --- Capture ------------------------------------------------------------
  const recordPoint = useCallback((point: TelemetryPoint) => {
    if (isOnlineRef.current) {
      // Live path: push immediately; on failure the point joins the queue
      // instead of being lost.
      api.pushTelemetryLive(point).catch(() => {
        useTelemetryStore.getState().enqueue(point);
      });
    } else {
      useTelemetryStore.getState().enqueue(point);
    }
  }, []);

  return {
    recordPoint,
    flushNow,
    isOnline,
    isSyncing,
    queuedCount,
    totalSyncedCount,
    lastSyncAt,
  };
}
