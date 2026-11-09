describe('Cleaning Schedules Acceptance Tests', () => {
    beforeEach(() => {
        cy.setupVacuulaMocks()
        cy.setDesktopViewport()
    })

    const openSparklesSchedules = () => {
        cy.visit('/')
        cy.get('h1').should('contain.text', 'Fleet Overview')
        cy.get('aside a[title*="Sparkles"]').click()
        cy.url().should('include', '/robot/OPS42417-7c38660f057e')
        cy.get('aside a[title*="Schedule"]').click()
        cy.url().should('include', '/schedule')
        cy.get('h1').should('contain.text', 'Schedule')
    }

    it('renders the 7-day weekly calendar grid and existing schedules', () => {
        openSparklesSchedules()

        // 1. Verify calendar grid headers
        cy.contains('Mon').should('be.visible')
        cy.contains('Tue').should('be.visible')
        cy.contains('Wed').should('be.visible')
        cy.contains('Thu').should('be.visible')
        cy.contains('Fri').should('be.visible')
        cy.contains('Sat').should('be.visible')
        cy.contains('Sun').should('be.visible')

        // 2. Verify timezone header info
        cy.contains('America/Denver').should('be.visible')

        // 3. Verify onboard and server schedule sections
        cy.contains('Onboard Robot Schedules').should('be.visible')
        cy.contains('Vacuula Server Routines & One-Off Cleans').should('be.visible')
        cy.contains('Weekday Morning Clean').should('be.visible')
    })

    it('activates and cancels "Skip Next Clean (24h)"', () => {
        openSparklesSchedules()

        // 1. Click Skip Next Clean
        cy.contains('button', 'Skip Next Clean (24h)').click()
        cy.wait('@postScheduleSkip')

        // 2. Verify the active skip indicator pill appears
        cy.contains('Skipping until').should('be.visible')
        cy.contains('Resume').should('be.visible')

        // 3. Click to resume / cancel skip
        cy.contains('button', 'Skipping until').click()
        cy.wait('@deleteScheduleSkip')

        // 4. Verify returned to standard Skip Next Clean button
        cy.contains('button', 'Skip Next Clean (24h)').should('be.visible')
    })

    it('creates a recurring server routine with Double Pass', () => {
        openSparklesSchedules()

        // Open Add Recurring Schedule panel
        cy.contains('button', 'New schedule').click()
        cy.contains('Add event').should('be.visible')

        // Toggle Double Pass to trigger Server Orchestration
        cy.contains('Double Pass (2×)').parent().find('input[type="checkbox"]').check({ force: true })

        // Click Save
        cy.contains('button', 'Save').click()
        cy.wait('@createSchedule').then(interception => {
            expect(interception.request.body.payload.modifier).to.eq(2)
        })
    })

    it('deletes a server routine', () => {
        openSparklesSchedules()

        // Verify existing routine is visible
        cy.contains('Weekday Morning Clean').should('be.visible')

        // Click delete trash icon for the server schedule
        cy.get('button[aria-label="Delete server schedule"]').first().click()
        cy.wait('@deleteSchedule')
    })
})
