import styles from './map.module.scss'
import { useMap } from './useMap'
import { useRobot } from '../../context/useRobot'
import { RobotType } from '../../types'
import Button from '../button/button'
import { Http } from '../../http'
import { usePersistentMap } from '../../loaders/resources'
import { useTranslation } from 'react-i18next'
import { useCallback, useEffect, useState } from 'react'
import { FaMinus, FaPlus } from 'react-icons/fa'
import { MdFilterCenterFocus } from 'react-icons/md'
import { drawBase, onDockImageReady } from './drawingFunctions'
import type { ExtraDrawFn } from './useMap'
import { extractBasePose } from './utils'
import { isCharging, isDocked } from '../topbar/robotInfo'

interface MapProps {
    mapId: string
    runId?: string
}

export default function Map({ mapId, runId }: MapProps) {
    const { t } = useTranslation()
    const { robot } = useRobot()
    const { data: persistantMapData, refresh: refreshPersistantMapData } = usePersistentMap(mapId)

    const [dockReady, setDockReady] = useState(false)
    useEffect(() => { onDockImageReady(() => setDockReady(true)) }, [])

    const extraDraw = useCallback<ExtraDrawFn>((ctx, _canvas, zoom, offset, mapSize) => {
        if (!persistantMapData) return
        const b = extractBasePose(persistantMapData)
        if (b) {
            drawBase(ctx, b.pose, zoom, offset, mapSize, b.resolution, {
                isDocked: isDocked(robot),
                isCharging: isCharging(robot),
                charge: robot.details?.charge,
                isOnline: robot.online,
            })
        }
    }, [persistantMapData, dockReady, robot])

    const { canvasRef, isDragging, canvasHandlers, resetView, zoomBy } = useMap({
        mapId,
        runId,
        extraDraw,
        redrawKey: extraDraw,
    })

    return (
        <div className={styles.root}>
            <div className={styles.container}>
                <canvas
                    ref={canvasRef}
                    className={styles.canvas}
                    {...canvasHandlers}
                    style={{
                        cursor: isDragging ? 'grabbing' : 'grab',
                        touchAction: 'none'
                    }}
                />
                <div className={styles.zoomToolbar}>
                    <button
                        type="button"
                        className={styles.zoomBtn}
                        onClick={() => zoomBy(1.25)}
                        title={t('map.zoomIn', 'Zoom In')}
                    >
                        <FaPlus size={13} />
                    </button>
                    <button
                        type="button"
                        className={styles.zoomBtn}
                        onClick={() => zoomBy(0.8)}
                        title={t('map.zoomOut', 'Zoom Out')}
                    >
                        <FaMinus size={13} />
                    </button>
                    <button
                        type="button"
                        className={styles.zoomBtn}
                        onClick={resetView}
                        title={t('map.resetView', 'Reset View')}
                    >
                        <MdFilterCenterFocus size={16} />
                    </button>
                </div>
            </div>
            {robot.type === RobotType.NeatoGen4 && !persistantMapData?.in_maps_list && (
                <div className={styles.actionFooter}>
                    <Button text={t('map.useAsFloormap')} style='success' onClick={() => { Http.postUseMapAsFloorPlan(robot.serial, mapId).then(refreshPersistantMapData) }} />
                </div>
            )}
        </div>
    )
}
