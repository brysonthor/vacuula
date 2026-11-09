describe('Mobile Viewport & Responsive Layout Acceptance Tests', () => {
    beforeEach(() => {
        cy.setupVacuulaMocks()
        cy.setMobileViewport() // 390x844 (Mobile phone dimensions)
    })

    it('hides desktop sidebar and renders mobile bottom navigation on home view', () => {
        cy.visit('/')

        // 1. Verify desktop sidebar is NOT visible
        cy.get('aside').should('not.exist')

        // 2. Verify mobile bottom navbar is present
        cy.get('nav[aria-label="Main navigation"]').should('be.visible')
        cy.get('nav[aria-label="Main navigation"] a[aria-label="Fleet"]').should('be.visible')
        cy.get('nav[aria-label="Main navigation"] a[aria-label="Logs"]').should('be.visible')
        cy.get('nav[aria-label="Main navigation"] a[aria-label="Settings"]').should('be.visible')
    })

    it('navigates via mobile bottom navbar between global routes', () => {
        cy.visit('/')

        // Navigate to Logs via bottom nav
        cy.get('nav a[aria-label="Logs"]').click()
        cy.url().should('include', '/logs')
        cy.contains('Vacuula Server Logs').should('be.visible')

        // Navigate to Settings via bottom nav
        cy.get('nav a[aria-label="Settings"]').click()
        cy.url().should('include', '/settings')
        cy.contains('Discord Webhook Notifications').should('be.visible')

        // Navigate back to Fleet Overview
        cy.get('nav a[aria-label="Fleet"]').click()
        cy.url().should('eq', `${Cypress.config().baseUrl}/`)
        cy.contains('Fleet Overview').should('be.visible')
    })

    it('navigates through workspace tabs via mobile workspace navbar', () => {
        cy.visit('/')

        // Select Sparkles from fleet overview
        cy.contains('article', 'Sparkles').contains('button', 'Open Workspace').click()
        cy.url().should('include', '/robot/OPS42417-7c38660f057e')

        // Verify bottom navbar switched to workspace mode
        cy.get('nav[aria-label="Workspace navigation"]').should('be.visible')

        // Tap Map tab
        cy.get('nav a[aria-label="Map"]').click()
        cy.url().should('include', '/map')
        cy.get('canvas').should('be.visible')

        // Tap Runs tab
        cy.get('nav a[aria-label="Runs"]').click()
        cy.url().should('include', '/runs')
        cy.get('select[aria-label="Filter by status"]').should('be.visible')

        // Tap Schedule tab
        cy.get('nav a[aria-label="Schedule"]').click()
        cy.url().should('include', '/schedule')
        cy.contains('Schedule').should('be.visible')

        // Tap Robot (maintenance) tab
        cy.get('nav a[aria-label="Robot"]').click()
        cy.url().should('include', '/settings')
        cy.contains('Consumables & Maintenance Lifespan').should('be.visible')

        // Return to Control tab
        cy.get('nav a[aria-label="Control"]').click()
        cy.url().should('include', '/robot/OPS42417-7c38660f057e')
        cy.get('button[aria-label*="Start"]').should('be.visible')
    })

    it('opens and closes the mobile cleaning setup drawer in Command Center', () => {
        cy.visit('/')
        cy.contains('article', 'Sparkles').contains('button', 'Open Workspace').click()
        cy.url().should('include', '/robot/OPS42417-7c38660f057e')

        // Desktop inline Cleaning Setup card should not exist on mobile
        cy.contains('h2', 'Cleaning Setup').should('not.exist')

        // Click the mobile adjustments pill button (opens drawer)
        cy.get('button[class*="utilBtn"]').last().click()

        // Verify the ResponsivePanel drawer opened with Cleaning Setup options
        cy.contains('House').should('be.visible')
        cy.contains('Turbo').should('be.visible')

        // Close the drawer with OK button
        cy.contains('button', 'OK').click()
        cy.contains('button', 'OK').should('not.exist')
    })
})
