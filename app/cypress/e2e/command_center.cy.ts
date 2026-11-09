describe('Command Center Acceptance Tests', () => {
    const sparklesSerial = 'OPS42417-7c38660f057e'

    beforeEach(() => {
        cy.setupVacuulaMocks()
        cy.setDesktopViewport()
    })

    it('renders telemetry, battery status, and cleaning configuration options', () => {
        cy.visit(`/robot/${sparklesSerial}`)

        // 1. Verify workspace rendered
        cy.contains('Sparkles').should('be.visible')
        cy.contains('Cleaning Setup').should('be.visible')

        // 2. Verify battery percentage in Command Center ring
        cy.contains('73%').should('be.visible')

        // 3. Suction Power: toggling between Eco and Turbo
        cy.contains('button', 'Turbo').click()
        cy.contains('button', 'Turbo').should('match', '[class*="pillActive"]')
        cy.window().then((win) => {
            expect(win.localStorage.getItem('vacuula.gen3.cleaningMode')).to.eq('2')
        })

        cy.contains('button', 'Eco').click()
        cy.contains('button', 'Eco').should('match', '[class*="pillActive"]')
        cy.window().then((win) => {
            expect(win.localStorage.getItem('vacuula.gen3.cleaningMode')).to.eq('1')
        })

        // 4. Navigation mode selection
        cy.contains('button', 'Normal').should('be.visible')
        cy.contains('button', 'Extra Care').click()
        cy.contains('button', 'Extra Care').should('match', '[class*="pillActive"]')

        // 5. Scope selection: House vs Map
        cy.contains('button', 'House').click()
        cy.contains('button', 'House').should('match', '[class*="pillActive"]')
    })

    it('dispatches Start Cleaning command with selected parameters', () => {
        cy.intercept('POST', '**/api/robot/*/command', (req) => {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
            if (body.cmd === 'startCleaning') {
                req.alias = 'startCleanCmd'
                req.reply({ statusCode: 200, body: { result: 'ok' } })
            } else if (body.cmd === 'getRobotState') {
                req.reply({ fixture: 'gen3_state.json' })
            } else {
                req.reply({ statusCode: 200, body: { result: 'ok' } })
            }
        })

        cy.visit(`/robot/${sparklesSerial}`)

        // Select Turbo suction power
        cy.contains('button', 'Turbo').click()

        // Select House cleaning scope
        cy.contains('button', 'House').click()

        // Click Start Cleaning button
        cy.get('button[aria-label*="Start"]').click()

        // Verify command sent
        cy.wait('@startCleanCmd').its('request.body').should((body) => {
            const parsed = typeof body === 'string' ? JSON.parse(body) : body
            expect(parsed.cmd).to.eq('startCleaning')
            expect(parsed.params).to.exist
            expect(parsed.params.mode).to.eq(2) // Turbo mode
        })
    })

    it('dispatches Dock / Return to Base command when robot is undocked', () => {
        cy.setupVacuulaMocks({
            robots: {
                body: {
                    [sparklesSerial]: {
                        type: 'neato.gen3',
                        connected: true,
                        name: 'Sparkles',
                        charge: 70,
                        is_docked: false,
                        state_label: 'cleaning',
                        last_state: {
                            state: 2,
                            action: 0,
                            availableCommands: { start: false, stop: true, pause: true, resume: false, goToBase: true },
                            details: { isCharging: false, isDocked: false, charge: 70 },
                        },
                    },
                },
            },
            gen3State: {
                body: {
                    version: 1,
                    result: 'ok',
                    data: {},
                    state: 2,
                    action: 0,
                    availableCommands: { start: false, stop: true, pause: true, resume: false, goToBase: true },
                    details: { isCharging: false, isDocked: false, charge: 70 },
                },
            },
        })

        cy.visit(`/robot/${sparklesSerial}`)

        // Dock button should now be enabled
        cy.get('button[title*="Dock"], button[title*="Base"]').first().click()

        // Verify POST to /dock occurred
        cy.wait('@dockRobot').its('request.url').should('include', `/robot/${sparklesSerial}/dock`)
    })

    it('renders alert cards when robot has active alerts such as dustbin_full', () => {
        cy.setupVacuulaMocks({
            robots: {
                body: {
                    [sparklesSerial]: {
                        type: 'neato.gen3',
                        connected: true,
                        name: 'Sparkles',
                        charge: 73,
                        is_docked: true,
                        has_error: true,
                        error_code: 'dustbin_full',
                        last_state: {
                            state: 1,
                            alert: 'dustbin_full',
                            availableCommands: { start: true, stop: false, pause: false, resume: false, goToBase: false },
                            details: { isCharging: false, isDocked: true, charge: 73 },
                        },
                    },
                },
            },
            gen3State: {
                body: {
                    version: 1,
                    result: 'ok',
                    data: {},
                    state: 1,
                    action: 0,
                    alert: 'dustbin_full',
                    availableCommands: { start: true, stop: false, pause: false, resume: false, goToBase: false },
                    details: { isCharging: false, isDocked: true, charge: 73 },
                },
            },
        })

        cy.intercept('POST', '**/api/robot/*/command', (req) => {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
            if (body.cmd === 'dismissCurrentAlert') {
                req.alias = 'dismissCmd'
                req.reply({ statusCode: 200, body: { result: 'ok' } })
            }
        })

        cy.visit(`/robot/${sparklesSerial}`)

        // Alert card should be visible
        cy.contains('Alert').should('be.visible')
        cy.contains('Empty dirt bin').should('be.visible')
        cy.contains('button', 'Dismiss').should('be.visible').click()

        cy.wait('@dismissCmd').its('request.body').should((body) => {
            const parsed = typeof body === 'string' ? JSON.parse(body) : body
            expect(parsed.cmd).to.eq('dismissCurrentAlert')
        })
    })
})
