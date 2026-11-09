/// <reference types="cypress" />

export interface MockOverrides {
    server?: any
    robots?: any
    gen3State?: any
    gen4State?: any
    maps?: any
    mapDetails?: any
    boundaries?: any
    runs?: any
    consumables?: any
    schedules?: any
    notifications?: any
    logs?: any
    telemetry?: any
}

declare global {
    namespace Cypress {
        interface Chainable {
            setupVacuulaMocks(overrides?: MockOverrides): Chainable<void>
            setDesktopViewport(): Chainable<void>
            setMobileViewport(): Chainable<void>
            setTabletViewport(): Chainable<void>
        }
    }
}

Cypress.Commands.add('setupVacuulaMocks', (overrides = {}) => {
    // Intercept server info
    cy.intercept('GET', '**/api/server', overrides.server ? overrides.server : { fixture: 'server_info.json' }).as('getServerInfo')

    // Intercept robots fleet
    cy.intercept('GET', '**/api/robots', overrides.robots ? overrides.robots : { fixture: 'robots.json' }).as('getRobots')

    // Intercept maps
    cy.intercept('GET', '**/api/robot/*/maps', overrides.maps ? overrides.maps : { fixture: 'gen3_maps.json' }).as('getMaps')
    cy.intercept('GET', '**/api/robot/*/maps/*', overrides.mapDetails ? overrides.mapDetails : { fixture: 'gen3_map_details.json' }).as('getMapDetails')
    cy.intercept('GET', '**/api/robot/*/maps/*/boundaries', overrides.boundaries ? overrides.boundaries : { fixture: 'boundaries.json' }).as('getBoundaries')

    // Intercept runs
    cy.intercept('GET', '**/api/robot/*/runs', overrides.runs ? overrides.runs : { fixture: 'cleanings.json' }).as('getRuns')
    cy.intercept('GET', '**/api/robot/*/run/*', (req) => {
        req.reply({
            fixture: 'gen3_map_details.json',
        })
    }).as('getRunDetails')

    // Intercept consumables
    cy.intercept('GET', '**/api/robot/*/consumables', overrides.consumables ? overrides.consumables : { fixture: 'consumables.json' }).as('getConsumables')
    cy.intercept('POST', '**/api/robot/*/consumables/reset', {
        body: [
            {
                consumable: 'filter',
                used_hours: 0,
                threshold_hours: 120.0,
                remaining_hours: 120.0,
                percent_remaining: 100.0,
                reset_at: new Date().toISOString(),
                needs_attention: false,
            },
            {
                consumable: 'main_brush',
                used_hours: 0,
                threshold_hours: 300.0,
                remaining_hours: 300.0,
                percent_remaining: 100.0,
                reset_at: new Date().toISOString(),
                needs_attention: false,
            },
            {
                consumable: 'side_brush',
                used_hours: 0,
                threshold_hours: 200.0,
                remaining_hours: 200.0,
                percent_remaining: 100.0,
                reset_at: new Date().toISOString(),
                needs_attention: false,
            },
            {
                consumable: 'sensors',
                used_hours: 0,
                threshold_hours: 30.0,
                remaining_hours: 30.0,
                percent_remaining: 100.0,
                reset_at: new Date().toISOString(),
                needs_attention: false,
            },
        ],
    }).as('resetConsumable')

    // Intercept schedules
    cy.intercept('GET', '**/api/robot/*/server-schedules', overrides.schedules ? overrides.schedules : { fixture: 'server_schedules.json' }).as('getSchedules')
    cy.intercept('POST', '**/api/robot/*/server-schedules', (req) => {
        req.reply({
            statusCode: 200,
            body: {
                id: 'sched-new-created',
                robot: req.url.split('/')[5] || 'OPS42417-7c38660f057e',
                name: req.body?.name || 'New Test Schedule',
                enabled: true,
                schedule_type: req.body?.schedule_type || 'recurring',
                days: req.body?.days || ['mon', 'wed'],
                time_hhmm: req.body?.time_hhmm || '10:00',
                payload: req.body?.payload || { mode: 1, navigationMode: 1 },
                created_at: new Date().toISOString(),
            },
        })
    }).as('createSchedule')
    cy.intercept('DELETE', '**/api/robot/*/server-schedules/*', { body: { deleted: true } }).as('deleteSchedule')

    let skipStateMock: { active: boolean; skip_until_iso?: string } = { active: false }
    cy.intercept('GET', '**/api/robot/*/schedule-skip', (req) => {
        req.reply(skipStateMock)
    }).as('getScheduleSkip')
    cy.intercept('POST', '**/api/robot/*/schedule-skip', (req) => {
        skipStateMock = { active: true, skip_until_iso: '2026-11-10T09:00:00Z' }
        req.reply(skipStateMock)
    }).as('postScheduleSkip')
    cy.intercept('DELETE', '**/api/robot/*/schedule-skip', (req) => {
        skipStateMock = { active: false }
        req.reply(skipStateMock)
    }).as('deleteScheduleSkip')

    // Intercept telemetry
    cy.intercept('GET', '**/api/robot/*/telemetry*', overrides.telemetry ? overrides.telemetry : { fixture: 'telemetry.json' }).as('getTelemetry')

    // Intercept notifications
    cy.intercept('GET', '**/api/settings/notifications', overrides.notifications ? overrides.notifications : { fixture: 'notifications.json' }).as('getNotifications')
    cy.intercept('POST', '**/api/settings/notifications', { body: { ok: true } }).as('saveNotifications')
    cy.intercept('POST', '**/api/settings/notifications/test', {
        body: { ok: true, message: 'Notification test sent successfully!' },
    }).as('testNotification')

    // Intercept logs
    cy.intercept('GET', '**/api/log*', overrides.logs ? overrides.logs : { fixture: 'server_logs.txt', headers: { 'content-type': 'text/plain' } }).as('getServerLogs')

    // Intercept certificate
    cy.intercept('GET', '**/api/cert', { body: '-----BEGIN CERTIFICATE-----\nVACUULA_TEST_CERTIFICATE\n-----END CERTIFICATE-----\n' }).as('getCert')

    // Intercept commands
    cy.intercept('POST', '**/api/robot/*/command', (req) => {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
        if (body.cmd === 'getRobotState') {
            if (overrides.gen3State) {
                req.reply(overrides.gen3State)
            } else {
                req.reply({ fixture: 'gen3_state.json' })
            }
        } else if (body.cmd === 'getMapBoundaries') {
            req.reply({
                version: 1,
                result: 'ok',
                data: {
                    boundaries: [
                        {
                            id: 'nogo-line-1',
                            name: 'Pet Bowls',
                            type: 'polyline',
                            color: '#e74c3c',
                            enabled: true,
                            vertices: [[0.1, 0.1], [0.2, 0.2]],
                        },
                        {
                            id: 'zone-1',
                            name: 'Kitchen',
                            type: 'polygon',
                            color: '#3498db',
                            enabled: true,
                            vertices: [[0.3, 0.3], [0.5, 0.3], [0.5, 0.5], [0.3, 0.5]],
                        },
                    ],
                },
            })
        } else if (body.cmd === 'getSchedule') {
            req.reply({
                version: 1,
                result: 'ok',
                data: {
                    enabled: true,
                    events: [
                        {
                            day: 1,
                            startTime: '09:00',
                            mode: 1,
                            modifier: 1,
                            navigationMode: 1,
                        },
                    ],
                },
            })
        } else if (body.ability === 'state.show') {
            if (overrides.gen4State) {
                req.reply(overrides.gen4State)
            } else {
                req.reply({ fixture: 'gen4_state.json' })
            }
        } else {
            req.reply({ statusCode: 200, body: { result: 'ok' } })
        }
    }).as('sendCommand')

    // Intercept robot update
    cy.intercept('POST', '**/api/robot/*', { body: { ok: true } }).as('updateRobot')

    // Intercept dock robot
    cy.intercept('POST', '**/api/robot/*/dock', { body: { ok: true, message: 'Returning to base' } }).as('dockRobot')

    // Intercept zone queues
    cy.intercept('GET', '**/api/robot/*/zone-queue', { body: { queue: null } }).as('getZoneQueue')
})

Cypress.Commands.add('setDesktopViewport', () => {
    cy.viewport(1280, 800)
})

Cypress.Commands.add('setMobileViewport', () => {
    cy.viewport(390, 844)
})

Cypress.Commands.add('setTabletViewport', () => {
    cy.viewport(768, 1024)
})
