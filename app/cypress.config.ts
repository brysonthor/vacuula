import { defineConfig } from 'cypress'

export default defineConfig({
  e2e: {
    baseUrl: process.env.CYPRESS_BASE_URL || 'http://192.168.0.230',
    viewportWidth: 1280,
    viewportHeight: 800,
    supportFile: 'cypress/support/e2e.ts',
    video: false,
    setupNodeEvents(on, config) {
      on('task', {
        log(message) {
          console.log('[BROWSER LOG]', message)
          return null
        },
        error(message) {
          console.error('[BROWSER ERROR]', message)
          return null
        }
      })
    }
  },
})
