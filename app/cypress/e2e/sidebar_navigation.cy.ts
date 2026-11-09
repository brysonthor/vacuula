describe('Sidebar Navigation Cycles', () => {
    const sparklesSerial = 'OPS42417-7c38660f057e'
    const lokiSerial = '2126LB01A14101917'

    it('clicks through Sparkles, Loki, and Fleet Overview 3 times, checking active links and page re-renders', () => {
        cy.setupVacuulaMocks()
        cy.visit('/')
        cy.get('h1').should('contain.text', 'Fleet Overview')

        for (let cycle = 1; cycle <= 3; cycle++) {
            cy.log(`========== Starting Cycle ${cycle} ==========`)

            // 1. Click Sparkles
            cy.get('aside a[title*="Sparkles"]').click()
            cy.url().should('include', `/robot/${sparklesSerial}`)

            // Verify active link UI is showing ONLY for Sparkles
            cy.get('aside a[title*="Sparkles"]').should('match', '[class*="robotRowActive"]')
            cy.get('aside a[title*="Loki"]').should('not.match', '[class*="robotRowActive"]')
            cy.get('aside a[title="Fleet Overview"]').should('not.match', '[class*="active"]')

            // Verify the sidebar workspace section re-rendered for Sparkles
            cy.get('aside').should('contain.text', 'Sparkles')
            cy.get('aside a[title="Command Center"]').should('have.attr', 'href', `/robot/${sparklesSerial}`)

            // Verify workspace page re-rendered for Sparkles
            cy.get('main').should('contain.text', 'Cleaning Setup')

            // 2. Click Loki's Low-Level Lackey
            cy.get('aside a[title*="Loki"]').click()
            cy.url().should('include', `/robot/${lokiSerial}`)

            // Verify active link UI is showing ONLY for Loki
            cy.get('aside a[title*="Loki"]').should('match', '[class*="robotRowActive"]')
            cy.get('aside a[title*="Sparkles"]').should('not.match', '[class*="robotRowActive"]')
            cy.get('aside a[title="Fleet Overview"]').should('not.match', '[class*="active"]')

            // Verify the sidebar workspace section re-rendered for Loki
            cy.get('aside').should('contain.text', "Loki’s Low-Level Lackey")
            cy.get('aside a[title="Command Center"]').should('have.attr', 'href', `/robot/${lokiSerial}`)

            // Verify workspace page re-rendered for Loki
            cy.get('main').should('contain.text', 'Cleaning Setup')

            // 3. Click Fleet Overview
            cy.get('aside a[title="Fleet Overview"]').click()
            cy.url().should('eq', `${Cypress.config().baseUrl}/`)

            // Verify active link UI is showing ONLY for Fleet Overview
            cy.get('aside a[title="Fleet Overview"]').should('match', '[class*="active"]')
            cy.get('aside a[title*="Sparkles"]').should('not.match', '[class*="robotRowActive"]')
            cy.get('aside a[title*="Loki"]').should('not.match', '[class*="robotRowActive"]')

            // Verify the main page re-rendered Fleet Overview
            cy.get('h1').should('contain.text', 'Fleet Overview')
            cy.get('main').should('contain.text', 'Sparkles')
            cy.get('main').should('contain.text', "Loki’s Low-Level Lackey")
        }
    })
})
