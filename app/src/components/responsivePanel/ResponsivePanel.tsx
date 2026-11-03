import type { ReactNode } from 'react'
import { FaArrowLeft } from 'react-icons/fa'
import { IoClose } from 'react-icons/io5'
import Drawer from '../drawer/drawer'
import { useIsDesktop } from '../hooks/useMediaQuery'
import styles from './ResponsivePanel.module.scss'

interface ResponsivePanelProps {
    open: boolean
    onOpenChange?: (open: boolean) => void
    handle?: boolean
    openHeightPercent?: number
    title?: string
    showBackButton?: boolean
    onBackButtonClick?: () => void
    /** On desktop, keep panel docked even when `open` is false (e.g. Map Studio inspector) */
    alwaysDockedDesktop?: boolean
    /** Show close button on desktop header when closable */
    closableDesktop?: boolean
    width?: string
    children: ReactNode
}

export default function ResponsivePanel({
    open,
    onOpenChange,
    handle = false,
    openHeightPercent = 65,
    title,
    showBackButton,
    onBackButtonClick,
    alwaysDockedDesktop = false,
    closableDesktop = false,
    width = '38rem',
    children,
}: ResponsivePanelProps) {
    const isDesktop = useIsDesktop()

    if (!isDesktop) {
        return (
            <Drawer
                open={open}
                onOpenChange={onOpenChange}
                handle={handle}
                openHeightPercent={openHeightPercent}
                title={title}
                showBackButton={showBackButton}
                onBackButtonClick={onBackButtonClick}
            >
                {children}
            </Drawer>
        )
    }

    if (!alwaysDockedDesktop && !open) {
        return null
    }

    return (
        <aside className={styles.sidePanel} style={{ width }}>
            {(title || showBackButton || closableDesktop) && (
                <header className={styles.header}>
                    <div className={styles.headerLeft}>
                        {showBackButton && (
                            <button
                                type="button"
                                className={styles.iconBtn}
                                onClick={onBackButtonClick}
                                aria-label="Back"
                            >
                                <FaArrowLeft size={15} />
                            </button>
                        )}
                        {title && <h2 className={styles.title}>{title}</h2>}
                    </div>
                    {closableDesktop && onOpenChange && (
                        <button
                            type="button"
                            className={styles.iconBtn}
                            onClick={() => onOpenChange(false)}
                            aria-label="Close panel"
                        >
                            <IoClose size={18} />
                        </button>
                    )}
                </header>
            )}
            <div className={styles.content}>
                {children}
            </div>
        </aside>
    )
}
