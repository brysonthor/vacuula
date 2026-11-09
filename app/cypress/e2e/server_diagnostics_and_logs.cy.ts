describe('Server Diagnostics, Logs & Notifications Acceptance Tests', () => {
    beforeEach(() => {
        cy.setupVacuulaMocks()
        cy.setDesktopViewport()
    })

    describe('Server Logs Viewer', () => {
        const openLogs = () => {
            cy.visit('/')
            cy.get('aside a[title="Server Logs"]').click()
            cy.url().should('include', '/logs')
            cy.get('h1').should('contain.text', 'Vacuula Server Logs')
        }

        it('streams and displays server log lines', () => {
            openLogs()

            // 1. Verify header info
            cy.contains('Vacuula v1.1.1-b1 (America/Denver)').should('be.visible')

            // 2. Verify lines from fixture
            cy.contains('Vacuula server starting on version 1.1.1-b1').should('be.visible')
            cy.contains('Gen3 TCP server listening on port 335').should('be.visible')
        })

        it('filters log lines by severity level', () => {
            openLogs()

            // Filter: ERROR
            cy.contains('button', 'ERROR').click()
            cy.contains('Discord webhook notification failed').should('be.visible')
            cy.contains('keepalive ping').should('not.exist')

            // Filter: WARNING
            cy.contains('button', 'WARNING').click()
            cy.contains('Consumable main_brush').should('be.visible')
            cy.contains('Discord webhook notification failed').should('not.exist')

            // Reset: ALL
            cy.contains('button', 'ALL').click()
            cy.contains('Vacuula server starting').should('be.visible')
        })

        it('filters log lines by search keyword', () => {
            openLogs()

            cy.get('input[type="search"]').type('keepalive')
            cy.contains('keepalive ping received').should('be.visible')
            cy.contains('Vacuula server starting').should('not.exist')
        })
    })

    describe('Global Settings & Notifications', () => {
        const openSettings = () => {
            cy.visit('/')
            cy.get('aside a[href="/settings"]').click()
            cy.url().should('include', '/settings')
            cy.get('h1').should('be.visible')
        }

        it('configures Discord webhook notifications and triggers a test message', () => {
            openSettings()

            // Verify notifications card is present
            cy.contains('Discord Webhook Notifications').should('be.visible')

            // Check notification categories
            cy.contains('Robot Connectivity').should('be.visible')
            cy.contains('Cleaning Transitions').should('be.visible')
            cy.contains('Errors & Stuck Alerts').should('be.visible')

            // Send test notification
            cy.contains('button', 'Send Test').click()
            cy.wait('@testNotification')
            cy.contains('Notification test sent successfully!').should('be.visible')
        })

        it('displays server diagnostics and certificate download', () => {
            openSettings()

            // Verify server info card
            cy.contains('Vacuula Server & Community').should('be.visible')
            cy.contains('1.1.1-b1').should('be.visible')
            cy.contains('Gen 3: 335').should('be.visible')
            cy.contains('Gen 4: 3443').should('be.visible')

            // Verify SSL Certificate download button exists
            cy.contains('button', 'Download cert').should('be.visible')
        })
    })
})
