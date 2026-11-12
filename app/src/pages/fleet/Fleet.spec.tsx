import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import Fleet from './Fleet'
import { Http } from '../../http'
import { GEN3_COMMANDS } from '../../http/gen3'
import { GEN4_COMMANDS } from '../../http/gen4'

const mockUseApp = vi.fn()
const mockNavigate = vi.fn()
const mockSelectRobot = vi.fn()

vi.mock('react-router', () => ({
    useNavigate: () => mockNavigate,
}))

vi.mock('react-i18next', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-i18next')>()
    return {
        ...actual,
        useTranslation: () => ({
            t: (key: string, fallback?: string) => fallback || key,
        }),
    }
})

vi.mock('../../context/useApp', () => ({
    useApp: () => mockUseApp(),
}))

vi.mock('../../mascot', () => ({
    useMascot: () => ({ mascot: 'vacuum' }),
}))

vi.mock('../../i18n/timeago', () => ({
    useTimeAgoFormatter: () => () => 'just now',
}))

vi.mock('../loading/loading', () => ({
    default: () => <div data-testid="loading-indicator">Loading Robots...</div>,
}))

vi.mock('../../http', () => ({
    Http: {
        dockRobot: vi.fn(),
        getVacuulaCert: vi.fn(),
        getServerSchedules: vi.fn().mockResolvedValue({ data: [] }),
    },
}))

vi.mock('../../http/gen3', () => ({
    GEN3_COMMANDS: {
        startCleaning: vi.fn(),
        findMe: vi.fn(),
        getSchedule: vi.fn().mockResolvedValue({ data: { data: { enabled: false, events: [] } } }),
    },
}))

vi.mock('../../http/gen4', () => ({
    GEN4_COMMANDS: {
        startCleaning: vi.fn(),
        findMe: vi.fn(),
        getSchedule: vi.fn().mockResolvedValue({ data: { body: { enabled: true, events: [] } } }),
    },
}))

