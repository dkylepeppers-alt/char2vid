import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * App-service session credential and on-device provider key.
 * On Android both are Keystore-backed and excluded from portable backups.
 * The Nano-GPT key uses a separate blob from the device session token.
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
  saveProviderKey(options: { apiKey: string }): Promise<{
    stored: true;
    last4: string | null;
  }>;
  hasProviderKey(): Promise<{ stored: boolean; last4: string | null }>;
  clearProviderKey(): Promise<{ cleared: true }>;
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

export async function saveNativeProviderKey(
  apiKey: string,
): Promise<string | undefined> {
  if (!isAndroidNative()) {
    throw new Error('Native provider keys require Android Keystore');
  }
  const result = await Char2vidCredentials.saveProviderKey({ apiKey });
  return result.last4 ?? undefined;
}

export async function hasNativeProviderKey(): Promise<boolean> {
  if (!isAndroidNative()) {
    return false;
  }
  const result = await Char2vidCredentials.hasProviderKey();
  return result.stored === true;
}

export async function nativeProviderKeyLast4(): Promise<string | undefined> {
  if (!isAndroidNative()) {
    return undefined;
  }
  const result = await Char2vidCredentials.hasProviderKey();
  return result.last4 ?? undefined;
}

export async function clearNativeProviderKey(): Promise<void> {
  if (!isAndroidNative()) {
    return;
  }
  await Char2vidCredentials.clearProviderKey();
}
