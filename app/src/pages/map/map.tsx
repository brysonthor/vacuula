import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { v4 as uuidv4 } from 'uuid'
import { MdOutlineCropFree } from 'react-icons/md'
import { IoCalendarOutline } from 'react-icons/io5'
import Button from '../../components/button/button'
import ColorPicker from '../../components/colorPicker/ColorPicker'
import { useMediaQuery } from '../../components/hooks/useMediaQuery'
import Input from '../../components/input/input'
import { normalizeHex, pickUnusedPreset, withAlpha } from '../../components/map/color'
import {
    drawBase,
    drawCrosshair,
    drawInProgressPolyline,
    drawNoGoLines,
    drawZones,
    onDockImageReady,
} from '../../components/map/drawingFunctions'
import type { NoGoLine, Point, UseState, Zone } from '../../components/map/types'
import type { ExtraDrawFn } from '../../components/map/useMap'
import { calcRelevancy, upsertPreserveOrder } from '../../components/map/utils'
import Modal from '../../components/modal/Modal'
import ResponsivePanel from '../../components/responsivePanel/ResponsivePanel'
import { isDocked } from '../../components/topbar/robotInfo'
import { useRobot } from '../../context/useRobot'
import { Http } from '../../http'
import { GEN3_COMMANDS } from '../../http/gen3'
import { GEN4_COMMANDS } from '../../http/gen4'
import { fetchGen3MapBoundaries, setCachedGen3Boundaries } from '../../loaders/gen3Boundaries'
import { usePersistentMaps } from '../../loaders/resources'
import { Neato, RobotType, type Robot } from '../../types'
import type { Floorplan } from '../../types/neato/gen4'
import { useGetPromotedFloorplan } from '../../utils/floormaps'
import { getGen3CleaningMode, getGen3NavigationMode, getGen4CleaningMode, getGen4NavigationMode } from '../../utils/modes'
import MapCanvas, { type DrawTool, type MapMode } from './MapCanvas'
import styles from './map.module.scss'

enum BoundaryTypes {
    NOGO_LINE = 'nogo-line',
    NOGO_ZONE = 'nogo-zone',
    CLEANING_ZONE = 'cleaning-zone',
}

