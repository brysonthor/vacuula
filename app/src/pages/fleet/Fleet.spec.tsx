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
})
