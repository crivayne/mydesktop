import { defineConfig, UserConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { viteStaticCopy } from "vite-plugin-static-copy";
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENV_PREFIX = "IMJS_";

export default defineConfig({
  
  build: {
    chunkSizeWarningLimit: 9000, // Increase chunk size warning limit to avoid warnings for large chunks
  },
  server: {
    port: 3000,
    strictPort: true, // exit if port is already in use
    proxy: { "/itwin/api": { target: "http://127.0.0.1", changeOrigin: true } }
  },
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        {
          // copy assets from `@itwin` dependencies
          src: "./node_modules/**/@itwin/*/lib/public/*",
          dest: ".",
        },
      ],
    }),
    nodePolyfills({
      include: ["fs", "path"]
    })
  ],
  resolve: {
    alias: [
      { find: /^~(.*)$/, replacement: "$1" },
      {
        find: "@shared",
        replacement: path.resolve(__dirname, "../../packages/shared-ui/src"),
      },
    ],
    preserveSymlinks: true,
    dedupe: ['react', 'react-dom'], // (권장) 중복 번들 방지
  },
  css: {
    // 선택: 경고 조용히
    preprocessorOptions: { scss: { quietDeps: true } },
  },
  

  optimizeDeps: {
    include: [
      "@crivayne/shared-ui",
      '@remix-run/router',
      'react-error-boundary',
      'classnames',
      'fuse.js',
      '@itwin/reality-data-client',
      '@floating-ui/react',
      'lodash.isequal',
      'wms-capabilities',
      'react-table',
    ],
  },
  envPrefix: ENV_PREFIX,
});