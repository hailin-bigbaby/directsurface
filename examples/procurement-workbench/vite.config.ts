import { defineConfig } from 'vite'

export default defineConfig(({ command, mode }) => ({
  base: './',
  define: { __PROCUREMENT_TEST__: JSON.stringify(command === 'serve' && mode === 'test') },
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  worker: { format: 'es' },
  build: { target: 'es2022' },
}))
