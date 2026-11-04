import { defineConfig } from 'cypress'

export default defineConfig({
  e2e: {
    baseUrl: process.env.CYPRESS_BASE_URL || 'http://localhost:5173',
    viewportWidth: 1280,
    viewportHeight: 800,
    supportFile: false,
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
