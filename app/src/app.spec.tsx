import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { AppProvider } from './context/AppContext'
import App from './app'

const { mockRobotData } = vi.hoisted(() => {
    return {
        mockRobotData: {
            'OPS42417-7c38660f057e': {
                serial: 'OPS42417-7c38660f057e',
                name: 'Sparkles',
                type: 0, // RobotType.NeatoGen3
                connected: true,
                charge: 97,
                is_charging: false,
                is_docked: true,
                state_label: 'idle',
            },
        },
    }
})

vi.mock('react-i18next', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-i18next')>()
    return {
        ...actual,
        useTranslation: () => ({
            t: (key: string, fallback?: string) => fallback || key,
        }),
    }
})

vi.mock('./i18n/timeago', () => ({
    useTimeAgoFormatter: () => () => 'just now',
}))

vi.mock('./loaders/usePersistentMaps', () => ({
    usePersistentMaps: () => ({ data: [] }),
}))

vi.mock('./loaders/useGetPromotedFloorplan', () => ({
    useGetPromotedFloorplan: () => vi.fn().mockResolvedValue(undefined),
}))

vi.mock('./http', () => ({
    BASE_PATH: '',
    Http: {
        getRobots: vi.fn().mockResolvedValue({ data: mockRobotData }),
        getServerInfo: vi.fn().mockResolvedValue({
            data: {
                version: '1.0.0',
                min_installer_version: '1.0.0',
                gen3_port: 8080,
                gen4_port: 8081,
                timezone: 'UTC',
                utc_offset_minutes: 0,
            },
        }),
        getBoundaries: vi.fn().mockResolvedValue({ data: [] }),
        getPersistentMaps: vi.fn().mockResolvedValue({ data: [] }),
        getCleanings: vi.fn().mockResolvedValue({ data: [] }),
        driveStatus: vi.fn().mockResolvedValue({ data: { connected: false } }),
        getZoneQueue: vi.fn().mockResolvedValue({ data: { queue: null } }),
        getRobotTelemetry: vi.fn().mockResolvedValue({ data: {} }),
        setLoadingStateCallback: vi.fn(),
    },
}))

vi.mock('./http/gen3', () => ({
    GEN3_COMMANDS: {
        getRobotState: vi.fn().mockResolvedValue({
            data: {
                availableCommands: { start: true, stop: false, pause: false, resume: false, goToBase: false },
                availableServices: { manualCleaning: 'basic-1', spotCleaning: 'basic-3' },
                cleaning: {},
                details: { charge: 97, isCharging: false, isDocked: true },
                state: 1,
                action: 0,
            },
        }),
    },
}))

// Mock EventSource
class MockEventSource {
    addEventListener = vi.fn()
    removeEventListener = vi.fn()
    close = vi.fn()
}
(globalThis as any).EventSource = MockEventSource

describe('App Route State Changes', () => {
    beforeEach(() => {
        window.matchMedia = vi.fn().mockImplementation((query) => ({
            matches: true, // desktop
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }))
    })

    it('navigates from robot page to fleet overview and hides robot workspace menu in sidebar', async () => {
        render(
            <AppProvider>
                <MemoryRouter initialEntries={['/robot/OPS42417-7c38660f057e']}>
                    <App />
                </MemoryRouter>
            </AppProvider>
        )

        // Wait for robot workspace to load
        await waitFor(() => {
            expect(screen.getAllByText('Command Center').length).toBeGreaterThan(0)
        })

        // Click Fleet Overview in Sidebar
        const fleetNav = screen.getByTitle('Fleet Overview')
        fireEvent.click(fleetNav)

        // Does Fleet Overview render?
        await waitFor(() => {
            expect(screen.getByText('Live status, quick actions, and diagnostics across your Vacuula server.')).toBeDefined()
        })

        // On Fleet Overview, the robot workspace navigation links (e.g. Command Center) should no longer be rendered
        expect(screen.queryByText('Command Center')).toBeNull()
    })

    it('navigates from fleet overview to robot and back to fleet overview', async () => {
        render(
            <AppProvider>
                <MemoryRouter initialEntries={['/']}>
                    <App />
                </MemoryRouter>
            </AppProvider>
        )

        // Initially at Fleet Overview
        await waitFor(() => {
            expect(screen.getByText('Live status, quick actions, and diagnostics across your Vacuula server.')).toBeDefined()
        })
        expect(screen.queryByText('Command Center')).toBeNull()

        // Click robot in sidebar to open workspace
        const robotRow = screen.getByTitle('Sparkles (Online)')
        fireEvent.click(robotRow)

        // Command Center should now be present
        await waitFor(() => {
            expect(screen.getAllByText('Command Center').length).toBeGreaterThan(0)
        })

        // Click Fleet Overview
        const fleetNav = screen.getByTitle('Fleet Overview')
        fireEvent.click(fleetNav)

        // Should return to Fleet Overview and hide Command Center
        await waitFor(() => {
            expect(screen.getByText('Live status, quick actions, and diagnostics across your Vacuula server.')).toBeDefined()
        })
        expect(screen.queryByText('Command Center')).toBeNull()
    })
})
