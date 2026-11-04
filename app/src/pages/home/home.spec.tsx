import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import Home from './home'
import Drive from '../drive/Drive'
import { RobotType } from '../../types'

vi.mock('react-i18next', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-i18next')>()
    return {
        ...actual,
        useTranslation: () => ({
            t: (key: string, fallback?: string) => fallback || key,
        }),
    }
})

vi.mock('../../i18n/timeago', () => ({
    useTimeAgoFormatter: () => () => 'just now',
}))

const mockRobot = {
    serial: 'OPS42417-7c38660f057e',
    name: 'Sparkles',
    type: RobotType.NeatoGen3,
    online: true,
    details: { charge: 97, isCharging: false, isDocked: true },
    availableServices: { manualCleaning: 'basic-1', spotCleaning: 'basic-3' },
    availableCommands: { start: true, stop: false, pause: false, resume: false, goToBase: false },
    state: 1,
    action: 0,
}

vi.mock('../../context/useRobot', () => ({
    useRobot: () => ({
        robot: mockRobot,
    }),
}))

vi.mock('../../context/useApp', () => ({
    useApp: () => ({
        robot: mockRobot,
        robots: { [mockRobot.serial]: mockRobot },
        selectRobot: vi.fn(),
        zoneQueues: {},
    }),
}))

vi.mock('../../loaders/usePersistentMaps', () => ({
    usePersistentMaps: () => ({ data: [] }),
}))

vi.mock('../../loaders/useGetPromotedFloorplan', () => ({
    useGetPromotedFloorplan: () => vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../http', () => ({
    Http: {
        getBoundaries: vi.fn().mockResolvedValue({ data: [] }),
        getCleanings: vi.fn().mockResolvedValue({ data: [] }),
        driveStatus: vi.fn().mockResolvedValue({ data: { connected: false } }),
    },
}))

describe('Full Route Navigation to Drive', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        window.matchMedia = vi.fn().mockImplementation((query) => ({
            matches: true,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }))
    })

    it('mounts Drive view when clicking Remote Drive button', async () => {
        render(
            <MemoryRouter initialEntries={['/robot/OPS42417-7c38660f057e']}>
                <Routes>
                    <Route path="robot/:serial">
                        <Route index element={<Home />} />
                        <Route path="drive" element={<Drive />} />
                    </Route>
                </Routes>
            </MemoryRouter>
        )

        const driveBtn = screen.getByText('Remote Drive')
        fireEvent.click(driveBtn)

        await waitFor(() => {
            expect(screen.getByText(/Manual Remote Drive — Sparkles/)).toBeDefined()
        })
    })
})
