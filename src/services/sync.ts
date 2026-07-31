/**
 * Server → store hydration.
 *
 * In server mode the backend is the source of truth and the persisted
 * Zustand stores act as an offline cache. This pulls the authoritative
 * state after login and on app start; each fetch fails independently so a
 * flaky connection degrades to cached data instead of wiping anything.
 * (Lives outside the stores to keep the store dependency graph one-way.)
 */

import { isServerMode } from '../config';
import { useEscrowStore } from '../stores/useEscrowStore';
import { useFastagStore } from '../stores/useFastagStore';
import { useLoadsStore } from '../stores/useLoadsStore';
import { useNotificationsStore } from '../stores/useNotificationsStore';
import { api } from './api';

export async function syncFromServer(): Promise<void> {
  if (!isServerMode) return;

  const [loads, shipments, fastag] = await Promise.all([
    api.fetchLoads().catch(() => null),
    api.fetchShipments().catch(() => null),
    api.fetchFastag().catch(() => null),
    useNotificationsStore.getState().refresh(),
  ]);

  if (loads) useLoadsStore.setState({ loads });
  if (shipments) useEscrowStore.setState({ shipments });
  if (fastag) {
    useFastagStore.setState({
      balanceInr: fastag.balanceInr,
      transactions: fastag.transactions,
      ...(fastag.autoRecharge ? { autoRecharge: fastag.autoRecharge } : {}),
    });
  }
}
