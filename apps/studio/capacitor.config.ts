import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.char2vid.studio',
  appName: 'char2vid',
  webDir: 'dist',
  android: {
    backgroundColor: '#101210',
    zoomEnabled: false,
  },
};

export default config;