describe('Fleet Component', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('renders loading state when robots is undefined', () => {
        mockUseApp.mockReturnValue({
            robots: undefined,
            selectRobot: mockSelectRobot,
            zoneQueues: {},
            serverInfo: null,
        })

        render(<Fleet />)
        expect(screen.getByTestId('loading-indicator')).toBeInTheDocument()
    })

    it('re-renders cleanly from loading to loaded state without React error #310', () => {
        mockUseApp.mockReturnValue({
            robots: undefined,
            selectRobot: mockSelectRobot,
            zoneQueues: {},
            serverInfo: null,
        })

        const { rerender } = render(<Fleet />)
        expect(screen.getByTestId('loading-indicator')).toBeInTheDocument()

        // Transition to loaded state
        mockUseApp.mockReturnValue({
            robots: {
                'gen3-serial': {
                    type: 'neato.gen3',
                    name: 'Sparkles',
                    connected: true,
                    charge: 90,
                    is_docked: true,
                    is_charging: false,
                    state_label: 'idle',
                    has_error: false,
                    model: 'BotVacD3Connected',
                    last_seen_at: new Date().toISOString(),
                },
            },
            selectRobot: mockSelectRobot,
            zoneQueues: {},
            serverInfo: null,
        })

        rerender(<Fleet />)
        expect(screen.queryByTestId('loading-indicator')).not.toBeInTheDocument()
        expect(screen.getByText('Sparkles')).toBeInTheDocument()
        expect(screen.getByText('BotVacD3Connected')).toBeInTheDocument()
    })

    it('triggers Http.dockRobot when Return to Base button is clicked', async () => {
        const mockDock = vi.mocked(Http.dockRobot).mockResolvedValue({
            status: 200,
            data: { message: 'Returning to base' },
        } as any)

        mockUseApp.mockReturnValue({
            robots: {
                'gen3-serial': {
                    type: 'neato.gen3',
                    name: 'Sparkles',
                    connected: true,
                    charge: 85,
                    is_docked: false,
                    is_charging: false,
                    state_label: 'cleaning',
                    has_error: false,
                    model: 'BotVacD3Connected',
                    last_seen_at: new Date().toISOString(),
                },
            },
            selectRobot: mockSelectRobot,
            zoneQueues: {},
            serverInfo: null,
        })

        render(<Fleet />)

        const dockButton = screen.getByRole('button', { name: /Base|Dock/i })
        fireEvent.click(dockButton)

        await waitFor(() => {
            expect(mockDock).toHaveBeenCalledWith('gen3-serial')
        })
    })

    it('renders fleet uptime KPI and individual robot uptime counter for online robots', () => {
        const twoHoursFifteenMinThirtySec = 2 * 3600 + 15 * 60 + 30
        mockUseApp.mockReturnValue({
            robots: {
                'sparkles-serial': {
                    type: 'neato.gen3',
                    name: 'Sparkles',
                    connected: true,
                    charge: 80,
                    is_docked: true,
                    is_charging: false,
                    state_label: 'docked',
                    has_error: false,
                    model: 'BotVacD3Connected',
                    uptime: twoHoursFifteenMinThirtySec,
                },
                'dustmite-serial': {
                    type: 'neato.gen3',
                    name: 'Dustmite',
                    connected: false,
                    charge: 10,
                    is_docked: false,
                    is_charging: false,
                    state_label: 'offline',
                    has_error: false,
                    model: 'BotVacD5Connected',
                    last_seen_at: new Date().toISOString(),
                },
            },
            selectRobot: mockSelectRobot,
            zoneQueues: {},
            serverInfo: null,
        })

        render(<Fleet />)

        // 1. Check Fleet summary KPI card for Fleet Uptime
        const kpiUptime = screen.getByTestId('kpi-uptime')
        expect(kpiUptime).toBeInTheDocument()
        expect(kpiUptime).toHaveTextContent('2h 15m 30s')
        expect(screen.getByText('Fleet Uptime')).toBeInTheDocument()

        // 2. Check Sparkles (online) has its own robot uptime counter
        const robotUptime = screen.getByTestId('uptime-sparkles-serial')
        expect(robotUptime).toBeInTheDocument()
        expect(robotUptime).toHaveTextContent('2h 15m 30s')

        // 3. Check Dustmite (offline) does not have robot uptime counter, shows "Seen"
        expect(screen.queryByTestId('uptime-dustmite-serial')).not.toBeInTheDocument()
        expect(screen.getByText(/Seen/i)).toBeInTheDocument()
    })

    it('renders -- for fleet uptime when all robots are offline', () => {
        mockUseApp.mockReturnValue({
            robots: {
                'dustmite-serial': {
                    type: 'neato.gen3',
                    name: 'Dustmite',
                    connected: false,
                    charge: 10,
                    is_docked: false,
                    is_charging: false,
                    state_label: 'offline',
                    has_error: false,
                    model: 'BotVacD5Connected',
                    last_seen_at: new Date().toISOString(),
                },
            },
            selectRobot: mockSelectRobot,
            zoneQueues: {},
            serverInfo: null,
        })

        render(<Fleet />)

        const kpiUptime = screen.getByTestId('kpi-uptime')
        expect(kpiUptime).toBeInTheDocument()
        expect(kpiUptime).toHaveTextContent('--')
    })

    it('shows schedule status badges and Scheduled KPI across Gen 3, Gen 4, and server schedules', async () => {
        vi.mocked(Http.getServerSchedules).mockImplementation((serial: string) => {
            if (serial === 'paused-server-serial') {
                return Promise.resolve({
                    data: [{ id: 's1', enabled: false }],
                } as any)
            }
            return Promise.resolve({ data: [] } as any)
        })

        vi.mocked(GEN3_COMMANDS.getSchedule).mockResolvedValue({
            data: {
                result: 'ok',
                data: {
                    enabled: true,
                    events: [{ mode: 1, day: 1, startTime: '10:30' }],
                },
            },
        } as any)

        vi.mocked(GEN4_COMMANDS.getSchedule).mockImplementation((serial: string) => {
            if (serial === 'gen4-empty-serial') {
                return Promise.resolve({
                    data: { code: 200, body: { enabled: true, events: [] } },
                } as any)
            }
            return Promise.resolve({
                data: { code: 200, body: { enabled: true, events: [] } },
            } as any)
        })

        mockUseApp.mockReturnValue({
            robots: {
                'gen3-sched-serial': {
                    type: 'neato.gen3',
                    name: 'Sparkles',
                    connected: true,
                    charge: 90,
                    is_docked: true,
                    is_charging: false,
                    state_label: 'docked',
                    has_error: false,
                },
                'gen4-empty-serial': {
                    type: 'neato.gen4',
                    name: 'Toothgnasher',
                    connected: true,
                    charge: 62,
                    is_docked: true,
                    is_charging: true,
                    state_label: 'docked',
                    has_error: false,
                },
                'paused-server-serial': {
                    type: 'neato.gen4',
                    name: 'PausedBot',
                    connected: false,
                    charge: 50,
                    is_docked: true,
                    is_charging: false,
                    state_label: 'offline',
                    has_error: false,
                },
            },
            selectRobot: mockSelectRobot,
            zoneQueues: {},
            serverInfo: null,
        })

        render(<Fleet />)

        await waitFor(() => {
            expect(screen.getByTestId('schedule-badge-gen3-sched-serial')).toHaveTextContent('Scheduled')
            expect(screen.getByTestId('schedule-badge-gen4-empty-serial')).toHaveTextContent('No Schedule')
            expect(screen.getByTestId('schedule-badge-paused-server-serial')).toHaveTextContent('Schedule Paused')
        })

        expect(screen.getByTestId('kpi-scheduled')).toHaveTextContent('1')

        fireEvent.click(screen.getByTestId('schedule-badge-gen4-empty-serial'))
        expect(mockSelectRobot).toHaveBeenCalledWith('gen4-empty-serial')
        expect(mockNavigate).toHaveBeenCalledWith('/robot/gen4-empty-serial/schedule')
    })

    it('renders animated SVG state indicators instead of word statuses on robot cards', () => {
        mockUseApp.mockReturnValue({
            robots: {
                'clean-bot': {
                    type: 'neato.gen3',
                    name: 'CleanBot',
                    connected: true,
                    charge: 80,
                    is_docked: false,
                    is_charging: false,
                    state_label: 'cleaning',
                    has_error: false,
                },
                'docked-bot': {
                    type: 'neato.gen4',
                    name: 'DockedBot',
                    connected: true,
                    charge: 95,
                    is_docked: true,
                    is_charging: true,
                    state_label: 'docked',
                    has_error: false,
                },
                'docking-bot': {
                    type: 'neato.gen3',
                    name: 'DockingBot',
                    connected: true,
                    charge: 30,
                    is_docked: false,
                    is_charging: false,
                    state_label: 'docking',
                    has_error: false,
                },
                'paused-bot': {
                    type: 'neato.gen3',
                    name: 'PausedBot',
                    connected: true,
                    charge: 50,
                    is_docked: false,
                    is_charging: false,
                    state_label: 'paused',
                    has_error: false,
                },
                'error-bot': {
                    type: 'neato.gen4',
                    name: 'ErrorBot',
                    connected: true,
                    charge: 60,
                    is_docked: false,
                    is_charging: false,
                    state_label: 'error',
                    has_error: true,
                },
                'offline-bot': {
                    type: 'neato.gen3',
                    name: 'OfflineBot',
                    connected: false,
                    charge: 0,
                    is_docked: false,
                    is_charging: false,
                    state_label: 'offline',
                    has_error: false,
                },
            },
            selectRobot: mockSelectRobot,
            zoneQueues: {},
            serverInfo: null,
        })

        render(<Fleet />)

        const expectedStates: Array<{ state: string; label: string }> = [
            { state: 'cleaning', label: 'cleaning' },
            { state: 'docked', label: 'docked' },
            { state: 'docking', label: 'docking' },
            { state: 'paused', label: 'paused' },
            { state: 'error', label: 'error' },
            { state: 'offline', label: 'Offline' },
        ]

        for (const { state, label } of expectedStates) {
            const indicator = screen.getByRole('img', { name: label })
            expect(indicator).toHaveAttribute('data-state', state)
            expect(indicator.querySelector('svg')).toBeInTheDocument()
        }

        // Plain word statuses should not be rendered as visible text in status pills
        expect(screen.queryByText('Offline')).not.toBeInTheDocument()
        expect(screen.queryByText('docked')).not.toBeInTheDocument()
        expect(screen.queryByText('docking')).not.toBeInTheDocument()
    })
})
