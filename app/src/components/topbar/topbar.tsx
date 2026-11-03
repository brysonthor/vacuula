import { RequireRobot } from '../require/requireRobot'
import RobotSwitcher from './robotSwitcher'
import { RobotStateIcon, RobotStatusBadges } from './robotInfo'

export default function Topbar() {
    return (
        <RobotSwitcher
            icon={
                <RequireRobot>
                    <RobotStateIcon />
                </RequireRobot>
            }
        >
            <RequireRobot>
                <RobotStatusBadges />
            </RequireRobot>
        </RobotSwitcher>
    )
}
