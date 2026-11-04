import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import HeaderLoadingSpinner from './HeaderLoadingSpinner'
import * as useAppModule from '../../context/useApp'

vi.mock('react-i18next', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-i18next')>()
    return {
        ...actual,
        useTranslation: () => ({
            t: (key: string, fallback?: string) => fallback || key,
        }),
    }
})

describe('HeaderLoadingSpinner', () => {
    it('renders nothing when isLoading is false', () => {
        vi.spyOn(useAppModule, 'useApp').mockReturnValue({
            isLoading: false,
        } as any)

        const { container } = render(<HeaderLoadingSpinner />)
        expect(container.firstChild).toBeNull()
    })

    it('renders non-blocking spinning icon with status role when isLoading is true', () => {
        vi.spyOn(useAppModule, 'useApp').mockReturnValue({
            isLoading: true,
        } as any)

        render(<HeaderLoadingSpinner size={18} />)
        const spinner = screen.getByRole('status')
        expect(spinner).toBeDefined()
        expect(spinner.getAttribute('title')).toBe('Syncing with Vacuula...')
    })
})
