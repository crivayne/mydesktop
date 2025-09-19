import { defineConfig, UserConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { viteStaticCopy } from "vite-plugin-static-copy";
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENV_PREFIX = "IMJS_";

export default defineConfig((): UserConfig => {
  // @crivayne/shared-ui 패키지의 실제 lib 경로를 ESM 방식으로 추적
  const sharedPkgJsonUrl = import.meta.resolve('@crivayne/shared-ui/package.json');
  const sharedPkgDir = path.dirname(fileURLToPath(sharedPkgJsonUrl));
  const sharedLibPosix = path.join(sharedPkgDir, 'lib').split(path.sep).join('/');
  
  return {
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
      preserveSymlinks: true,
      alias: [
        // 기존 SASS ~ 처리 규칙 유지
        { find: /^~(.*)$/, replacement: '$1' },

        // 패키지 루트/서브 경로 둘 다 lib로 강제 (workspace에서 소스가 아닌 빌드 아티팩트를 쓰게 함)
        { find: /^@crivayne\/shared-ui$/, replacement: `${sharedLibPosix}/index.js` },
        { find: /^@crivayne\/shared-ui\/(.*)$/, replacement: `${sharedLibPosix}/$1` },
      ],
      dedupe: ['react', 'react-dom'], // (권장) 중복 번들 방지
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
  };
});