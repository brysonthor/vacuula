import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import Fleet from './Fleet'
import { Http } from '../../http'

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
})
