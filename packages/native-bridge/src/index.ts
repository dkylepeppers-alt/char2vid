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

export {
  exportRevision,
  type ExportDestination,
  type ExportRevisionOptions,
  type ExportRevisionRequest,
  type ExportRevisionResult,
} from './media-export';

export {
  exportArchiveNative,
  inspectArchiveNative,
  importArchiveNative,
  type ArchiveScope,
  type ExportArchiveRequest,
  type ExportArchiveNativeResult,
  type InspectArchiveNativeResult,
  type ImportArchiveNativeResult,
} from './archive';

export {
  NativeLibraryPort,
  getNativeLibrary,
  isNativeLibraryAvailable,
} from './library';

export {
  saveNativeServiceSession,
  loadNativeServiceSession,
  clearNativeServiceSession,
  saveNativeProviderKey,
  hasNativeProviderKey,
  nativeProviderKeyLast4,
  clearNativeProviderKey,
  type ServiceSessionCredential,
} from './credentials';

export {
  enqueueNativeJob,
  listNativeJobs,
  cancelNativeJob,
  type NativeJobView,
  type NativeFrozenRequest,
} from './jobs';
