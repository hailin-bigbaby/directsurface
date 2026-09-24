import { defineConfig } from 'vite'

export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? '/directsurface/' : '/',
  server: { port: 5174 },
})
