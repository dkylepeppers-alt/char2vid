import { App } from '@capacitor/app';

export interface NativeBackHandle {
  remove(): Promise<void>;
}

export async function listenForNativeBack(
  listener: (canGoBack: boolean) => void,
): Promise<NativeBackHandle> {
  return App.addListener('backButton', ({ canGoBack }) => listener(canGoBack));
}

export async function exitNativeApp(): Promise<void> {
  await App.exitApp();
}
