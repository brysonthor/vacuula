describe('Robot Settings & Maintenance Acceptance Tests', () => {
    beforeEach(() => {
        cy.setupVacuulaMocks()
        cy.setDesktopViewport()
    })

    const openSparklesSettings = () => {
        cy.visit('/')
        cy.get('h1').should('contain.text', 'Fleet Overview')
        cy.get('aside a[title*="Sparkles"]').click()
        cy.url().should('include', '/robot/OPS42417-7c38660f057e')
        cy.get('aside a[title*="Maintenance"]').click()
        cy.url().should('include', '/settings')
        cy.get('h1').should('contain.text', 'Sparkles')
    }

    it('renders identity and hardware telemetry metrics', () => {
        openSparklesSettings()

        // 1. Check Identity card
        cy.contains('Identity & Hardware Telemetry').should('be.visible')
        cy.contains('OPS42417-7c38660f057e').should('be.visible')
        cy.contains('Neato Gen 3 (Nucleo)').should('be.visible')

        // 2. Check telemetry from fixture (model, firmware, IP, battery)
        cy.contains('BotVacD3Connected').should('be.visible')
        cy.contains('4.5.3-189').should('be.visible')
        cy.contains('192.168.0.223').should('be.visible')
        cy.contains('Battery Cycles').parent().should('contain.text', '142')
        cy.contains('Battery Vendor').parent().should('contain.text', 'Panasonic')
    })

    it('renames the robot and verifies debounced API update', () => {
        openSparklesSettings()

        // Type a new name into the robot name input
        cy.get('input[type="text"]').first().clear().type('Sparkles Prime')

        // Wait for debounced HTTP POST to update robot name
        cy.wait('@updateRobot').then(interception => {
            expect(interception.request.body.name).to.eq('Sparkles Prime')
        })
    })

    it('displays consumables lifespan and flags items needing attention', () => {
        openSparklesSettings()

        cy.contains('Consumables & Maintenance Lifespan').should('be.visible')

        // Main Spiral Combo Brush is at 1% in fixture and needs attention
        cy.contains('Main Spiral Combo Brush').should('be.visible')
        cy.contains('1%').should('be.visible')
        cy.contains('4.0h left of 300h').should('be.visible')

        // High-Performance Filter at 87%
        cy.contains('High-Performance Filter').should('be.visible')
        cy.contains('87%').should('be.visible')
    })

    it('resets a consumable component to 100% capacity', () => {
        openSparklesSettings()

        // Click "Mark Replaced / Cleaned" on the first consumable card (Filter)
        cy.contains('div[class*="consumableCard"]', 'High-Performance Filter')
            .contains('button', 'Mark Replaced / Cleaned')
            .click()

        cy.wait('@resetConsumable')

        // Verify the reset update reflected in the UI (all items return 100% from reset intercept)
        cy.contains('100%').should('be.visible')
    })
})
