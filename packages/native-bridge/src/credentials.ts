import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * App-service session credential. On Android this is Keystore-backed and
 * excluded from portable backups. The Nano-GPT provider key never lives here.
 */
export interface ServiceSessionCredential {
  deviceToken: string;
  deviceId: string;
  serviceOrigin: string;
}

interface Char2vidCredentialsPlugin {
  saveSession(options: ServiceSessionCredential): Promise<{ stored: true }>;
  loadSession(): Promise<{
    deviceToken: string | null;
    deviceId: string | null;
    serviceOrigin: string | null;
  }>;
  clearSession(): Promise<{ cleared: true }>;
}

const Char2vidCredentials = registerPlugin<Char2vidCredentialsPlugin>(
  'Char2vidCredentials',
);

function isAndroidNative(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export async function saveNativeServiceSession(
  credential: ServiceSessionCredential,
): Promise<void> {
  if (!isAndroidNative()) {
    throw new Error('Native service credentials require Android Keystore');
  }
  await Char2vidCredentials.saveSession(credential);
}

export async function loadNativeServiceSession(): Promise<
  ServiceSessionCredential | undefined
> {
  if (!isAndroidNative()) {
    return undefined;
  }
  const stored = await Char2vidCredentials.loadSession();
  if (!stored.deviceToken || !stored.deviceId || !stored.serviceOrigin) {
    return undefined;
  }
  return {
    deviceToken: stored.deviceToken,
    deviceId: stored.deviceId,
    serviceOrigin: stored.serviceOrigin,
  };
}

export async function clearNativeServiceSession(): Promise<void> {
  if (!isAndroidNative()) {
    return;
  }
  await Char2vidCredentials.clearSession();
}
