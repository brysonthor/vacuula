import { useRef, useState, useCallback, useEffect } from 'react'
import { DRAWING } from './constants'
import { useCanvasViewport } from './useCanvasViewport'
import { decodeRLE, calcFitZoomAndOffset } from './utils'
import { drawMap, computeIgnoredRunValues, colorForPathValue, type CellShape } from './drawingFunctions'
import type { Offset } from './types'
import { useCleaning, usePersistentMap } from '../../loaders/resources'
import { useRobot } from '../../context/useRobot'
import { RobotType } from '../../types'
import { loadSelectedMapShape } from '../../pages/settings/mapshapes'

export interface MapSize { width: number; height: number }

export type ExtraDrawFn = (
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    zoom: number,
    offset: Offset,
    mapSize: MapSize
) => void

interface UseMapOptions {
    mapId: string
    runId?: string
    shape?: CellShape
    fitOnLoad?: boolean
    extraDraw?: ExtraDrawFn
    // bump this to force a redraw when extraDraw's closed-over state changes
    // (boundaries, mode, currentLinePoints, etc.) without re-registering the RAF effect's deps.
    redrawKey?: unknown
    // CSS token used for the canvas background (default: --map-bg, the Runs panel)
    backgroundToken?: string
}

export function useMap({
    mapId,
    runId,
    shape = loadSelectedMapShape(),
    fitOnLoad = true,
    extraDraw,
    redrawKey,
    backgroundToken
}: UseMapOptions) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const cellsRef = useRef<number[] | null>(null)
    const runCellsRef = useRef<number[] | null>(null)
    const runIgnoreSetRef = useRef<Set<number>>(new Set())
    const userInteractedRef = useRef(false)
    const extraDrawRef = useRef(extraDraw)
    useEffect(() => {
        extraDrawRef.current = extraDraw
    }, [extraDraw])

    const [mapSize, setMapSize] = useState<MapSize>()

    const { robot } = useRobot(); // TODO: in the future, the map should not know about the robot but meh for now

    const {
        zoom, offset, isDragging, hasMoved,
        handleMouseDown, handleMouseMove, handleMouseUp, handleWheel,
        handleTouchStart, handleTouchMove, handleTouchEnd,
        setZoom, setOffset
    } = useCanvasViewport({ initialZoom: 4, initialOffset: { x: 0, y: 0 } })

    const draw = useCallback((currentZoom: number = zoom, currentOffset: Offset = offset) => {
        const canvas = canvasRef.current
        if (!canvas || !cellsRef.current || !mapSize) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        drawMap(
            ctx, canvas, cellsRef.current, currentZoom, currentOffset, mapSize,
            shape, runCellsRef.current,
            { getRunColor: colorForPathValue, ignoreRunValues: runIgnoreSetRef.current },
            backgroundToken
        )

        extraDrawRef.current?.(ctx, canvas, currentZoom, currentOffset, mapSize)
    }, [zoom, offset, mapSize, shape, backgroundToken])

    const onMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        userInteractedRef.current = true
        handleMouseDown(e)
    }, [handleMouseDown])
    const onTouchStart = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
        userInteractedRef.current = true
        handleTouchStart(e)
    }, [handleTouchStart])
    const onWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
        userInteractedRef.current = true
        handleWheel(e)
    }, [handleWheel])

    const fitView = useCallback((currentMapSize?: MapSize, currentCells?: number[]) => {
        const ms = currentMapSize ?? mapSize
        const cells = currentCells ?? cellsRef.current
        const canvas = canvasRef.current
        const parent = canvas?.parentElement
        if (!canvas || !parent || !cells || !ms) return
        const { width, height } = parent.getBoundingClientRect()
        if (width <= 0 || height <= 0) return
        canvas.width = width
        canvas.height = height
        const fit = calcFitZoomAndOffset(
            cells,
            ms,
            width,
            height,
            DRAWING.MIN_ZOOM,
            DRAWING.MAX_ZOOM,
            0.9,
            runCellsRef.current,
            runIgnoreSetRef.current
        )
        const targetZoom = fit ? fit.zoom : 4
        const targetOffset = fit ? fit.offset : {
            x: (width - ms.width * 4) / 2,
            y: (height - ms.height * 4) / 2
        }
        setZoom(targetZoom)
        setOffset(targetOffset)
        draw(targetZoom, targetOffset)
    }, [mapSize, setZoom, setOffset, draw])

    const { data: persistantMapData, refresh: updatePersistantMapData } = usePersistentMap(mapId);
    const { data: cleaningData, refresh: updateCleaningData } = useCleaning(runId ?? '');

    // Reset interaction state and cells when switching mapId or runId
    useEffect(() => {
        userInteractedRef.current = false
        cellsRef.current = null
        runCellsRef.current = null
        runIgnoreSetRef.current = new Set()
    }, [mapId, runId])

    useEffect(() => {
        updatePersistantMapData();
    }, [mapId])

    useEffect(() => {
        if (!runId) return;
        updateCleaningData()
    }, [runId])
    

    // Load floor map
    useEffect(() => {
        if (!persistantMapData) return
        cellsRef.current = decodeRLE(persistantMapData.rle)
        const newMapSize = { height: persistantMapData.height, width: persistantMapData.width }
        setMapSize(newMapSize)
        if (fitOnLoad && !userInteractedRef.current) {
            fitView(newMapSize, cellsRef.current)
        } else {
            draw()
        }
    }, [persistantMapData, fitOnLoad, fitView, draw])

    useEffect(() => {
        if (!cleaningData) return;
        const runCells = decodeRLE(cleaningData.rle);
        runCellsRef.current = runCells;
        runIgnoreSetRef.current = computeIgnoredRunValues(runCellsRef.current, robot.type === RobotType.NeatoGen4 ? 1 : 2);
        if (fitOnLoad && !userInteractedRef.current && cellsRef.current && mapSize) {
            fitView()
        } else {
            draw()
        }
    }, [cleaningData, robot.type, fitOnLoad, mapSize, fitView, draw])

    // Redraw on viewport change, or when caller's overlay-relevant state changes
    useEffect(() => {
        const id = requestAnimationFrame(() => draw(zoom, offset))
        return () => cancelAnimationFrame(id)
    }, [zoom, offset, draw, redrawKey])

    // Resize-to-container + fit-to-content
    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        const parent = canvas.parentElement
        if (!parent) return

        const resizeToContainer = () => {
            const { width, height } = parent.getBoundingClientRect()
            if (width <= 0 || height <= 0) return
            canvas.width = width
            canvas.height = height

            if (fitOnLoad && cellsRef.current && mapSize && !userInteractedRef.current) {
                fitView()
                return
            }
            draw()
        }

        resizeToContainer()
        const ro = new ResizeObserver(resizeToContainer)
        ro.observe(parent)
        return () => ro.disconnect()
    }, [mapSize, fitOnLoad, fitView, draw])

    const resetView = useCallback(() => {
        userInteractedRef.current = false
        fitView()
    }, [fitView])

    const zoomBy = useCallback((factor: number) => {
        userInteractedRef.current = true
        setZoom(z => Math.max(DRAWING.MIN_ZOOM, Math.min(DRAWING.MAX_ZOOM, z * factor)))
    }, [setZoom])

    return {
        canvasRef, cellsRef, mapSize,
        zoom, offset, isDragging, hasMoved,
        canvasHandlers: {
            onMouseDown,
            onMouseMove: handleMouseMove,
            onMouseUp: handleMouseUp,
            onMouseLeave: handleMouseUp,
            onWheel,
            onTouchStart,
            onTouchMove: handleTouchMove,
            onTouchEnd: handleTouchEnd
        },
        draw,
        resetView,
        zoomBy,
        setZoom,
    }
}