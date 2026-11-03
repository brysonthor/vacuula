import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
    isDocked,
    isCharging,
    hasRobotError,
    RobotStateIcon,
    RobotStatusBadges,
} from './robotInfo'
import { RobotType, type Robot } from '../../types'

const mockUseApp = vi.fn()

vi.mock('../../context/useApp', () => ({
    useApp: () => mockUseApp(),
}))

vi.mock('react-i18next', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-i18next')>()
    return {
        ...actual,
        useTranslation: () => ({
            t: (key: string, fallback?: string) => {
                if (key === 'common.offline') return 'Offline'
                return fallback || key
            },
        }),
    }
})

vi.mock('../battery/Battery', () => ({
    default: ({ percentage, isCharging }: { percentage: number; isCharging: boolean }) => (
        <div data-testid="battery" data-charge={percentage} data-charging={isCharging}>
            Battery
        </div>
    ),
}))

describe('robotInfo helpers', () => {
    const gen3Robot = {
        type: RobotType.NeatoGen3,
        serial: 'gen3-123',
        name: 'Sparkles',
        online: true,
        details: { isDocked: true, isCharging: false, charge: 95 },
        error: null,
        alert: null,
    } as unknown as Robot

    const gen4Robot = {
        type: RobotType.NeatoGen4,
        serial: 'gen4-456',
        name: 'Loki',
        online: true,
        details: { is_docked: false, is_charging: true, charge: 80 },
        errors: ['brush_stuck'],
    } as unknown as Robot

    it('correctly determines isDocked across gen3 and gen4', () => {
        expect(isDocked(gen3Robot)).toBe(true)
        expect(isDocked(gen4Robot)).toBe(false)
    })

    it('correctly determines isCharging across gen3 and gen4', () => {
        expect(isCharging(gen3Robot)).toBe(false)
        expect(isCharging(gen4Robot)).toBe(true)
    })

    it('correctly checks for robot errors', () => {
        expect(hasRobotError(gen3Robot)).toBe(false)
        expect(hasRobotError(gen4Robot)).toBe(true)
    })
})

describe('RobotStateIcon and RobotStatusBadges components', () => {
    it('returns null when robot is not present', () => {
        mockUseApp.mockReturnValue({ robot: null })
        const { container: c1 } = render(<RobotStateIcon />)
        const { container: c2 } = render(<RobotStatusBadges />)
        expect(c1.firstChild).toBeNull()
        expect(c2.firstChild).toBeNull()
    })

    it('renders offline indicator when robot is offline', () => {
        mockUseApp.mockReturnValue({
            robot: {
                type: RobotType.NeatoGen3,
                serial: 'gen3-1',
                online: false,
                details: { isDocked: false, isCharging: false, charge: 50 },
            },
        })
        const { container } = render(<RobotStateIcon />)
        expect(container.querySelector('svg')).toBeInTheDocument()

        render(<RobotStatusBadges />)
        expect(screen.getByText('Offline')).toBeInTheDocument()
    })

    it('renders docked icon and battery for docked robot', () => {
        mockUseApp.mockReturnValue({
            robot: {
                type: RobotType.NeatoGen3,
                serial: 'gen3-1',
                online: true,
                details: { isDocked: true, isCharging: true, charge: 100 },
                state: 1, // IDLE
            },
        })
        render(<RobotStatusBadges />)
        const battery = screen.getByTestId('battery')
        expect(battery).toBeInTheDocument()
        expect(battery).toHaveAttribute('data-charge', '100')
        expect(battery).toHaveAttribute('data-charging', 'true')
    })
})
