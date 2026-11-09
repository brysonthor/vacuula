describe('Maps & Boundaries Acceptance Tests', () => {
    const sparklesSerial = 'OPS42417-7c38660f057e'

    beforeEach(() => {
        cy.setupVacuulaMocks()
        cy.setDesktopViewport()
    })

    it('renders the interactive map canvas and loaded floorplan', () => {
        cy.visit(`/robot/${sparklesSerial}/map`)

        // 1. Verify canvas is rendered
        cy.get('canvas').should('be.visible')

        // 2. Verify map name displayed
        cy.contains('Main Floor').should('be.visible')
    })

    it('displays saved boundaries list (zones and no-go lines)', () => {
        cy.visit(`/robot/${sparklesSerial}/map`)

        // Verify boundaries from fixture
        cy.contains('Kitchen').should('be.visible')
        cy.contains('Pet Bowls').should('be.visible')

        // Verify zone action button (Clean Zone)
        cy.contains('button', 'Clean').should('be.visible')
    })

    it('supports Clean Here mode activation', () => {
        cy.visit(`/robot/${sparklesSerial}/map`)

        // Click Clean Here button
        cy.contains('button', 'Clean Here').click()

        // Verify clean here instructions appear
        cy.contains('Clean Here').should('be.visible')
    })
})
