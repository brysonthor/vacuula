describe('Cleaning Runs History Acceptance Tests', () => {
    beforeEach(() => {
        cy.setupVacuulaMocks()
        cy.setDesktopViewport()
    })

    const openSparklesRuns = () => {
        cy.visit('/')
        cy.get('h1').should('contain.text', 'Fleet Overview')
        cy.get('aside a[title*="Sparkles"]').click()
        cy.url().should('include', '/robot/OPS42417-7c38660f057e')
        cy.get('aside a[title*="Run History"]').click()
        cy.url().should('include', '/runs')
        cy.get('select[aria-label="Filter by status"]').should('be.visible')
    }

    it('renders lifetime run stats and run history items', () => {
        openSparklesRuns()

        // 1. Verify summary metrics
        cy.contains('Runs').prev().should('contain.text', '3')
        cy.contains('Completed').prev().should('contain.text', '33%') // 1 complete out of 3
        cy.contains('Total Area').should('be.visible')

        // 2. Verify run items from fixture
        cy.contains('schedule cleaning').should('be.visible')
        cy.contains('app cleaning').should('be.visible')
    })

    it('filters historical runs by completion status', () => {
        openSparklesRuns()

        // Filter: Completed (only 1 complete run exists, launched from schedule)
        cy.get('select[aria-label="Filter by status"]').select('complete')
        cy.contains('schedule cleaning').should('be.visible')

        // Filter: Incomplete / Error (the other 2 runs were incomplete / canceled)
        cy.get('select[aria-label="Filter by status"]').select('incomplete')
        cy.contains('schedule cleaning').should('not.exist')
        cy.contains('app cleaning').should('be.visible')

        // Reset: All Statuses
        cy.get('select[aria-label="Filter by status"]').select('all')
        cy.contains('schedule cleaning').should('be.visible')
    })

    it('filters historical runs by trigger source', () => {
        openSparklesRuns()

        // Filter: Schedule
        cy.get('select[aria-label="Filter by trigger"]').select('schedule')
        cy.contains('schedule cleaning').should('be.visible')

        // Filter: App
        cy.get('select[aria-label="Filter by trigger"]').select('app')
        cy.contains('schedule cleaning').should('not.exist')
        cy.contains('app cleaning').should('be.visible')
    })

    it('inspects a selected run showing timing, area, and battery details', () => {
        openSparklesRuns()

        // Select the first run
        cy.contains('button[class*="item"]', 'schedule cleaning').click()

        // Verify inspector pane displays metrics
        cy.contains('Battery').should('be.visible')
        cy.contains('Floor Space').should('be.visible')
        cy.contains('Cleaned Path Segments').should('be.visible')
    })
})
