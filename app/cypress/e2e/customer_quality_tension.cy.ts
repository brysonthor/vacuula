describe('Customer Quality Tension & Edge Cases Suite', () => {
    beforeEach(() => {
        cy.setupVacuulaMocks()
        cy.setDesktopViewport()
    })

    describe('Hardware Failure Feedback & Error Visibility', () => {
        it('displays prominent error feedback when a robot dock command fails', () => {
            // Mock an undocked robot with return to base capability
            cy.fixture('gen3_state.json').then((state) => {
                const undocked = {
                    ...state,
                    details: {
                        ...state.details,
                        isDocked: false,
                        isCharging: false,
                    },
                    availableCommands: {
                        ...state.availableCommands,
                        goToBase: true,
                    },
                }
                cy.intercept('POST', '**/api/robot/*/command', (req) => {
                    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
                    if (body.cmd === 'getRobotState') {
                        req.reply(undocked)
                    }
                })
            })

            // Mock dock failure (e.g., robot path blocked)
            cy.intercept('POST', '**/api/robot/*/dock', {
                statusCode: 500,
                body: { error: 'Robot cannot return to dock: Path is blocked by an obstacle' },
            }).as('failedDockCmd')

            cy.visit('/robot/OPS42417-7c38660f057e')

            // Trigger return to base
            cy.contains('button', 'Base').click()
            cy.wait('@failedDockCmd')

            // The customer MUST see the actionable error message
            cy.contains('Path is blocked by an obstacle').should('be.visible')
            cy.get('[class*="dockFeedbackError"]').should('be.visible')
        })
    })

    describe('Action In-Flight Protection & Double-Submission Prevention', () => {
        it('prevents multiple concurrent dock requests during in-flight network dispatch', () => {
            let requestCount = 0

            cy.fixture('gen3_state.json').then((state) => {
                const undocked = {
                    ...state,
                    details: {
                        ...state.details,
                        isDocked: false,
                        isCharging: false,
                    },
                    availableCommands: {
                        ...state.availableCommands,
                        goToBase: true,
                    },
                }
                cy.intercept('POST', '**/api/robot/*/command', (req) => {
                    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
                    if (body.cmd === 'getRobotState') {
                        req.reply(undocked)
                    }
                })
            })

            // Delay the dock response to simulate network latency
            cy.intercept('POST', '**/api/robot/*/dock', (req) => {
                requestCount++
                req.reply({
                    delay: 500,
                    body: { ok: true, message: 'Returning to base' },
                })
            }).as('slowDockCmd')

            cy.visit('/robot/OPS42417-7c38660f057e')

            // Click Base button rapidly
            cy.contains('button', 'Base').click()

            // Verify button enters disabled / loading state while in-flight
            cy.get('button[class*="secondaryTransportBtn"]').should('be.disabled')

            cy.wait('@slowDockCmd')

            // Exactly 1 network request must have been sent
            cy.then(() => {
                expect(requestCount).to.eq(1)
            })
        })
    })

    describe('Data Integrity & Input Sanitization', () => {
        it('guards against updating robot name with whitespace-only input', () => {
            cy.visit('/robot/OPS42417-7c38660f057e/settings')
            cy.contains('Identity & Hardware Telemetry').should('be.visible')

            // Spy on update requests
            let updated = false
            cy.intercept('POST', '**/api/robot/OPS42417-7c38660f057e', (req) => {
                updated = true
                req.reply({ ok: true })
            }).as('spyUpdate')

            // Type only whitespace into the robot name field
            cy.get('input[type="text"]').first().clear().type('     ')

            // Wait past the 500ms debounce interval
            cy.wait(700)

            // Verify no invalid update was dispatched to backend
            cy.then(() => {
                expect(updated).to.be.false
            })
        })
    })

    describe('Modal Trapping & Safe Dismissal', () => {
        it('allows canceling and safely dismissing destructive modals without triggering deletion', () => {
            cy.visit('/robot/OPS42417-7c38660f057e/runs')
            cy.contains('Runs').should('be.visible')

            // Spy on delete run requests
            let deleteDispatched = false
            cy.intercept('DELETE', '**/api/robot/*/run/*', () => {
                deleteDispatched = true
            }).as('spyDeleteRun')

            // Open Delete Run Modal
            cy.contains('button', 'Delete').click()
            cy.contains('Delete Cleaning Run?').should('be.visible')

            // Click Cancel
            cy.contains('button', 'Cancel').click()

            // Dialog closes and content is hidden
            cy.get('dialog[open]').should('not.exist')
            cy.contains('Delete Cleaning Run?').should('not.be.visible')
            cy.then(() => {
                expect(deleteDispatched).to.be.false
            })
        })
    })

    describe('Rapid Fleet Context Switching & State Isolation', () => {
        it('prevents stale state leakage when rapidly toggling between robots', () => {
            cy.visit('/')

            // 1. Visit Sparkles (Gen 3)
            cy.get('aside a[title*="Sparkles"]').click()
            cy.url().should('include', '/robot/OPS42417-7c38660f057e')
            cy.get('aside a[title="Robot & Maintenance"]').click()
            cy.url().should('include', '/settings')
            cy.contains('Neato Gen 3 (Nucleo)').should('be.visible')

            // 2. Rapidly switch to Loki (Gen 4)
            cy.get('aside a[title*="Loki"]').click()
            cy.url().should('include', '/robot/2126LB01A14101917')
            cy.contains('Neato Gen 4 (Orbital)').should('be.visible')

            // 3. Verify Gen 3 specific text is NOT present and Loki's label serial is visible
            cy.contains('Neato Gen 3 (Nucleo)').should('not.exist')
            cy.contains('2127N301A24104005').should('be.visible')
        })
    })

    describe('Server Downtime & Outage Recovery', () => {
        it('handles server network failure during live logs polling gracefully', () => {
            let attempt = 0
            cy.intercept('GET', '**/api/log*', (req) => {
                attempt++
                if (attempt === 1) {
                    req.reply({ fixture: 'server_logs.txt', headers: { 'content-type': 'text/plain' } })
                } else {
                    // Simulate server crash or lost network connection on next poll
                    req.reply({ statusCode: 502, body: 'Bad Gateway' })
                }
            }).as('logsPoll')

            cy.visit('/logs')
            cy.contains('Vacuula Server Logs').should('be.visible')
            cy.contains('Vacuula server starting').should('be.visible')

            // Click manual refresh when server is broken
            cy.contains('button', 'Refresh').click()
            cy.wait('@logsPoll')

            // App must not crash to a blank white screen; previously displayed log content remains intact
            cy.contains('Vacuula Server Logs').should('be.visible')
            cy.contains('Vacuula server starting').should('be.visible')
        })
    })
})
