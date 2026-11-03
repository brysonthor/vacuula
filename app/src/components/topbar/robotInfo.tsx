import styles from './robotInfo.module.scss'
import { MdCleaningServices, MdCloudOff, MdError, MdWarning } from 'react-icons/md'
import { IoMdPause } from 'react-icons/io'
import { TbChargingPile } from 'react-icons/tb'
import { GiNightSleep } from 'react-icons/gi'
import { GoDownload } from 'react-icons/go'
import { FaCloudDownloadAlt, FaCloudUploadAlt, FaCopy } from 'react-icons/fa'
import { FaMagnifyingGlassLocation } from 'react-icons/fa6'
import { MdOutlineExplore } from 'react-icons/md'
import { RiTestTubeFill } from 'react-icons/ri'
import type { IconType } from 'react-icons'
import Battery from '../battery/Battery'
import { useRobot } from '../../context/useRobot'
import { RobotType, type Robot } from '../../types'
import { BasicState, resolveRobotState } from '../../utils/state'
import { useTranslation } from 'react-i18next'

export const basicStateIcons: Record<BasicState, IconType> = {
    [BasicState.INVALID]: MdError,
    [BasicState.ERROR]: MdError,
    [BasicState.PAUSED]: IoMdPause,
    [BasicState.IDLE]: GiNightSleep,
    [BasicState.DOCKING]: GoDownload,
    [BasicState.CLEANING]: MdCleaningServices,
    [BasicState.CLEANING_STANDBY]: MdCleaningServices,
    [BasicState.UPDATING]: FaCloudDownloadAlt,
    [BasicState.TEST]: RiTestTubeFill,
    [BasicState.COPYING_LOGS]: FaCopy,
    [BasicState.RECOVERING_LOCATION]: FaMagnifyingGlassLocation,
    [BasicState.EXPLORING_MAP]: MdOutlineExplore,
    [BasicState.ACQUIRING_PERSISTENT_MAP_IDS]: FaCloudDownloadAlt,
    [BasicState.CREATING_UPLOADING_MAP]: FaCloudUploadAlt,
    [BasicState.SUSPENDED_EXPLORATION]: IoMdPause,
}

export function isDocked(robot: Robot) {
    if (robot.type === RobotType.NeatoGen3) return robot.details.isDocked
    if (robot.type === RobotType.NeatoGen4) return robot.details.is_docked
    return false
}

export function isCharging(robot: Robot) {
    if (robot.type === RobotType.NeatoGen3) return robot.details.isCharging
    if (robot.type === RobotType.NeatoGen4) return robot.details.is_charging
    return false
}

export function hasRobotError(robot: Robot) {
    if (robot.type === RobotType.NeatoGen3) return !!robot.error
    if (robot.type === RobotType.NeatoGen4) return !!(robot.errors && robot.errors.length > 0)
    return false
}

export function hasRobotAlert(robot: Robot) {
    if (robot.type === RobotType.NeatoGen3) return !!robot.alert
    return false
}

// Temporarly limit to what the app did until we have manually verified that the same hardware is used in all gen4 robots
// this is to avoid burning out any motors or other components. Also, we have no idea of the D800 and so, so will need to be verified after
// initial release!
export function isGen4D10(_: Robot) {
    return true // allow gen4 robots to use same now that hardware has been verified
}

// leading slot — sits before the name
export function RobotStateIcon() {
    const { robot } = useRobot()
    if (!robot.online) {
        return <MdCloudOff size={22} color="var(--text-muted)" className={styles.stateIcon} />
    }
    const StateIcon = basicStateIcons[resolveRobotState(robot)]
    return <StateIcon size={24} color="var(--accent)" className={styles.stateIcon} />
}

// trailing slot — sits after the name, before the chevron
export function RobotStatusBadges() {
    const { t } = useTranslation()
    const { robot } = useRobot()
    return (
        <div className={styles.status}>
            {!robot.online && <span className={styles.offlineBadge}>{t('common.offline')}</span>}
            {hasRobotError(robot) && <MdError size={16} className={styles.iconErr} />}
            {hasRobotAlert(robot) && <MdWarning size={16} className={styles.iconWarn} />}
            {robot.online && isDocked(robot) && (
                <TbChargingPile size={15} className={styles.iconDocked} title={t('topbar.docked')} />
            )}
            <Battery percentage={robot.details?.charge} isCharging={robot.online && isCharging(robot)} />
        </div>
    )
}