export default function MapPage() {
    const { t } = useTranslation()
    const { robot } = useRobot()
    const navigate = useNavigate()
    const [searchParams, setSearchParams] = useSearchParams()
    const isCoarsePointer = useMediaQuery('(pointer: coarse)')

    const [boundaries, setBoundaries] = useState<(NoGoLine | Zone)[]>([])
    const [drawerOpen, setDrawerOpen] = useState(true)
    const [drawTool, setDrawTool] = useState<DrawTool>('polygon')
    const [hoverPoint, setHoverPoint] = useState<Point | null>(null)
    const [purgeModalOpen, setPurgeModalOpen] = useState(false)
    const [cleanHereStatus, setCleanHereStatus] = useState<string | null>(null)

    const [editForm, setEditForm] = useState({
        name: '',
        color: '',
        zoneType: BoundaryTypes.CLEANING_ZONE,
    })

    const [mapEditForm, setMapEditForm] = useState({
        name: '',
        enabled: true,
    })

    const [currentLinePoints, setCurrentLinePoints] = useState<Point[]>([])
    const [closedAsPolygon, setClosedAsPolygon] = useState(false)
    const [persistentMap, setPersistentMap] = useState<string>()

    const [mode, setMode] = useState<MapMode>('maps')
    const [returnFromEditMode, setReturnFromEditMode] = useState<'boundaries' | 'boundary-info'>('boundaries')
    const [activeBoundaryId, setActiveBoundaryId] = useState<string | undefined>(undefined)

    const skipNextPostRef = useRef(false)
    const autoInitializedRef = useRef<string | null>(null)

    const { data: persistentMaps, refresh: updatePersistentMaps } = usePersistentMaps()
    const getPromotedFloorplan = useGetPromotedFloorplan()

    const [dockReady, setDockReady] = useState(false)
    useEffect(() => {
        onDockImageReady(() => setDockReady(true))
        updatePersistentMaps()
    }, [robot.serial])

    // Auto-open active map or URL-requested map + ?cleanHere=1
    useEffect(() => {
        if (!persistentMaps || persistentMaps.length === 0) return
        const paramMap = searchParams.get('map')
        const wantCleanHere = searchParams.get('cleanHere') === '1'

        if (paramMap && persistentMaps.some(m => m.id === paramMap)) {
            setPersistentMap(paramMap)
            if (wantCleanHere) {
                setMode('clean-here')
                setDrawTool('rectangle')
                setCurrentLinePoints([])
                setClosedAsPolygon(false)
            }
            // Clear query params once consumed
            setSearchParams({}, { replace: true })
            autoInitializedRef.current = robot.serial
            return
        }

        if (autoInitializedRef.current !== robot.serial) {
            autoInitializedRef.current = robot.serial
            const preferred =
                robot.type === RobotType.NeatoGen4
                    ? (persistentMaps as Floorplan[]).find(m => m.promoted) ?? persistentMaps[0]
                    : (persistentMaps as Neato.Gen3.PersistentMap[]).find(m => m.enabled) ?? persistentMaps[0]
            if (preferred) {
                setPersistentMap(preferred.id)
                if (wantCleanHere) {
                    setMode('clean-here')
                    setDrawTool('rectangle')
                    setSearchParams({}, { replace: true })
                }
            }
        }
    }, [persistentMaps, robot.serial, robot.type, searchParams, setSearchParams])

    const extraDraw = useCallback<ExtraDrawFn>(
        (ctx, canvas, currentZoom, currentOffset, mapSize) => {
            const showBoundaries =
                mode === 'boundary-edit' ? boundaries.filter(b => b.id !== activeBoundaryId) : boundaries

            drawZones(
                ctx,
                showBoundaries.filter((b): b is Zone => b.type === 'polygon'),
                currentZoom,
                currentOffset,
                mapSize,
                { showLabels: true, highlightedId: activeBoundaryId }
            )
            drawNoGoLines(
                ctx,
                showBoundaries.filter((b): b is NoGoLine => b.type === 'polyline'),
                currentZoom,
                currentOffset,
                mapSize
            )

            const map = persistentMaps?.find(p => p.id === persistentMap)
            const baseData = map?.base
            const NO_BASE = 2147483647
            if (
                map &&
                'origin' in map &&
                Array.isArray(baseData) &&
                baseData[0] !== NO_BASE &&
                baseData[1] !== NO_BASE
            ) {
                const [originX, originY] = map.origin
                const resolution = map.resolution
                const [imgW, imgH] = map.imgsize
                const normX = (baseData[0] - originX) / resolution / imgW
                const normY = (baseData[1] - originY) / resolution / imgH
                drawBase(
                    ctx,
                    { x: normX, y: normY, dir: baseData[2] ?? 0 },
                    currentZoom,
                    currentOffset,
                    mapSize,
                    resolution
                )
            } else if (Array.isArray(baseData) && robot.type === RobotType.NeatoGen3) {
                drawBase(
                    ctx,
                    { x: baseData[0], y: baseData[1], dir: baseData[2] ?? 0 },
                    currentZoom,
                    currentOffset,
                    mapSize,
                    0
                )
            }

            if (mode === 'boundary-edit' || mode === 'clean-here') {
                if (isCoarsePointer && drawTool === 'polygon') {
                    drawCrosshair(ctx, canvas)
                }
                const previewColor = mode === 'clean-here' ? '#00E5A3' : editForm.color
                if (closedAsPolygon && currentLinePoints.length >= 3) {
                    drawZones(
                        ctx,
                        [
                            {
                                vertices: currentLinePoints,
                                name: mode === 'clean-here' ? t('map.cleanHere', 'Clean Here') : editForm.name,
                                color: previewColor,
                                type: 'polygon',
                                id: '__preview__',
                                enabled: true,
                                function: 'cleaning',
                            },
                        ],
                        currentZoom,
                        currentOffset,
                        mapSize,
                        { showLabels: true }
                    )
                    drawInProgressPolyline(ctx, currentLinePoints, currentZoom, currentOffset, mapSize, {
                        closed: true,
                    })
                } else {
                    drawInProgressPolyline(ctx, currentLinePoints, currentZoom, currentOffset, mapSize, {
                        hoverPoint,
                        closed: false,
                    })
                }
            }
        },
        [
            boundaries,
            activeBoundaryId,
            mode,
            currentLinePoints,
            closedAsPolygon,
            hoverPoint,
            drawTool,
            isCoarsePointer,
            editForm.color,
            editForm.name,
            persistentMaps,
            persistentMap,
            dockReady,
            robot.type,
            t,
        ]
    )

    const getMapBoundaries = useCallback(() => {
        if (!persistentMap) return
        skipNextPostRef.current = true
        if (robot.type === RobotType.NeatoGen4) {
            Http.getBoundaries(robot.serial, persistentMap).then(res => setBoundaries(res.data ?? []))
        } else {
            fetchGen3MapBoundaries(robot.serial, persistentMap, robot.online).then(b => setBoundaries([...b]))
        }
    }, [persistentMap, robot.serial, robot.type, robot.online])

    useEffect(() => {
        if (!persistentMap) return
        getMapBoundaries()
        setMode(cur => (cur === 'clean-here' ? 'clean-here' : 'boundaries'))
    }, [persistentMap, getMapBoundaries])

    const updatePersistentMap = (data: { name: string; enabled: boolean }, mapToChange?: string) => {
        const map = mapToChange || persistentMap
        if (!map) return
        Http.updatePersistentMap(robot.serial, map, data).finally(() => {
            updatePersistentMaps()
            if (persistentMap) setMode('boundaries')
        })
    }

    useEffect(() => {
        if (!persistentMap) return
        if (skipNextPostRef.current) {
            skipNextPostRef.current = false
            return
        }
        if (robot.type === RobotType.NeatoGen4) {
            Http.postBoundaries(robot.serial, persistentMap, boundaries).then(() => {
                getMapBoundaries()
                const map = persistentMaps?.find(p => p.id === persistentMap)
                if (map && 'promoted' in map && map.promoted && robot.online) {
                    Http.promoteFloorplan(robot.serial, map.id).then(() => updatePersistentMaps())
                }
            })
            return
        }

        if (!robot.online) return
        const updatedBoundaries = boundaries.map(boundary =>
            boundary.type === 'polygon'
                ? {
                      ...boundary,
                      relevancy: calcRelevancy(boundary.vertices),
                  }
                : boundary
        )
        GEN3_COMMANDS.setMapBoundaries(robot.serial, persistentMap, updatedBoundaries)
            .then(() => {
                setCachedGen3Boundaries(robot.serial, persistentMap, boundaries)
            })
            .catch(() => {
                getMapBoundaries()
            })
    }, [boundaries])

    useEffect(() => {
        if (mode === 'boundaries') setActiveBoundaryId(undefined)
        if (mode === 'map-edit') {
            const pmap = persistentMaps?.find(p => p.id === persistentMap)
            if (!pmap) return
            setMapEditForm({
                name: pmap.name,
                enabled: 'enabled' in pmap ? pmap.enabled : false,
            })
        }
        if (mode === 'clean-here') {
            setCleanHereStatus(null)
            return
        }
        if (mode !== 'boundary-edit') {
            setCurrentLinePoints([])
            setClosedAsPolygon(false)
            setHoverPoint(null)
            return
        }
        const existingBoundary = boundaries.find(b => b.id === activeBoundaryId)
        setDrawTool('polygon')
        setEditForm({
            name: existingBoundary?.name ?? '',
            color: normalizeHex(existingBoundary?.color) ?? pickUnusedPreset(boundaries.map(b => b.color)),
            zoneType:
                existingBoundary?.type === 'polygon'
                    ? existingBoundary?.function === 'nogo'
                        ? BoundaryTypes.NOGO_ZONE
                        : BoundaryTypes.CLEANING_ZONE
                    : BoundaryTypes.CLEANING_ZONE,
        })
        setCurrentLinePoints(existingBoundary?.vertices || [])
        setClosedAsPolygon(existingBoundary?.type === 'polygon')
    }, [mode])

    const saveEditBoundary = () => {
        if (currentLinePoints.length < 2) return
        setMode(returnFromEditMode)
        const id = activeBoundaryId ?? uuidv4()
        const isPoly = closedAsPolygon && currentLinePoints.length >= 3
        const updated: NoGoLine | Zone = isPoly
            ? {
                  id,
                  name: editForm.name || t('map.zone', 'Room'),
                  color: editForm.color,
                  function:
                      robot.type !== RobotType.NeatoGen4 || editForm.zoneType === BoundaryTypes.CLEANING_ZONE
                          ? 'cleaning'
                          : 'nogo',
                  type: 'polygon',
                  vertices: currentLinePoints,
                  enabled: true,
              }
            : {
                  id,
                  name: editForm.name || t('map.noGoLine', 'No-Go Line'),
                  color: editForm.color,
                  function: 'nogo',
                  type: 'polyline',
                  vertices: currentLinePoints,
                  enabled: true,
              }
        setBoundaries(prev => upsertPreserveOrder(prev, updated))
    }

    const handleStartCleanHere = async () => {
        if (!persistentMap || currentLinePoints.length < 3 || !robot.online) return
        setCleanHereStatus(
            robot.type === RobotType.NeatoGen4
                ? t('map.uploadingCleanHere', 'Syncing temporary zone to robot floorplan…')
                : t('map.startingCleanHere', 'Sending temporary zone to robot…')
        )
        try {
            await Http.startCleanHere(robot.serial, {
                map_id: persistentMap,
                vertices: currentLinePoints,
                mode: robot.type === RobotType.NeatoGen3 ? getGen3CleaningMode() : getGen4CleaningMode(),
                navigationMode:
                    robot.type === RobotType.NeatoGen3 ? getGen3NavigationMode() : getGen4NavigationMode(),
                nogo_enabled: true,
            })
            navigate(`/robot/${encodeURIComponent(robot.serial)}`)
        } catch (err: any) {
            setCleanHereStatus(err?.response?.data?.error || t('common.error', 'Failed to start Clean Here'))
        }
    }

    const handlePurgeMap = async () => {
        if (!persistentMap) return
        await Http.purgeMap(robot.serial, persistentMap)
        setPurgeModalOpen(false)
        setPersistentMap(undefined)
        setMode('maps')
        updatePersistentMaps()
    }

    const updateForm = <T extends object>(update: UseState<T>, patch: Partial<T>) => {
        update(prev => ({ ...prev, ...patch }))
    }

    const toggleNoGo = (item: NoGoLine | Zone) => {
        setBoundaries(prev => upsertPreserveOrder(prev, { ...item, enabled: !item.enabled }))
    }

    const deleteBoundary = (id: string) => {
        setBoundaries(prev => prev.filter(boundary => boundary.id !== id))
        setMode('boundaries')
    }

    const openInfo = (id: string) => {
        setMode('boundary-info')
        setActiveBoundaryId(id)
        setDrawerOpen(true)
    }

    const openEdit = (id: string) => {
        if (mode !== 'boundaries' && mode !== 'boundary-info') return
        setReturnFromEditMode(mode)
        setActiveBoundaryId(id)
        setMode('boundary-edit')
        setDrawerOpen(true)
    }

    const enterCleanHere = () => {
        setDrawTool('rectangle')
        setCurrentLinePoints([])
        setClosedAsPolygon(false)
        setMode('clean-here')
        setDrawerOpen(true)
    }

    const handleBackBtn = () => {
        if (mode === 'boundaries') {
            setPersistentMap(undefined)
            setMode('maps')
        } else if (mode === 'map-edit' || mode === 'boundary-info' || mode === 'clean-here') {
            setMode('boundaries')
        } else if (mode === 'boundary-edit') {
            setMode(returnFromEditMode)
        }
    }

    const getTitle = () => {
        switch (mode) {
            case 'maps':
                return t('map.maps', 'Saved Maps')
            case 'boundaries':
            case 'map-edit':
                return persistentMaps?.find(p => p.id === persistentMap)?.name || t('map.maps', 'Map')
            case 'boundary-info':
                return boundaries.find(b => b.id === activeBoundaryId)?.name || t('map.zone', 'Boundary')
            case 'clean-here':
                return t('map.cleanHere', 'Clean Here')
            case 'boundary-edit':
                if (!drawerOpen) return t('map.dragUpToFinish', 'Finish Boundary')
                return t('map.editBoundary', 'Edit Boundary')
        }
    }

    const cleanZone = async (zone: Zone) => {
        if (!persistentMap || !robot.online) return
        if (robot.type === RobotType.NeatoGen3) {
            GEN3_COMMANDS.startCleaningZone(
                robot.serial,
                persistentMap,
                zone.id,
                getGen3CleaningMode(),
                getGen3NavigationMode()
            )
            return
        }
        const promotedFloorplan = await getPromotedFloorplan()
        if (!promotedFloorplan) return
        GEN4_COMMANDS.startCleaning(
            robot.serial,
            getGen4CleaningMode(),
            getGen4NavigationMode(),
            promotedFloorplan.id,
            true,
            [zone.id]
        )
    }

    const currentMapObj = persistentMaps?.find(p => p.id === persistentMap)

    return (
        <div className={styles.container}>
            {persistentMap ? (
                <MapCanvas
                    mapId={persistentMap}
                    mode={mode}
                    drawTool={drawTool}
                    setDrawTool={setDrawTool}
                    boundaries={boundaries}
                    onSelectBoundary={openInfo}
                    extraDraw={extraDraw}
                    redrawKey={extraDraw}
                    currentLinePoints={currentLinePoints}
                    setCurrentLinePoints={setCurrentLinePoints}
                    closedAsPolygon={closedAsPolygon}
                    setClosedAsPolygon={setClosedAsPolygon}
                    hoverPoint={hoverPoint}
                    setHoverPoint={setHoverPoint}
                    setDrawerOpen={setDrawerOpen}
                />
            ) : (
                <div className={styles.emptyCanvasState}>
                    <span>{t('map.selectMap', 'Select a floorplan from the panel to inspect or edit boundaries')}</span>
                </div>
            )}

            <ResponsivePanel
                open={drawerOpen}
                alwaysDockedDesktop={true}
                handle={true}
                showBackButton={['map-edit', 'boundaries', 'boundary-info', 'clean-here', 'boundary-edit'].includes(mode)}
                onBackButtonClick={handleBackBtn}
                onOpenChange={setDrawerOpen}
                openHeightPercent={mode === 'boundary-edit' || mode === 'clean-here' ? 55 : mode === 'boundary-info' ? 40 : 70}
                title={getTitle()}
                width="39rem"
            >
                {mode === 'maps' && (
                    <div className={styles.featureList}>
                        {persistentMaps?.map((item, i) => (
                            <div key={i} className={styles.item} onClick={() => setPersistentMap(item.id)}>
                                <div className={styles.info}>
                                    <span>{item.name}</span>
                                    <span className={styles.type}>
                                        {'created_at' in item
                                            ? new Date(item.created_at).toLocaleString()
                                            : item.id}
                                    </span>
                                </div>
                                <div onClick={e => e.stopPropagation()}>
                                    {'enabled' in item ? (
                                        <Input
                                            type="switch"
                                            skipSection={true}
                                            value={item.enabled}
                                            onChange={() => {
                                                updatePersistentMap({ name: item.name, enabled: !item.enabled }, item.id)
                                            }}
                                        />
                                    ) : (
                                        <PromoteDemoteBtn robot={robot} map={item} onSuccess={updatePersistentMaps} />
                                    )}
                                </div>
                            </div>
                        ))}
                        {persistentMaps?.length === 0 && (
                            <div className={styles.emptyNotice}>
                                <p>{t('map.noMaps')}</p>
                                {robot.type === RobotType.NeatoGen4 && <p>{t('map.gen4SelectMapGuide')}</p>}
                            </div>
                        )}
                        <hr className={styles.divider} />
                        <div
                            className={`${styles.item} ${styles.actionItem} ${
                                robot.online && isDocked(robot) ? '' : styles.disabled
                            }`}
                            onClick={() => {
                                if (!robot.online || !isDocked(robot)) return
                                if (robot.type === RobotType.NeatoGen4) {
                                    GEN4_COMMANDS.startCleaning(robot.serial, getGen4CleaningMode(), getGen4NavigationMode())
                                } else {
                                    GEN3_COMMANDS.startPersistentMapExploration(robot.serial)
                                }
                            }}
                        >
                            <div className={styles.info}>
                                <span>{t('map.newMap')}</span>
                                <span className={styles.type}>
                                    {robot.online && isDocked(robot)
                                        ? t('map.exploreNewMap')
                                        : t('map.cannotExploreNewMap')}
                                </span>
                            </div>
                        </div>
                    </div>
                )}

                {mode === 'map-edit' && persistentMap && (
                    <div className={styles.stackCol}>
                        <Input
                            type="text"
                            label={t('common.name')}
                            value={mapEditForm.name}
                            onChange={name => updateForm(setMapEditForm, { name })}
                        />
                        {robot.type === RobotType.NeatoGen3 && (
                            <Input
                                type="switch"
                                label={t('common.enabled')}
                                value={mapEditForm.enabled}
                                onChange={enabled => updateForm(setMapEditForm, { enabled })}
                            />
                        )}
                        <Button text={t('common.save')} style="success" onClick={() => updatePersistentMap(mapEditForm)} />

                        {robot.type === RobotType.NeatoGen4 &&
                            (currentMapObj as Floorplan)?.in_maps_list &&
                            !(currentMapObj as Floorplan)?.promoted && (
                                <Button
                                    text={t('map.stopUsingAsFloormap')}
                                    style="secondary"
                                    onClick={() =>
                                        Http.postUnuseMapAsFloorPlan(robot.serial, persistentMap).then(() => {
                                            setMode('maps')
                                            updatePersistentMaps()
                                        })
                                    }
                                />
                            )}

                        <hr className={styles.divider} />
                        <Button
                            text={t('map.purgeMap', 'Delete Map Permanently')}
                            style="fail"
                            onClick={() => setPurgeModalOpen(true)}
                        />
                    </div>
                )}

                {mode === 'clean-here' && (
                    <div className={styles.stackCol}>
                        <p className={styles.helperCopy}>
                            {t(
                                'map.cleanHereInstructions',
                                'Drag a rectangle on the floorplan (or switch to Polygon to place custom corners). Vacuula will clean just that area and automatically clean up the temporary boundary afterward.'
                            )}
                        </p>
                        {cleanHereStatus && <div className={styles.statusNote}>{cleanHereStatus}</div>}
                        <div className={styles.editBoundaryActionButtons}>
                            <Button text={t('common.cancel')} style="secondary" onClick={() => setMode('boundaries')} />
                            <Button
                                text={t('map.startCleanHere', 'Start Clean Here')}
                                style="success"
                                disabled={!robot.online || currentLinePoints.length < 3}
                                onClick={handleStartCleanHere}
                            />
                        </div>
                    </div>
                )}

                {mode === 'boundary-edit' && (
                    <EditBoundaryDetails
                        currentLinePoints={currentLinePoints}
                        closedAsPolygon={closedAsPolygon}
                        setDrawerOpen={setDrawerOpen}
                        save={saveEditBoundary}
                        name={editForm.name}
                        color={editForm.color}
                        zoneType={editForm.zoneType}
                        setName={name => updateForm(setEditForm, { name })}
                        setColor={color => updateForm(setEditForm, { color })}
                        setZoneType={zoneType => updateForm(setEditForm, { zoneType })}
                        cancel={() => setMode(returnFromEditMode)}
                        supportsZoneType={robot.type === RobotType.NeatoGen4}
                    />
                )}

                {mode === 'boundary-info' && activeBoundaryId && boundaries.find(b => b.id === activeBoundaryId) && (
                    <BoundaryDetails
                        map={currentMapObj}
                        boundary={boundaries.find(b => b.id === activeBoundaryId)!}
                        docked={robot.online && isDocked(robot)}
                        online={robot.online}
                        deleteBoundary={deleteBoundary}
                        editBoundary={() => {
                            setReturnFromEditMode('boundary-info')
                            setMode('boundary-edit')
                        }}
                        onCleanZone={zone => cleanZone(zone)}
                        onScheduleZone={zone => {
                            navigate(
                                `/robot/${encodeURIComponent(robot.serial)}/schedule?zone=${encodeURIComponent(
                                    zone.id
                                )}&map=${encodeURIComponent(persistentMap ?? '')}`
                            )
                        }}
                    />
                )}

                {mode === 'boundaries' && (
                    <div className={styles.stackCol}>
                        <div className={styles.panelActionRow}>
                            {robot.type === RobotType.NeatoGen4 && currentMapObj ? (
                                <PromoteDemoteBtn
                                    robot={robot}
                                    map={currentMapObj as Floorplan}
                                    onSuccess={updatePersistentMaps}
                                />
                            ) : (
                                <span className={styles.statusChip}>
                                    {(currentMapObj as Neato.Gen3.PersistentMap | undefined)?.enabled
                                        ? t('common.enabled')
                                        : t('common.disabled')}
                                </span>
                            )}
                            <Button text={t('map.editMapDetails')} style="secondary" onClick={() => setMode('map-edit')} />
                        </div>

                        <div className={styles.dualActionRow}>
                            <button
                                type="button"
                                className={styles.cleanHereBtn}
                                disabled={!robot.online}
                                onClick={enterCleanHere}
                            >
                                <MdOutlineCropFree size={17} />
                                <span>{t('map.cleanHere', 'Clean Here')}</span>
                            </button>
                            <Button
                                text={t('map.addFeature')}
                                style="primary"
                                disabled={!robot.online && robot.type === RobotType.NeatoGen3}
                                onClick={() => openEdit(uuidv4())}
                            />
                        </div>

                        <div className={styles.featureList}>
                            {boundaries.map((item, i) => (
                                <div
                                    key={i}
                                    className={styles.item}
                                    style={{ background: withAlpha(item.color, 0.13) }}
                                    onClick={() => openInfo(item.id)}
                                >
                                    <div className={styles.info}>
                                        <span>{item.name}</span>
                                        <span className={styles.type} style={{ color: normalizeHex(item.color) ?? undefined }}>
                                            {item.type === 'polygon'
                                                ? 'function' in item
                                                    ? item.function === 'cleaning'
                                                        ? t('map.cleaningZone')
                                                        : t('map.noGoZone')
                                                    : t('map.zone')
                                                : t('map.noGoLine')}
                                        </span>
                                    </div>
                                    <div onClick={e => e.stopPropagation()}>
                                        {(currentMapObj && 'promoted' in currentMapObj
                                            ? (currentMapObj as Floorplan).promoted
                                            : true) && (
                                            <>
                                                {(item.type === 'polyline' || item.function === 'nogo') && (
                                                    <Input
                                                        type="switch"
                                                        skipSection={true}
                                                        value={item.enabled}
                                                        onChange={() => toggleNoGo(item)}
                                                    />
                                                )}
                                                {item.type === 'polygon' &&
                                                    ('function' in item ? item.function === 'cleaning' : true) && (
                                                        <Button
                                                            style="primary"
                                                            disabled={!robot.online || !isDocked(robot)}
                                                            text={t('map.cleanZone')}
                                                            onClick={() => cleanZone(item)}
                                                        />
                                                    )}
                                            </>
                                        )}
                                    </div>
                                </div>
                            ))}
                            {boundaries.length === 0 && (
                                <p className={styles.helperCopy}>
                                    {t(
                                        'map.noBoundariesYet',
                                        'No rooms or no-go lines defined yet. Click Add Feature to draw room zones or keep-out boundaries.'
                                    )}
                                </p>
                            )}
                        </div>
                    </div>
                )}

                {robot.type === RobotType.NeatoGen4 && ['boundaries', 'maps'].includes(mode) && (
                    <p className={styles.gen4ProtectedNote}>
                        {t(
                            'map.gen4ScheduleProtectedNote',
                            'Vacuula automatically snapshots and restores your Gen 4 schedules whenever you promote floorplan or zone updates.'
                        )}
                    </p>
                )}
            </ResponsivePanel>

            <Modal
                open={purgeModalOpen}
                onClose={() => setPurgeModalOpen(false)}
                title={t('map.purgeMapTitle', 'Delete Floorplan Permanently?')}
                footer={
                    <>
                        <Button text={t('common.cancel')} style="secondary" onClick={() => setPurgeModalOpen(false)} />
                        <Button text={t('common.delete')} style="fail" onClick={handlePurgeMap} />
                    </>
                }
            >
                <p>
                    {t(
                        'map.purgeMapConfirm',
                        'This permanently removes the saved floorplan and its room boundaries from the Vacuula server.'
                    )}
                </p>
            </Modal>
        </div>
    )
}

