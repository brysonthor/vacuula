import { useEffect, useRef, useState } from 'react'
import { FaMinus, FaPlus, FaUndo } from 'react-icons/fa'
import { MdFilterCenterFocus, MdOutlineCropFree, MdTimeline } from 'react-icons/md'
import { PiBoundingBox } from 'react-icons/pi'
import { DRAWING } from '../../components/map/constants'
import type { NoGoLine, Point, UseState, Zone } from '../../components/map/types'
import { useMap, type ExtraDrawFn } from '../../components/map/useMap'
import {
    getCanvasPointerWorldCoords,
    getCrosshairWorldCoords,
    isPointInPolygon,
    makeRectangleVertices,
} from '../../components/map/utils'
import styles from './map.module.scss'

export type MapMode = 'maps' | 'map-edit' | 'boundaries' | 'boundary-info' | 'boundary-edit' | 'clean-here'
export type DrawTool = 'polygon' | 'rectangle'

interface MapCanvasProps {
    mapId: string
    runId?: string
    mode: MapMode
    drawTool: DrawTool
    setDrawTool: (tool: DrawTool) => void
    boundaries: (NoGoLine | Zone)[]
    onSelectBoundary?: (id: string) => void
    extraDraw?: ExtraDrawFn
    redrawKey?: unknown
    currentLinePoints: Point[]
    setCurrentLinePoints: UseState<Point[]>
    closedAsPolygon: boolean
    setClosedAsPolygon: UseState<boolean>
    hoverPoint: Point | null
    setHoverPoint: (pt: Point | null) => void
    setDrawerOpen: (open: boolean) => void
}

