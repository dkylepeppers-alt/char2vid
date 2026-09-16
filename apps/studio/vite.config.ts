import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const packagesDir = path.resolve(rootDir, '../../packages');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: '@char2vid/domain/storage',
        replacement: path.join(packagesDir, 'domain/src/storage.ts'),
      },
      {
        find: '@char2vid/domain/library-query',
        replacement: path.join(packagesDir, 'domain/src/library-query.ts'),
      },
      {
        find: '@char2vid/domain/library-actions',
        replacement: path.join(packagesDir, 'domain/src/library-actions.ts'),
      },
      {
        find: '@char2vid/domain/asset-schema',
        replacement: path.join(packagesDir, 'domain/src/asset-schema.ts'),
      },
      {
        find: '@char2vid/domain/archive-schema',
        replacement: path.join(packagesDir, 'domain/src/archive-schema.ts'),
      },
      {
        find: '@char2vid/domain/archive-remap',
        replacement: path.join(packagesDir, 'domain/src/archive-remap.ts'),
      },
      {
        find: '@char2vid/domain/characters/schema',
        replacement: path.join(packagesDir, 'domain/src/characters/schema.ts'),
      },
      {
        find: '@char2vid/domain/characters/revisions',
        replacement: path.join(
          packagesDir,
          'domain/src/characters/revisions.ts',
        ),
      },
      {
        find: '@char2vid/domain/characters/looks',
        replacement: path.join(packagesDir, 'domain/src/characters/looks.ts'),
      },
      {
        find: '@char2vid/domain/characters/port',
        replacement: path.join(packagesDir, 'domain/src/characters/port.ts'),
      },
      {
        find: '@char2vid/domain/characters',
        replacement: path.join(packagesDir, 'domain/src/characters/index.ts'),
      },
      {
        find: '@char2vid/domain',
        replacement: path.join(packagesDir, 'domain/src/contracts.ts'),
      },
      {
        find: '@char2vid/storage-web/archive',
        replacement: path.join(packagesDir, 'storage-web/src/archive.ts'),
      },
      {
        find: '@char2vid/storage-web/library',
        replacement: path.join(packagesDir, 'storage-web/src/library.ts'),
      },
      {
        find: '@char2vid/storage-web/files',
        replacement: path.join(packagesDir, 'storage-web/src/files.ts'),
      },
      {
        find: '@char2vid/storage-web',
        replacement: path.join(packagesDir, 'storage-web/src/index.ts'),
      },
      {
        find: '@char2vid/native-bridge/media-export',
        replacement: path.join(
          packagesDir,
          'native-bridge/src/media-export.ts',
        ),
      },
      {
        find: '@char2vid/native-bridge/archive',
        replacement: path.join(packagesDir, 'native-bridge/src/archive.ts'),
      },
      {
        find: '@char2vid/native-bridge/library',
        replacement: path.join(packagesDir, 'native-bridge/src/library.ts'),
      },
      {
        find: '@char2vid/native-bridge/credentials',
        replacement: path.join(packagesDir, 'native-bridge/src/credentials.ts'),
      },
      {
        find: '@char2vid/native-bridge/jobs',
        replacement: path.join(packagesDir, 'native-bridge/src/jobs.ts'),
      },
      {
        find: '@char2vid/native-bridge',
        replacement: path.join(packagesDir, 'native-bridge/src/index.ts'),
      },
      {
        find: '@char2vid/nanogpt',
        replacement: path.join(packagesDir, 'nanogpt/src/index.ts'),
      },
    ],
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  optimizeDeps: {
    include: ['dexie', 'fflate'],
  },
  server: {
    proxy: {
      '/studio-api': 'http://127.0.0.1:8787',
      '/studio-media': 'http://127.0.0.1:8787',
      '/__fake': 'http://127.0.0.1:8787',
    },
  },
});
