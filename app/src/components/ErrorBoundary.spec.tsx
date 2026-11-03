import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ErrorBoundary } from './ErrorBoundary'

const ThrowingComponent = ({ shouldThrow }: { shouldThrow: boolean }) => {
    if (shouldThrow) {
        throw new Error('Test explosion')
    }
    return <div>Normal Content</div>
}

describe('ErrorBoundary', () => {
    it('renders children when there is no error', () => {
        render(
            <ErrorBoundary>
                <ThrowingComponent shouldThrow={false} />
            </ErrorBoundary>
        )
        expect(screen.getByText('Normal Content')).toBeInTheDocument()
    })

    it('catches render errors and displays fallback UI', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

        render(
            <ErrorBoundary>
                <ThrowingComponent shouldThrow={true} />
            </ErrorBoundary>
        )

        expect(screen.getByText('Something went wrong')).toBeInTheDocument()
        expect(screen.getAllByText(/Test explosion/).length).toBeGreaterThan(0)
        expect(screen.getByRole('button', { name: /Reload/i })).toBeInTheDocument()

        spy.mockRestore()
    })

    it('navigates to root when reload button is clicked', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
        // JSDOM allows setting window.location.href via delete / redefine
        delete (window as any).location
        ;(window as any).location = { href: '/previous/path' }

        render(
            <ErrorBoundary>
                <ThrowingComponent shouldThrow={true} />
            </ErrorBoundary>
        )

        const button = screen.getByRole('button', { name: /Reload/i })
        fireEvent.click(button)
        expect(window.location.href).toBe('/')

        spy.mockRestore()
    })
})