interface BoundaryDetailsProps {
    map?: Floorplan | Neato.Gen3.PersistentMap
    boundary: NoGoLine | Zone
    docked: boolean
    online: boolean
    editBoundary: (id: string) => void
    deleteBoundary: (id: string) => void
    onCleanZone: (boundary: Zone) => void
    onScheduleZone: (boundary: Zone) => void
}

const BoundaryDetails = (props: BoundaryDetailsProps) => {
    const { t } = useTranslation()
    const isCleaningZone =
        props.boundary.type === 'polygon' &&
        ('function' in props.boundary ? props.boundary.function === 'cleaning' : true)

    return (
        <div className={styles.boundaryDetails}>
            <div className={styles.featureList}>
                <div className={styles.item} style={{ background: withAlpha(props.boundary.color, 0.13) }}>
                    <div className={styles.info}>
                        <span>{props.boundary.name}</span>
                        <span className={styles.type} style={{ color: normalizeHex(props.boundary.color) ?? undefined }}>
                            {props.boundary.type === 'polygon'
                                ? 'function' in props.boundary
                                    ? props.boundary.function === 'cleaning'
                                        ? t('map.cleaningZone')
                                        : t('map.noGoZone')
                                    : t('map.zone')
                                : t('map.noGoLine')}
                        </span>
                    </div>
                    {(props.map && 'promoted' in props.map ? props.map.promoted : true) && isCleaningZone && (
                        <Button
                            style="primary"
                            disabled={!props.docked}
                            text={t('map.cleanZone')}
                            onClick={() => props.onCleanZone(props.boundary as Zone)}
                        />
                    )}
                </div>
            </div>

            <div className={styles.zoneActions}>
                {isCleaningZone && (
                    <button
                        type="button"
                        className={styles.cleanHereBtn}
                        onClick={() => props.onScheduleZone(props.boundary as Zone)}
                    >
                        <IoCalendarOutline size={17} />
                        <span>{t('map.scheduleZone', 'Schedule This Room')}</span>
                    </button>
                )}
                <Button text={t('common.edit')} style="primary" onClick={() => props.editBoundary(props.boundary.id)} />
                <Button text={t('common.delete')} style="fail" onClick={() => props.deleteBoundary(props.boundary.id)} />
            </div>
        </div>
    )
}

