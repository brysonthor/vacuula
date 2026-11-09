describe('Resilience & Offline Robot Support Acceptance Tests', () => {
    beforeEach(() => {
        cy.setupVacuulaMocks()
        cy.setDesktopViewport()
    })

    const openDustmiteWorkspace = () => {
        cy.visit('/')
        cy.get('h1').should('contain.text', 'Fleet Overview')
        // Locate Dustmite's card and click Inspect History & Maps
        cy.contains('article', 'Dustmite')
            .contains('button', 'Inspect History & Maps')
            .click()
        cy.url().should('include', '/robot/OFFLINE-ROBOT-001')
    }

    it('displays prominent offline status banner on workspace routes', () => {
        openDustmiteWorkspace()

        // 1. Verify offline banner is displayed
        cy.get('div[role="status"]').should('be.visible')
        cy.get('div[role="status"]').should('contain.text', 'Dustmite is currently offline')
        cy.get('div[role="status"]').should('contain.text', 'read-only mode')
    })

    it('enforces read-only controls when robot is offline', () => {
        openDustmiteWorkspace()

        // 1. Start cleaning button must be disabled
        cy.get('button[aria-label*="Start"]').should('be.disabled')

        // 2. Base / Dock button must be disabled
        cy.contains('button', 'Base').should('be.disabled')

        // 3. Locate button must be disabled
        cy.contains('button', 'Locate').should('be.disabled')
    })

    it('retains access to historical runs and floorplans while offline', () => {
        openDustmiteWorkspace()

        // Navigate to Run History
        cy.get('aside a[title*="Run History"]').click()
        cy.url().should('include', '/runs')
        cy.contains('Runs').should('be.visible')

        // Navigate to Maps & Zones
        cy.get('aside a[title*="Maps & Zones"]').click()
        cy.url().should('include', '/map')
        cy.get('canvas').should('be.visible')
    })

    it('shows offline telemetry and notice in robot maintenance settings', () => {
        openDustmiteWorkspace()

        // Navigate to Robot & Maintenance
        cy.get('aside a[title*="Maintenance"]').click()
        cy.url().should('include', '/settings')

        // Verify offline telemetry badge
        cy.contains('Offline (Read-Only Telemetry)').should('be.visible')

        // Verify onboard preferences section shows offline notification
        cy.contains('This robot is currently offline').should('be.visible')
    })
})
