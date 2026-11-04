describe('Sidebar Navigation Cycles', () => {
    const sparklesSerial = 'OPS42417-7c38660f057e'
    const lokiSerial = '2126LB01A14101917'

    const mockRobots = {
        [sparklesSerial]: {
            type: 'neato.gen3',
            connected: true,
            name: 'Sparkles',
            installed_with: '1.1.0',
            model: 'BotVacD3Connected',
            firmware: '4.5.3-189',
            ip_address: '192.168.0.223',
            last_seen_at: '2026-11-04T17:28:00.993543+00:00',
            charge: 99,
            is_docked: true,
            is_charging: true,
            state_label: 'docked',
            has_error: false,
            error_code: null,
            last_state: {
                version: 1,
                result: 'ok',
                state: 1,
                action: 0,
                details: { isCharging: true, isDocked: true, charge: 99 },
                availableCommands: { start: true, stop: false, pause: false, resume: false, goToBase: false }
            }
        },
        [lokiSerial]: {
            type: 'neato.gen4',
            connected: true,
            name: "Loki’s Low-Level Lackey",
            label_serial: '2127N301A24104005',
            model: null,
            firmware: '1.7.0-2933',
            ip_address: '192.168.0.172',
            last_seen_at: '2026-11-04T17:26:09.336090+00:00',
            charge: 99,
            is_docked: true,
            is_charging: true,
            state_label: 'docked',
            has_error: false,
            error_code: null,
            last_state: {
                state: 'idle',
                action: 'invalid',
                details: { is_charging: true, is_docked: true, charge: 99, base_type: 'standard' },
                available_commands: { start: true, cancel: false, pause: false, resume: false, return_to_base: false }
            }
        }
    }

    const mockServerInfo = {
        version: '1.1.1-b1',
        min_installer_version: '1.1.0-b3',
        gen3_port: 335,
        gen4_port: 3443,
        ha_ingress: false,
        timezone: 'America/Denver',
        utc_offset_minutes: -420
    }

    beforeEach(() => {
        cy.intercept('GET', '/api/server', { body: mockServerInfo }).as('getServer')
        cy.intercept('GET', '/api/robots', { body: mockRobots }).as('getRobots')
        cy.intercept('GET', '/api/events', { body: '' }).as('getEvents')
        cy.intercept('GET', '/api/robot/**/queue', { body: [] })
        cy.intercept('GET', '/api/robot/**/runs', { body: [] })
        cy.intercept('GET', '/api/robot/**/maps', { body: [] })
        cy.intercept('GET', '/api/robot/**/map/**', { body: {} })
        cy.intercept('GET', '/api/robot/**/boundaries', { body: [] })
        cy.intercept('GET', '/api/robot/**/schedules', { body: [] })
        cy.intercept('GET', '/api/robot/**/connect', { body: '' })
        cy.intercept('POST', `/api/robot/${sparklesSerial}/command`, {
            body: {
                version: 1,
                result: 'ok',
                state: 1,
                action: 0,
                details: { isCharging: true, isDocked: true, charge: 99 },
                availableCommands: { start: true, stop: false, pause: false, resume: false, goToBase: false }
            }
        }).as('sparklesCommand')
        cy.intercept('POST', `/api/robot/${lokiSerial}/command`, {
            body: {
                body: {
                    state: 'idle',
                    action: 'invalid',
                    details: { is_charging: true, is_docked: true, charge: 99, base_type: 'standard' },
                    available_commands: { start: true, cancel: false, pause: false, resume: false, return_to_base: false }
                }
            }
        }).as('lokiCommand')
    })

    it('clicks through Sparkles, Loki, and Fleet Overview 3 times, checking active links and page re-renders', () => {
        cy.visit('/')
        cy.wait(['@getRobots', '@getServer'])
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

            // Verify the main workspace content re-rendered for Sparkles
            cy.get('main').should('contain.text', 'Cleaning Setup')
            cy.get('main').should('contain.text', 'Active Floorplan')

            // 2. Click Loki's Low-Level Lackey
            cy.get('aside a[title*="Loki"]').click()
            cy.url().should('include', `/robot/${lokiSerial}`)

            // Verify active link UI is showing ONLY for Loki
            cy.get('aside a[title*="Loki"]').should('match', '[class*="robotRowActive"]')
            cy.get('aside a[title*="Sparkles"]').should('not.match', '[class*="robotRowActive"]')
            cy.get('aside a[title="Fleet Overview"]').should('not.have.class', 'active')

            // Verify the sidebar workspace section re-rendered for Loki
            cy.get('aside').should('contain.text', "Loki’s Low-Level Lackey")
            cy.get('aside a[title="Command Center"]').should('have.attr', 'href', `/robot/${lokiSerial}`)

            // Verify the main workspace content re-rendered for Loki
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
