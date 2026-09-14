import { Capacitor } from '@capacitor/core';

import type { NativeBackHandle } from '@char2vid/native-bridge';

export type Platform = 'android' | 'web';

export function resolvePlatform(): Platform {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
    ? 'android'
    : 'web';
}

export async function listenForAndroidBack(
  listener: (canGoBack: boolean) => void,
): Promise<NativeBackHandle | undefined> {
  if (resolvePlatform() !== 'android') {
    return undefined;
  }

  const { listenForNativeBack } = await import('@char2vid/native-bridge');
  return listenForNativeBack(listener);
}

export async function exitAndroidApp(): Promise<void> {
  if (resolvePlatform() !== 'android') {
    return;
  }

  const { exitNativeApp } = await import('@char2vid/native-bridge');
  await exitNativeApp();
}