interface EditBoundaryDetailsProps {
    currentLinePoints: Point[]
    closedAsPolygon: boolean
    name: string
    setName: (name: string) => void
    color: string
    setColor: (color: string) => void
    zoneType: BoundaryTypes
    setZoneType: (zoneType: BoundaryTypes) => void
    save: () => void
    cancel: () => void
    setDrawerOpen: (open: boolean) => void
    supportsZoneType: boolean
}

const EditBoundaryDetails = (props: EditBoundaryDetailsProps) => {
    const { t } = useTranslation()
    return (
        <div className={styles.editBoundaryDetails}>
            <div className={styles.stackCol}>
                <p className={styles.helperCopy}>
                    {t(
                        'map.desktopDrawGuide',
                        'Click on the map to place corners (click the first corner or press Enter to close a room), or select Rectangle on the map toolbar to drag a box. Drag any corner handle to adjust.'
                    )}
                </p>

                <Input
                    type="text"
                    label={t('common.name')}
                    value={props.name}
                    onChange={value => props.setName(value)}
                />

                {props.currentLinePoints.length > 1 && (
                    <Input
                        type="select"
                        label={props.supportsZoneType && props.closedAsPolygon ? t('map.zoneType') : t('common.type')}
                        options={[
                            {
                                value: props.closedAsPolygon ? BoundaryTypes.CLEANING_ZONE : BoundaryTypes.NOGO_LINE,
                                label: props.closedAsPolygon
                                    ? props.supportsZoneType
                                        ? t('map.cleaning')
                                        : t('map.zone')
                                    : t('map.noGoLine'),
                            },
                            ...(props.supportsZoneType && props.closedAsPolygon
                                ? [{ value: BoundaryTypes.NOGO_ZONE, label: t('map.noGo') }]
                                : []),
                        ]}
                        value={
                            props.closedAsPolygon
                                ? props.supportsZoneType
                                    ? props.zoneType
                                    : BoundaryTypes.CLEANING_ZONE
                                : BoundaryTypes.NOGO_LINE
                        }
                        onChange={zoneType => {
                            if (!props.supportsZoneType) return
                            props.setZoneType(zoneType as BoundaryTypes)
                        }}
                        extraInfo={props.closedAsPolygon ? t('map.polygonHint') : t('map.lineHint')}
                    />
                )}

                <Input type="custom" label={t('map.color')}>
                    <ColorPicker value={props.color} onChange={props.setColor} />
                </Input>
            </div>

            <div className={styles.editBoundaryActionButtons}>
                <Button text={t('common.cancel')} style="fail" onClick={() => props.cancel()} />
                <Button
                    text={t('common.save')}
                    style="success"
                    disabled={props.currentLinePoints.length < 2}
                    onClick={() => props.save()}
                />
            </div>
        </div>
    )
}

interface PromoteDemoteBtnProps {
    robot: Robot
    map: Floorplan
    onSuccess: () => void
}

const PromoteDemoteBtn = ({ robot, map, onSuccess }: PromoteDemoteBtnProps) => {
    const { t } = useTranslation()
    return (
        <Button
            disabled={!robot.online}
            text={map.promoted ? t('map.demote') : t('map.promote')}
            onClick={() => {
                if (map.promoted) Http.demoteFloorplan(robot.serial, map.id).finally(() => onSuccess())
                else Http.promoteFloorplan(robot.serial, map.id).finally(() => onSuccess())
            }}
            style={map.promoted ? 'fail' : 'success'}
        />
    )
}
