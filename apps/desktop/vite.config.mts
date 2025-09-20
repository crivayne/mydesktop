import { defineConfig, UserConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { viteStaticCopy } from "vite-plugin-static-copy";
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENV_PREFIX = "IMJS_";

export default defineConfig(({ command, mode }): UserConfig => {
  const isDev = command === 'serve' || mode === 'development';
  
  return {
    build: {
      chunkSizeWarningLimit: 9000, // Increase chunk size warning limit to avoid warnings for large chunks

      commonjsOptions: {
        // CJS의 module.exports 를 ESM default로 매핑
        defaultIsModuleExports: true,
        // ESM/CJS 섞인 모듈도 변환
        transformMixedEsModules: true,
      }
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
        { find: /^@itwin\/core-common$/, replacement: fileURLToPath(new URL('./shims/core-common-compat.ts', import.meta.url)) },
        { find: /^~(.*)$/, replacement: "$1" },
        {
          find: "@shared",
          replacement: path.resolve(__dirname, "../../packages/shared-ui/src"),
        },
        {
          find: /^ts-key-enum$/,
          replacement: fileURLToPath(new URL('./shims/ts-key-enum-compat.ts', import.meta.url)),
        },

        // lodash 딥임포트들을 ESM 버전으로 라우팅
        { find: /^lodash\/cloneDeep(\.js)?$/, replacement: "lodash-es/cloneDeep.js" },
        { find: /^lodash\/isEqual(\.js)?$/, replacement: "lodash-es/isEqual.js" },
        { find: /^lodash\/merge(\.js)?$/, replacement: "lodash-es/merge.js" },

        //문제의 서브패스 import를 로컬 셰임으로 우회
        { find: "@itwin/core-electron/lib/cjs/ElectronFrontend.js", replacement: path.resolve(__dirname, "shims/electron-frontend.mjs"), },
        // 필요 시 계속 추가 (콘솔 경로 그대로)
      ],
      preserveSymlinks: true,
      dedupe: [
        'react', 
        'react-dom',
        "@itwin/core-bentley",
        "@itwin/core-common",
        "@itwin/core-frontend",
        "@itwin/core-react",
        "@itwin/appui-react",
        "@itwin/components-react",
        "@itwin/tree-widget-react",
        "@itwin/presentation-components",
        "@itwin/presentation-common", 
        "@itwin/presentation-frontend", 
      ], // (권장) 중복 번들 방지
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
        "natural-compare-lite",
        "linkify-it",
        "uc.micro", // linkify-it가 내부에서 사용
      ],
      exclude: [
        "@itwin/tree-widget-react",
        "@itwin/presentation-components",
        "@itwin/presentation-frontend",
        "@itwin/core-backend",
        "@itwin/core-electron",
        "@itwin/ecschema-rpcinterface-impl",
        "@itwin/presentation-backend",
      ],
      // CJS → ESM default 매핑이 필요한 패키지
      needsInterop: [
        "natural-compare-lite", 
        "linkify-it",
        "ts-key-enum",
      ],
    },
    ssr: {
      // ✅ SSR 변환 금지(개발서버 내 일부 경로에서 도움됨)
      noExternal: ["@itwin/core-electron"],
    },
    envPrefix: ENV_PREFIX,
  };
});