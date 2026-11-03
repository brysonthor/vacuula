import { useEffect, useId, useRef, type ReactNode } from 'react'
import { IoClose } from 'react-icons/io5'
import styles from './Modal.module.scss'

interface ModalProps {
    open: boolean
    onClose: () => void
    title: string
    children: ReactNode
    footer?: ReactNode
    maxWidth?: string
}

const dialogExtraAttrs = { closedby: 'any' } as Record<string, string>

export default function Modal({ open, onClose, title, children, footer, maxWidth = '48rem' }: ModalProps) {
    const dialogRef = useRef<HTMLDialogElement>(null)
    const titleId = useId()

    useEffect(() => {
        const dialog = dialogRef.current
        if (!dialog) return

        if (open && !dialog.open) {
            dialog.showModal()
        } else if (!open && dialog.open) {
            dialog.close()
        }
    }, [open])

    useEffect(() => {
        const dialog = dialogRef.current
        if (!dialog) return
        const handleClose = () => onClose()
        dialog.addEventListener('close', handleClose)
        return () => dialog.removeEventListener('close', handleClose)
    }, [onClose])

    // Light-dismiss fallback testing pointer position against dialog rect
    const handleDialogClick = (event: React.MouseEvent<HTMLDialogElement>) => {
        const dialog = dialogRef.current
        if (!dialog || event.target !== dialog) return
        const rect = dialog.getBoundingClientRect()
        const clickedOutside =
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
        if (clickedOutside) {
            dialog.close()
        }
    }

    return (
        <dialog
            ref={dialogRef}
            aria-labelledby={titleId}
            className={styles.dialog}
            style={{ maxWidth }}
            onClick={handleDialogClick}
            {...dialogExtraAttrs}
        >
            <div className={styles.inner}>
                <header className={styles.header}>
                    <h2 id={titleId} className={styles.title}>{title}</h2>
                    <button
                        type="button"
                        className={styles.closeBtn}
                        onClick={() => dialogRef.current?.close()}
                        aria-label="Close"
                    >
                        <IoClose size={20} />
                    </button>
                </header>
                <div className={styles.body}>{children}</div>
                {footer && <footer className={styles.footer}>{footer}</footer>}
            </div>
        </dialog>
    )
}
