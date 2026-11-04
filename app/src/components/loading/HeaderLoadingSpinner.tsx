import { IoMdRefresh } from 'react-icons/io'
import { useTranslation } from 'react-i18next'
import { useApp } from '../../context/useApp'
import styles from './HeaderLoadingSpinner.module.scss'

export default function HeaderLoadingSpinner({ size = 16 }: { size?: number }) {
    const { isLoading } = useApp()
    const { t } = useTranslation()

    if (!isLoading) return null

    return (
        <span
            className={styles.headerSpinner}
            title={t('common.syncing', 'Syncing with Vacuula...')}
            aria-label={t('common.syncing', 'Syncing with Vacuula...')}
            role="status"
        >
            <IoMdRefresh size={size} className={styles.spin} />
        </span>
    )
}
