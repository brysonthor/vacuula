import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import Battery from './Battery'

describe('Battery Component', () => {
    it('renders 100% full battery with success color', () => {
        const { container } = render(<Battery percentage={100} />)
        expect(screen.getAllByText('100').length).toBeGreaterThan(0)
        const fillRect = container.querySelector('rect[fill="var(--success)"]')
        expect(fillRect).toBeInTheDocument()
    })

    it('renders 45% warning color', () => {
        const { container } = render(<Battery percentage={45} />)
        expect(screen.getAllByText('45').length).toBeGreaterThan(0)
        const fillRect = container.querySelector('rect[fill="var(--warn)"]')
        expect(fillRect).toBeInTheDocument()
    })

    it('renders 15% error color', () => {
        const { container } = render(<Battery percentage={15} />)
        expect(screen.getAllByText('15').length).toBeGreaterThan(0)
        const fillRect = container.querySelector('rect[fill="var(--err)"]')
        expect(fillRect).toBeInTheDocument()
    })

    it('clamps values below 0 and above 100', () => {
        const { unmount } = render(<Battery percentage={150} />)
        expect(screen.getAllByText('100').length).toBeGreaterThan(0)
        unmount()

        render(<Battery percentage={-20} />)
        expect(screen.getAllByText('0').length).toBeGreaterThan(0)
    })

    it('renders charging bolt when isCharging is true', () => {
        const { container } = render(<Battery percentage={75} isCharging={true} />)
        expect(container.querySelector('foreignObject')).toBeInTheDocument()
    })
})
