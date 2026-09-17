export type MediaImportMode = 'native-picker' | 'file-input';

export function selectMediaImportMode(
  platform: 'android' | 'web',
): MediaImportMode {
  return platform === 'android' ? 'native-picker' : 'file-input';
}

export function collapseOptionalRemoteService(
  platform: 'android' | 'web',
): boolean {
  return platform === 'android';
}
