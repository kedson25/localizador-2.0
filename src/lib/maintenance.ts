import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from './firebase-core';

export interface MaintenanceConfig {
  enabled: boolean;
  until: string;
  message: string;
  updatedAt?: string;
}

export const DEFAULT_MAINTENANCE_CONFIG: MaintenanceConfig = {
  enabled: false,
  until: '',
  message: 'Sistema em manutenção.',
};

const maintenanceRef = doc(db, 'app_config', 'maintenance');

export function isMaintenanceActive(config?: MaintenanceConfig | null, now = Date.now()) {
  if (!config?.enabled) return false;
  if (!config.until) return true;
  const until = new Date(config.until).getTime();
  return Number.isNaN(until) ? true : until > now;
}

export function listenMaintenanceConfig(
  callback: (config: MaintenanceConfig) => void,
  onError?: (error: unknown) => void,
) {
  return onSnapshot(maintenanceRef, snapshot => {
    if (!snapshot.exists()) {
      callback(DEFAULT_MAINTENANCE_CONFIG);
      return;
    }
    const data = snapshot.data() as Partial<MaintenanceConfig>;
    callback({
      enabled: data.enabled === true,
      until: String(data.until || ''),
      message: String(data.message || DEFAULT_MAINTENANCE_CONFIG.message),
      updatedAt: data.updatedAt ? String(data.updatedAt) : undefined,
    });
  }, error => {
    console.error('[Maintenance] listener indisponível:', error);
    onError?.(error);
  });
}

export async function saveMaintenanceConfig(config: MaintenanceConfig) {
  await setDoc(maintenanceRef, {
    enabled: config.enabled,
    until: config.until,
    message: config.message.trim() || DEFAULT_MAINTENANCE_CONFIG.message,
    updatedAt: new Date().toISOString(),
    modifiedAt: serverTimestamp(),
  }, { merge: true });
}
