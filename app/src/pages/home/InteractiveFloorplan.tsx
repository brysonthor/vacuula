import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FaMinus, FaPlus } from 'react-icons/fa'
import { MdFilterCenterFocus } from 'react-icons/md'
import { drawBase, drawNoGoLines, drawZones, onDockImageReady, type BasePose } from '../../components/map/drawingFunctions'
import type { NoGoLine, Zone } from '../../components/map/types'
import { useMap, type ExtraDrawFn } from '../../components/map/useMap'
import { extractBasePose, getCanvasPointerWorldCoords, isPointInPolygon } from '../../components/map/utils'
import { usePersistentMap } from '../../loaders/resources'
import styles from './home.module.scss'

interface InteractiveFloorplanProps {
    mapId: string
    boundaries: (NoGoLine | Zone)[]
    selectedZoneIds: string[]
    onToggleZone: (zoneId: string) => void
    basePose?: BasePose | null
    resolution?: number
    interactive?: boolean
    isDocked?: boolean
    isCharging?: boolean
    charge?: number
    isOnline?: boolean
    activeZoneId?: string
}

export default function InteractiveFloorplan({
    mapId,
    boundaries,
    selectedZoneIds,
    onToggleZone,
    basePose,
    resolution = 40,
    interactive = true,
    isDocked,
    isCharging,
    charge,
    isOnline,
    activeZoneId,
}: InteractiveFloorplanProps) {
    const [dockTick, setDockTick] = useState(0)
    const [hoveredZoneId, setHoveredZoneId] = useState<string | undefined>()
    const lastTouchPosRef = useRef<{ x: number; y: number } | null>(null)
    const { data: persistantMapData } = usePersistentMap(mapId)

    useEffect(() => {
        onDockImageReady(() => setDockTick(n => n + 1))
    }, [])

    const resolvedBase = useMemo(() => {
        if (basePose) return { pose: basePose, resolution }
        if (persistantMapData) {
            return extractBasePose(persistantMapData)
        }
        return null
    }, [basePose, persistantMapData, resolution])

    const selectedOrderMap = useMemo(() => {
        const out: Record<string, number> = {}
        selectedZoneIds.forEach((id, idx) => {
            out[id] = idx + 1
        })
        return out
    }, [selectedZoneIds])

    const cleaningZones = useMemo(
        () =>
            boundaries.filter(
                (b): b is Zone =>
                    b.type === 'polygon' &&
                    b.enabled !== false &&
                    (b.function === 'cleaning' || b.function === undefined)
            ),
        [boundaries]
    )

    const nogoPolys = useMemo(
        () =>
            boundaries.filter(
                (b): b is Zone => b.type === 'polygon' && b.enabled !== false && b.function === 'nogo'
            ),
        [boundaries]
    )

    const nogoLines = useMemo(
        () => boundaries.filter((b): b is NoGoLine => b.type === 'polyline' && b.enabled !== false),
        [boundaries]
    )

    const extraDraw = useCallback<ExtraDrawFn>(
        (ctx, _canvas, z, off, mSize) => {
            drawNoGoLines(ctx, nogoLines, z, off, mSize)
            drawZones(ctx, nogoPolys, z, off, mSize, { showLabels: false })
            drawZones(ctx, cleaningZones, z, off, mSize, {
                showLabels: true,
                selectedOrderMap,
                highlightedId: hoveredZoneId,
                activeZoneId,
            })
            if (resolvedBase) {
                drawBase(ctx, resolvedBase.pose, z, off, mSize, resolvedBase.resolution, {
                    isDocked,
                    isCharging,
                    charge,
                    isOnline,
                })
            }
        },
        [
            nogoLines,
            nogoPolys,
            cleaningZones,
            selectedOrderMap,
            hoveredZoneId,
            resolvedBase,
            activeZoneId,
            isDocked,
            isCharging,
            charge,
            isOnline,
        ]
    )

    const { canvasRef, mapSize, zoom, offset, isDragging, hasMoved, canvasHandlers, resetView, zoomBy } = useMap({
        mapId,
        extraDraw,
        redrawKey: [
            boundaries,
            selectedOrderMap,
            hoveredZoneId,
            dockTick,
            resolvedBase,
            activeZoneId,
            isDocked,
            isCharging,
            charge,
            isOnline,
        ],
        backgroundToken: '--map-editor-bg',
    })

    const findHitZone = (clientX: number, clientY: number): Zone | undefined => {
        const canvas = canvasRef.current
        if (!canvas || !mapSize) return undefined
        const pt = getCanvasPointerWorldCoords(canvas, clientX, clientY, offset, zoom, mapSize)
        // Reverse order so top-most / smaller zone wins if overlapping
        for (let i = cleaningZones.length - 1; i >= 0; i--) {
            if (isPointInPolygon(pt, cleaningZones[i].vertices)) {
                return cleaningZones[i]
            }
        }
        return undefined
    }

    const handleMouseMove = (e: React.MouseEvent) => {
        canvasHandlers.onMouseMove(e)
        if (!interactive || isDragging) return
        const hit = findHitZone(e.clientX, e.clientY)
        setHoveredZoneId(hit?.id)
    }

    const handleMouseUp = (e: React.MouseEvent) => {
        const moved = hasMoved
        canvasHandlers.onMouseUp()
        if (!interactive || moved || e.button !== 0) return
        const hit = findHitZone(e.clientX, e.clientY)
        if (hit) {
            onToggleZone(hit.id)
        }
    }

    const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
        if (e.touches.length === 1) {
            lastTouchPosRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
        } else {
            lastTouchPosRef.current = null
        }
        canvasHandlers.onTouchStart(e)
    }

    const handleTouchEnd = (e: React.TouchEvent<HTMLCanvasElement>) => {
        const moved = hasMoved
        const pos = lastTouchPosRef.current
        canvasHandlers.onTouchEnd(e)
        if (!interactive || moved || !pos) return
        const hit = findHitZone(pos.x, pos.y)
        if (hit) {
            onToggleZone(hit.id)
        }
    }

    return (
        <div className={styles.floorplanCanvasBox}>
            <canvas
                ref={canvasRef as React.RefObject<HTMLCanvasElement>}
                className={styles.floorplanCanvas}
                onMouseDown={canvasHandlers.onMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={() => {
                    setHoveredZoneId(undefined)
                    canvasHandlers.onMouseLeave()
                }}
                onWheel={canvasHandlers.onWheel}
                onTouchStart={handleTouchStart}
                onTouchMove={canvasHandlers.onTouchMove}
                onTouchEnd={handleTouchEnd}
                style={{
                    cursor: isDragging ? 'grabbing' : hoveredZoneId ? 'pointer' : 'grab',
                    touchAction: 'none',
                }}
            />
            <div className={styles.mapZoomBar}>
                <button type="button" className={styles.zoomBtn} onClick={() => zoomBy(1.25)} aria-label="Zoom in" title="Zoom in">
                    <FaPlus size={12} />
                </button>
                <button type="button" className={styles.zoomBtn} onClick={() => zoomBy(0.8)} aria-label="Zoom out" title="Zoom out">
                    <FaMinus size={12} />
                </button>
                <button type="button" className={styles.zoomBtn} onClick={resetView} aria-label="Fit map" title="Fit map">
                    <MdFilterCenterFocus size={15} />
                </button>
            </div>
        </div>
    )
}
