import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { resolveHostedConfig } from './src/hosted-config.mjs'

export default defineConfig(({ mode }) => {
  const settings = resolveHostedConfig(loadEnv(mode, process.cwd(), 'VITE_'))
  if (settings.errors.length) {
    throw new Error('Check public hosted-service settings: ' + settings.errors.join(', '))
  }
  const publicSettings = JSON.stringify({ apiBase: settings.apiBase })
  return { plugins: [react(), {
    name: 'disdat-library-config',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'hosted-config.json', source: publicSettings })
    },
    configureServer(server) {
      server.middlewares.use('/hosted-config.json', (_request, response) => {
        response.setHeader('Content-Type', 'application/json')
        response.end(publicSettings)
      })
    },
  }] }
})
