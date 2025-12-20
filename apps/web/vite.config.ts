import react from '@vitejs/plugin-react-swc'
import { resolve } from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
  root: resolve(__dirname, '../../src/renderer'),
  plugins: [
    (async () => (await import('@tailwindcss/vite')).default())(),
    react({
      tsDecorators: true,
      plugins: [
        [
          '@swc/plugin-styled-components',
          {
            displayName: true,
            fileName: false,
            pure: true,
            ssr: false
          }
        ]
      ]
    })
  ],
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, '../../src/renderer/src'),
      '@shared': resolve(__dirname, '../../packages/shared'),
      '@types': resolve(__dirname, '../../src/renderer/src/types'),
      '@logger': resolve(__dirname, '../../src/renderer/src/services/LoggerService'),
      '@mcp-trace/trace-core': resolve(__dirname, '../../packages/mcp-trace/trace-core'),
      '@mcp-trace/trace-web': resolve(__dirname, '../../packages/mcp-trace/trace-web'),
      '@cherrystudio/ai-core/provider': resolve(__dirname, '../../packages/aiCore/src/core/providers'),
      '@cherrystudio/ai-core/built-in/plugins': resolve(__dirname, '../../packages/aiCore/src/core/plugins/built-in'),
      '@cherrystudio/ai-core': resolve(__dirname, '../../packages/aiCore/src'),
      '@cherrystudio/extension-table-plus': resolve(__dirname, '../../packages/extension-table-plus/src'),
      '@cherrystudio/ai-sdk-provider': resolve(__dirname, '../../packages/ai-sdk-provider/src')
    }
  },
  define: {
    'import.meta.env.VITE_APP_TARGET': JSON.stringify(process.env.VITE_APP_TARGET || 'web')
  },
  server: {
    port: 4173
  },
  build: {
    target: 'esnext',
    outDir: resolve(__dirname, '../../dist/web')
  }
})
