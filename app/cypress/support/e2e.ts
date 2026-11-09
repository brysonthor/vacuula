import './commands'

// Provide a stable MockEventSource so tests are 100% hermetic and not subject to
// external server SSE race conditions or unhandled network dropout errors.
Cypress.on('window:before:load', (win) => {
    class MockEventSource {
        url: string
        readyState = 1
        CONNECTING = 0
        OPEN = 1
        CLOSED = 2
        listeners: Record<string, Function[]> = {}
        onopen: ((ev: any) => any) | null = null
        onmessage: ((ev: any) => any) | null = null
        onerror: ((ev: any) => any) | null = null

        constructor(url: string) {
            this.url = url
            setTimeout(() => {
                if (this.onopen) {
                    this.onopen({ type: 'open' })
                }
            }, 0)
        }

        addEventListener(type: string, listener: Function) {
            if (!this.listeners[type]) {
                this.listeners[type] = []
            }
            this.listeners[type].push(listener)
        }

        removeEventListener(type: string, listener: Function) {
            if (!this.listeners[type]) return
            this.listeners[type] = this.listeners[type].filter((l) => l !== listener)
        }

        dispatchEvent(_event: any) {
            return true
        }

        close() {
            this.readyState = 2
        }
    }

    win.EventSource = MockEventSource as any

    const origError = win.console.error
    win.console.error = (...args: any[]) => {
        try {
            const msg = args.map(a => (typeof a === 'object' && a?.message ? a.message : String(a))).join(' ')
            Cypress.task('error', msg)
        } catch {}
        origError.apply(win.console, args)
    }
})

// Ignore harmless cross-origin, ResizeObserver, or unhandled promise rejections that don't affect test correctness
Cypress.on('uncaught:exception', (err) => {
    if (
        err.message.includes('ResizeObserver loop') ||
        err.message.includes('Script error') ||
        err.message.includes('events stream error') ||
        err.message.includes('Cypress.env()')
    ) {
        return false
    }
    return true
})
