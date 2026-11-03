import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Modal from './Modal'

describe('Modal Component', () => {
    beforeEach(() => {
        HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
            this.open = true
        })
        HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
            this.open = false
            this.dispatchEvent(new Event('close'))
        })
    })

    it('renders dialog when open is true', () => {
        const onClose = vi.fn()
        render(
            <Modal open={true} onClose={onClose} title="Test Modal">
                <div>Modal Content Here</div>
            </Modal>
        )

        expect(screen.getByText('Test Modal')).toBeInTheDocument()
        expect(screen.getByText('Modal Content Here')).toBeInTheDocument()
    })

    it('invokes onClose when clicking close button', () => {
        const onClose = vi.fn()
        render(
            <Modal open={true} onClose={onClose} title="Test Modal">
                <div>Body</div>
            </Modal>
        )

        const closeBtn = screen.getByRole('button')
        fireEvent.click(closeBtn)
        expect(HTMLDialogElement.prototype.close).toHaveBeenCalled()
    })
})
