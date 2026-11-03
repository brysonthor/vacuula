import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import RingProgress from './RingProgress'

describe('RingProgress Component', () => {
    it('renders with correct dimensions and accent color for high percentage', () => {
        const { container } = render(<RingProgress pct={80} size={200} />)
        const svg = container.querySelector('svg')
        expect(svg).toHaveAttribute('width', '200')
        expect(svg).toHaveAttribute('height', '200')

        const progressCircle = container.querySelectorAll('circle')[1]
        expect(progressCircle).toHaveAttribute('stroke', 'var(--accent)')
    })

    it('renders error color when hasError is true', () => {
        const { container } = render(<RingProgress pct={80} hasError={true} />)
        const progressCircle = container.querySelectorAll('circle')[1]
        expect(progressCircle).toHaveAttribute('stroke', 'var(--err)')
    })

    it('renders warning color when percentage is between 21 and 40', () => {
        const { container } = render(<RingProgress pct={35} />)
        const progressCircle = container.querySelectorAll('circle')[1]
        expect(progressCircle).toHaveAttribute('stroke', 'var(--warn)')
    })

    it('renders error color when percentage is <= 20', () => {
        const { container } = render(<RingProgress pct={15} />)
        const progressCircle = container.querySelectorAll('circle')[1]
        expect(progressCircle).toHaveAttribute('stroke', 'var(--err)')
    })
})
