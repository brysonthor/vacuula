import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RequireRobot } from './requireRobot'

const mockUseApp = vi.fn()

vi.mock('../../context/useApp', () => ({
    useApp: () => mockUseApp(),
}))

describe('RequireRobot', () => {
    it('returns null and does not render children when robot is null or undefined', () => {
        mockUseApp.mockReturnValue({ robot: null })
        const { container } = render(
            <RequireRobot>
                <div>Child Content</div>
            </RequireRobot>
        )
        expect(container.firstChild).toBeNull()
        expect(screen.queryByText('Child Content')).not.toBeInTheDocument()
    })

    it('renders children when robot is provided', () => {
        mockUseApp.mockReturnValue({ robot: { serial: '123', name: 'Neato D7' } })
        render(
            <RequireRobot>
                <div>Child Content</div>
            </RequireRobot>
        )
        expect(screen.getByText('Child Content')).toBeInTheDocument()
    })
})