export default function MapCanvas({
    mapId,
    runId,
    mode,
    drawTool,
    setDrawTool,
    boundaries,
    onSelectBoundary,
    extraDraw,
    redrawKey,
    currentLinePoints,
    setCurrentLinePoints,
    closedAsPolygon,
    setClosedAsPolygon,
    hoverPoint,
    setHoverPoint,
    setDrawerOpen,
}: MapCanvasProps) {
    const isEditingShape = mode === 'boundary-edit' || mode === 'clean-here'

    const {
        canvasRef,
        mapSize,
        zoom,
        offset,
        isDragging,
        hasMoved,
        canvasHandlers,
        resetView,
        zoomBy,
    } = useMap({
        mapId,
        runId,
        extraDraw,
        redrawKey: [redrawKey, hoverPoint],
        backgroundToken: '--map-editor-bg',
    })

    // Vertex handle drag or rectangle drag state
    const draggingVertexIdxRef = useRef<number | null>(null)
    const rectStartRef = useRef<Point | null>(null)
    const [isFinePointer, setIsFinePointer] = useState<boolean>(() =>
        typeof window !== 'undefined' ? window.matchMedia('(pointer: fine)').matches : true
    )

    useEffect(() => {
        const mql = window.matchMedia('(pointer: fine)')
        const onChange = (e: MediaQueryListEvent) => setIsFinePointer(e.matches)
        mql.addEventListener('change', onChange)
        return () => mql.removeEventListener('change', onChange)
    }, [])

    const undo = () => {
        if (closedAsPolygon && drawTool === 'rectangle') {
            setClosedAsPolygon(false)
            setCurrentLinePoints([])
            return
        }
        if (closedAsPolygon) {
            setClosedAsPolygon(false)
            return
        }
        if (currentLinePoints.length > 0) {
            setCurrentLinePoints(prev => prev.slice(0, -1))
        }
    }

    const closeAsPolygon = () => {
        if (currentLinePoints.length < 3) return
        setClosedAsPolygon(true)
        setHoverPoint(null)
        setDrawerOpen(true)
    }

    // Keyboard shortcuts for desktop Map Studio
    useEffect(() => {
        if (!isEditingShape) return
        const onKeyDown = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement | null)?.tagName
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
                e.preventDefault()
                undo()
            } else if (e.key === 'Backspace') {
                e.preventDefault()
                undo()
            } else if (e.key === 'Enter' && currentLinePoints.length >= 3 && !closedAsPolygon) {
                e.preventDefault()
                closeAsPolygon()
            }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [isEditingShape, currentLinePoints, closedAsPolygon, drawTool])

    const findNearVertexIndex = (clientX: number, clientY: number): number | null => {
        const canvas = canvasRef.current
        if (!canvas || !mapSize || currentLinePoints.length === 0) return null
        const rect = canvas.getBoundingClientRect()
        const scaleX = rect.width > 0 ? canvas.width / rect.width : 1
        const scaleY = rect.height > 0 ? canvas.height / rect.height : 1
        const sx = (clientX - rect.left) * scaleX
        const sy = (clientY - rect.top) * scaleY

        const mapPxW = mapSize.width * zoom
        const mapPxH = mapSize.height * zoom
        for (let i = 0; i < currentLinePoints.length; i++) {
            const vx = offset.x + currentLinePoints[i][0] * mapPxW
            const vy = offset.y + currentLinePoints[i][1] * mapPxH
            const dist = Math.hypot(sx - vx, sy - vy)
            if (dist <= 14) return i
        }
        return null
    }

    const addPointAtCrosshair = () => {
        if (closedAsPolygon || !mapSize) return
        const coords = getCrosshairWorldCoords(canvasRef, offset, zoom, mapSize)
        setCurrentLinePoints(prev => [...prev, coords])
    }

    const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current
        if (isEditingShape && e.button === 0 && canvas && mapSize) {
            const hitVertex = findNearVertexIndex(e.clientX, e.clientY)
            if (hitVertex !== null) {
                draggingVertexIdxRef.current = hitVertex
                return
            }
            if (drawTool === 'rectangle' && !e.shiftKey) {
                const pt = getCanvasPointerWorldCoords(canvas, e.clientX, e.clientY, offset, zoom, mapSize)
                rectStartRef.current = pt
                setClosedAsPolygon(true)
                setCurrentLinePoints(makeRectangleVertices(pt, pt))
                return
            }
        }
        canvasHandlers.onMouseDown(e)
    }

    const handleMouseMove = (e: React.MouseEvent) => {
        const canvas = canvasRef.current
        if (isEditingShape && canvas && mapSize) {
            const pt = getCanvasPointerWorldCoords(canvas, e.clientX, e.clientY, offset, zoom, mapSize)
            const clamped: Point = [Math.max(0, Math.min(1, pt[0])), Math.max(0, Math.min(1, pt[1]))]

            if (draggingVertexIdxRef.current !== null) {
                const idx = draggingVertexIdxRef.current
                setCurrentLinePoints(prev => {
                    const copy = [...prev]
                    if (copy[idx]) copy[idx] = clamped
                    return copy
                })
                return
            }

            if (rectStartRef.current) {
                setCurrentLinePoints(makeRectangleVertices(rectStartRef.current, clamped))
                return
            }

            if (drawTool === 'polygon' && !closedAsPolygon) {
                setHoverPoint(clamped)
            } else {
                setHoverPoint(null)
            }
        }
        canvasHandlers.onMouseMove(e)
    }

    const handleMouseUp = (e: React.MouseEvent) => {
        const canvas = canvasRef.current
        if (draggingVertexIdxRef.current !== null) {
            draggingVertexIdxRef.current = null
            return
        }
        if (rectStartRef.current) {
            rectStartRef.current = null
            setDrawerOpen(true)
            return
        }

        const moved = hasMoved
        canvasHandlers.onMouseUp()

        if (moved || e.button !== 0 || !canvas || !mapSize) return

        const pt = getCanvasPointerWorldCoords(canvas, e.clientX, e.clientY, offset, zoom, mapSize)
        const clamped: Point = [Math.max(0, Math.min(1, pt[0])), Math.max(0, Math.min(1, pt[1]))]

        if (isEditingShape && drawTool === 'polygon' && !closedAsPolygon) {
            // Clicking near first vertex when >= 3 points closes the polygon!
            if (currentLinePoints.length >= 3) {
                const first = currentLinePoints[0]
                const distNorm = Math.hypot(clamped[0] - first[0], clamped[1] - first[1])
                if (distNorm < DRAWING.CLOSE_THRESHOLD) {
                    closeAsPolygon()
                    return
                }
            }
            setCurrentLinePoints(prev => [...prev, clamped])
            return
        }

        // In boundaries view, clicking a polygon opens its details
        if (mode === 'boundaries' && onSelectBoundary) {
            const polys = boundaries.filter((b): b is Zone => b.type === 'polygon')
            for (let i = polys.length - 1; i >= 0; i--) {
                if (isPointInPolygon(clamped, polys[i].vertices)) {
                    onSelectBoundary(polys[i].id)
                    return
                }
            }
        }
    }

    const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current
        if (isEditingShape && e.touches.length === 1 && canvas && mapSize) {
            const touch = e.touches[0]
            const hitVertex = findNearVertexIndex(touch.clientX, touch.clientY)
            if (hitVertex !== null) {
                draggingVertexIdxRef.current = hitVertex
                return
            }
            if (drawTool === 'rectangle') {
                const pt = getCanvasPointerWorldCoords(canvas, touch.clientX, touch.clientY, offset, zoom, mapSize)
                rectStartRef.current = pt
                setClosedAsPolygon(true)
                setCurrentLinePoints(makeRectangleVertices(pt, pt))
                return
            }
        }
        canvasHandlers.onTouchStart(e)
    }

    const handleTouchMove = (e: React.TouchEvent) => {
        const canvas = canvasRef.current
        if (isEditingShape && e.touches.length === 1 && canvas && mapSize) {
            const touch = e.touches[0]
            const pt = getCanvasPointerWorldCoords(canvas, touch.clientX, touch.clientY, offset, zoom, mapSize)
            const clamped: Point = [Math.max(0, Math.min(1, pt[0])), Math.max(0, Math.min(1, pt[1]))]

            if (draggingVertexIdxRef.current !== null) {
                const idx = draggingVertexIdxRef.current
                setCurrentLinePoints(prev => {
                    const copy = [...prev]
                    if (copy[idx]) copy[idx] = clamped
                    return copy
                })
                return
            }

            if (rectStartRef.current) {
                setCurrentLinePoints(makeRectangleVertices(rectStartRef.current, clamped))
                return
            }
        }
        canvasHandlers.onTouchMove(e)
    }

    const handleTouchEnd = (e: React.TouchEvent) => {
        if (draggingVertexIdxRef.current !== null) {
            draggingVertexIdxRef.current = null
            return
        }
        if (rectStartRef.current) {
            rectStartRef.current = null
            setDrawerOpen(true)
            return
        }
        const moved = hasMoved
        canvasHandlers.onTouchEnd(e)
        if (isEditingShape && drawTool === 'polygon' && !moved && !closedAsPolygon) {
            addPointAtCrosshair()
        }
    }

    return (
        <div className={styles.canvasViewport}>
            <canvas
                ref={canvasRef as React.RefObject<HTMLCanvasElement>}
                className={styles.canvas}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={() => {
                    setHoverPoint(null)
                    draggingVertexIdxRef.current = null
                    canvasHandlers.onMouseLeave()
                }}
                onWheel={canvasHandlers.onWheel}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onContextMenu={e => {
                    if (isEditingShape) {
                        e.preventDefault()
                        undo()
                    }
                }}
                style={{
                    cursor: isEditingShape ? 'crosshair' : isDragging ? 'grabbing' : 'grab',
                    touchAction: 'none',
                }}
            />

            {/* Top-left Draw Tool Switcher when editing boundaries or Clean Here */}
            {isEditingShape && (
                <div className={styles.drawToolbar}>
                    <button
                        type="button"
                        className={`${styles.toolBtn} ${drawTool === 'rectangle' ? styles.toolBtnActive : ''}`}
                        onClick={() => {
                            setDrawTool('rectangle')
                            setCurrentLinePoints([])
                            setClosedAsPolygon(false)
                        }}
                        title="Drag Rectangle"
                    >
                        <MdOutlineCropFree size={17} />
                        <span>Rectangle</span>
                    </button>
                    <button
                        type="button"
                        className={`${styles.toolBtn} ${drawTool === 'polygon' ? styles.toolBtnActive : ''}`}
                        onClick={() => {
                            setDrawTool('polygon')
                            setCurrentLinePoints([])
                            setClosedAsPolygon(false)
                        }}
                        title={mode === 'clean-here' ? 'Click Polygon' : 'Polygon / No-Go Line'}
                    >
                        <MdTimeline size={17} />
                        <span>{mode === 'clean-here' ? 'Polygon' : 'Points / Line'}</span>
                    </button>
                    <button
                        type="button"
                        className={styles.toolBtn}
                        disabled={currentLinePoints.length === 0 && !closedAsPolygon}
                        onClick={undo}
                        title="Undo (Ctrl+Z)"
                    >
                        <FaUndo size={13} />
                        <span>Undo</span>
                    </button>
                    {drawTool === 'polygon' && (
                        <button
                            type="button"
                            className={styles.toolBtn}
                            disabled={currentLinePoints.length < 3 || closedAsPolygon}
                            onClick={closeAsPolygon}
                            title="Close Polygon (Enter)"
                        >
                            <PiBoundingBox size={17} />
                            <span>Close Shape</span>
                        </button>
                    )}
                </div>
            )}

            {/* Top-right Zoom Controls */}
            <div className={styles.zoomToolbar}>
                <button type="button" className={styles.zoomIconBtn} onClick={() => zoomBy(1.25)} title="Zoom in">
                    <FaPlus size={12} />
                </button>
                <button type="button" className={styles.zoomIconBtn} onClick={() => zoomBy(0.8)} title="Zoom out">
                    <FaMinus size={12} />
                </button>
                <button type="button" className={styles.zoomIconBtn} onClick={resetView} title="Fit floorplan">
                    <MdFilterCenterFocus size={16} />
                </button>
            </div>

            {/* Touch precision crosshair buttons when using coarse pointer in polygon mode */}
            {isEditingShape && drawTool === 'polygon' && !isFinePointer && (
                <div className={styles.actionButtons}>
                    <div onClick={undo} className={styles.undo}>
                        <FaUndo size={18} color="var(--text)" />
                    </div>
                    <div
                        onClick={addPointAtCrosshair}
                        className={`${styles.add} ${closedAsPolygon ? styles.disabled : ''}`}
                    >
                        <FaPlus size={30} color="var(--on-accent)" />
                    </div>
                    <div
                        onClick={closeAsPolygon}
                        className={`${styles.closePolygon} ${currentLinePoints.length > 2 && !closedAsPolygon ? '' : styles.disabled}`}
                    >
                        <PiBoundingBox size={20} color="var(--text)" />
                    </div>
                </div>
            )}
        </div>
    )
}
