describe('Fleet Overview Acceptance Tests', () => {
    beforeEach(() => {
        cy.setupVacuulaMocks()
        cy.setDesktopViewport()
    })

    it('renders fleet summary KPIs, robot cards, and quick actions', () => {
        cy.visit('/')

        // 1. Verify header and brand
        cy.get('h1').should('contain.text', 'Fleet Overview')

        // 2. Verify fleet summary KPIs
        cy.get('section[aria-label="Fleet summary"]').within(() => {
            cy.contains('Linked Robots').prev().should('contain.text', '3')
            cy.contains('Online Now').prev().should('contain.text', '2')
        })

        // 3. Verify robot cards rendered
        cy.contains('h2', 'Sparkles').should('be.visible')
        cy.contains('h2', "Loki’s Low-Level Lackey").should('be.visible')
        cy.contains('h2', 'Dustmite').should('be.visible')

        // 4. Verify Sparkles status and badges
        cy.contains('article', 'Sparkles').within(() => {
            cy.contains('Gen 3').should('be.visible')
            cy.contains('BotVacD3Connected').should('be.visible')
            cy.get('[class*="statusPill"]').should('be.visible')
            cy.contains('73').should('be.visible')
            // Quick action buttons
            cy.contains('button', 'Clean').should('not.be.disabled')
            cy.contains('button', 'Locate').should('not.be.disabled')
        })

        // 5. Verify Offline robot card
        cy.contains('article', 'Dustmite').within(() => {
            cy.contains('Offline').should('be.visible')
            cy.contains('button', 'Clean').should('be.disabled')
            cy.contains('button', 'Locate').should('be.disabled')
        })
    })

    it('triggers quick locate and quick clean actions from the fleet card', () => {
        cy.visit('/')

        // Trigger Locate on Sparkles
        cy.contains('article', 'Sparkles').within(() => {
            cy.contains('button', 'Locate').click()
        })
        cy.wait('@sendCommand').its('request.body').should((body) => {
            const parsed = typeof body === 'string' ? JSON.parse(body) : body
            expect(parsed.cmd).to.eq('findMe')
        })

        // Trigger Clean on Sparkles
        cy.contains('article', 'Sparkles').within(() => {
            cy.contains('button', 'Clean').click()
        })
        cy.wait('@sendCommand').its('request.body').should((body) => {
            const parsed = typeof body === 'string' ? JSON.parse(body) : body
            expect(parsed.cmd).to.eq('startCleaning')
        })
    })

    it('navigates to robot command center when clicking a robot card shortcut', () => {
        cy.visit('/')

        // Click shortcut to maps
        cy.contains('article', 'Sparkles').within(() => {
            cy.get('button[title*="Maps & Zones"]').click()
        })
        cy.url().should('include', '/robot/OPS42417-7c38660f057e/map')

        // Return to fleet
        cy.get('aside a[title="Fleet Overview"]').click()
        cy.url().should('eq', `${Cypress.config().baseUrl}/`)
    })

    it('displays empty fleet state with certificate download when no robots are configured', () => {
        cy.setupVacuulaMocks({
            robots: { body: {} },
        })
        cy.visit('/')

        cy.contains('No robots linked yet').should('be.visible')
        cy.contains('button', 'Download cert').should('be.visible')
        cy.contains('button', 'Configure Notifications').should('be.visible')
    })
})
