import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: { include: ['three','three/examples/jsm/geometries/TextGeometry.js','three/examples/jsm/loaders/FontLoader.js','three/examples/jsm/utils/BufferGeometryUtils.js','three/examples/jsm/environments/RoomEnvironment.js','three/examples/jsm/loaders/HDRLoader.js'] },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    watch: { ignored: ['**/.tools/**', '**/data/**', '**/previews/**', '**/playwright-report/**', '**/test-results/**'] },
    proxy: { '/api': 'http://127.0.0.1:3001' },
  },
});
