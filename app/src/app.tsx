import { Navigate, Outlet, Route, Routes, useLocation, useParams } from 'react-router'
import { IoCloudOfflineOutline } from 'react-icons/io5'
import AppLoadingIndicator from './components/appLoadingIndicator/appLoadingIndicator'
import { useIsDesktop } from './components/hooks/useMediaQuery'
import Navbar from './components/navbar/navbar'
import { RequireRobot } from './components/require/requireRobot'
import Sidebar from './components/sidebar/Sidebar'
import Topbar from './components/topbar/topbar'
import { useApp } from './context/useApp'
import Drive from './pages/drive/Drive'
import Fleet from './pages/fleet/Fleet'
import Home from './pages/home/home'
import Loading from './pages/loading/loading'
import Logs from './pages/serverLogs/Logs'
import Map from './pages/map/map'
import RobotSettings from './pages/robotSettings/RobotSettings'
import Runs from './pages/runs/runs'
import Schedule from './pages/schedule/schedule'
import Settings from './pages/settings/settings'
import styles from './app.module.scss'

function RobotWorkspaceLayout() {
    const { serial } = useParams<{ serial: string }>()
    const { robot, robots } = useApp()

    if (!robots) {
        return (
            <div className={styles.workspace}>
                <Loading />
            </div>
        )
    }

    if (!serial || !robots[serial]) {
        return <Navigate to="/" replace />
    }

    if (!robot || robot.serial !== serial) {
        return (
            <div className={styles.workspace}>
                <Loading />
            </div>
        )
    }

    return (
        <>
            {!robot.online && (
                <div className={styles.offlineBanner} role="status">
                    <IoCloudOfflineOutline size={16} />
                    <span>
                        <strong>{robot.name}</strong> is currently offline — viewing saved maps, run history, schedules, and maintenance in read-only mode.
                    </span>
                </div>
            )}
            <div className={styles.workspace}>
                <RequireRobot>
                    <Outlet />
                </RequireRobot>
            </div>
        </>
    )
}

function LegacyRobotRedirect({ subpath }: { subpath: string }) {
    const { robot, robots } = useApp()
    if (!robots) {
        return (
            <div className={styles.workspace}>
                <Loading />
            </div>
        )
    }
    const targetSerial = robot?.serial ?? Object.keys(robots)[0]
    if (!targetSerial) {
        return <Navigate to="/" replace />
    }
    return <Navigate to={`/robot/${encodeURIComponent(targetSerial)}/${subpath}`} replace />
}

const App = () => {
    const isDesktop = useIsDesktop()
    const location = useLocation()

    return (
        <div className={styles.app}>
            <AppLoadingIndicator />

            {isDesktop ? (
                <Sidebar />
            ) : (
                <div className={styles.topbar}>
                    <Topbar />
                </div>
            )}

            <main className={styles.mainArea}>
                <Routes location={location} key={location.pathname}>
                    <Route
                        path="/"
                        element={
                            <div className={styles.workspace}>
                                <Fleet />
                            </div>
                        }
                    />
                    <Route
                        path="settings"
                        element={
                            <div className={styles.workspace}>
                                <Settings />
                            </div>
                        }
                    />
                    <Route
                        path="logs"
                        element={
                            <div className={styles.workspace}>
                                <Logs />
                            </div>
                        }
                    />

                    <Route path="robot/:serial" element={<RobotWorkspaceLayout />}>
                        <Route index element={<Home />} />
                        <Route path="map" element={<Map />} />
                        <Route path="runs" element={<Runs />} />
                        <Route path="schedule" element={<Schedule />} />
                        <Route path="settings" element={<RobotSettings />} />
                        <Route path="drive" element={<Drive />} />
                    </Route>

                    <Route path="map" element={<LegacyRobotRedirect subpath="map" />} />
                    <Route path="runs" element={<LegacyRobotRedirect subpath="runs" />} />
                    <Route path="schedule" element={<LegacyRobotRedirect subpath="schedule" />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
            </main>

            {!isDesktop && (
                <div className={styles.navbar}>
                    <Navbar />
                </div>
            )}
        </div>
    )
}

export default App
