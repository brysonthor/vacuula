import { COLORS, DRAWING, readMapToken } from './constants'
import type { Zone, NoGoLine, Point, BasePose } from './types'
import { normalizeHex, withAlpha } from './color'
import { calcRelevancy } from './utils'
import dockUrl from '../../assets/dock.svg'

/* ---------------- SHAPE TYPES ---------------- */

export type CellShape = 'heart' | 'circle' | 'square'

/* ---------------- SHAPE CACHE ---------------- */

const SHAPE_CACHE = new Map<string, Path2D>()

function getShape(type: CellShape, size: number): Path2D {
    const key = `${type}:${size}`

    const cached = SHAPE_CACHE.get(key)
    if (cached) return cached

    const path = new Path2D()
    const s = size
    const cx = 0
    const cy = 0

    if (type === 'square') {
        path.rect(-s, -s, s * 2, s * 2)
    } else if (type === 'circle') {
        path.arc(cx, cy, s / 2, 0, Math.PI * 2)
    } else if (type === 'heart') {
        path.moveTo(cx, cy + s / 4)
        path.bezierCurveTo(
            cx - s / 2, cy - s / 4,
            cx - s, cy + s / 2,
            cx, cy + s
        )
        path.bezierCurveTo(
            cx + s, cy + s / 2,
            cx + s / 2, cy - s / 4,
            cx, cy + s / 4
        )
    }

    SHAPE_CACHE.set(key, path)
    return path
}

/* ---------------- VIEWPORT ---------------- */

function getVisibleBounds(
    canvas: HTMLCanvasElement,
    zoom: number,
    offset: { x: number; y: number }
) {
    return {
        minX: Math.floor((-offset.x) / zoom),
        minY: Math.floor((-offset.y) / zoom),
        maxX: Math.ceil((canvas.width - offset.x) / zoom),
        maxY: Math.ceil((canvas.height - offset.y) / zoom)
    }
}

/* ---------------- MAIN MAP ---------------- */
const GOLDEN_RATIO_CONJUGATE = 0.6180339887498949

// Deterministic, distinct color per raw path-map pixel value — same value
// always gets the same color, so we don't need to ship/parse runmap.json's
// "legend" on the frontend at all.
export function colorForPathValue(value: number): string {
    const hue = (value * GOLDEN_RATIO_CONJUGATE) % 1
    const sat = parseFloat(COLORS.RUN_SAT) || 75
    const light = parseFloat(COLORS.RUN_LIGHT) || 55
    return `hsl(${Math.round(hue * 360)}, ${sat}%, ${light}%)`
}

// Build the set of raw path-map values to skip when overlaying the run.
// `ignoreCount` = how many of the *highest* distinct non-zero values to
// treat as noise (e.g. ignoreCount=1 hides whichever path value is
// largest, ignoreCount=2 hides the two largest, etc).
export function computeIgnoredRunValues(runCells: number[] | null, ignoreCount: number): Set<number> {
    if (!runCells || ignoreCount <= 0) return new Set()

    const distinct = Array.from(new Set(runCells.filter(v => v !== 0))).sort((a, b) => b - a)
    return new Set(distinct.slice(0, ignoreCount))
}


interface RunOverlayOptions {
    getRunColor?: (value: number) => string
    ignoreRunValues?: Set<number>
    opacity?: number
}

export function drawMap(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    cells: number[],
    zoom: number,
    offset: { x: number; y: number },
    mapSize: { height: number; width: number },
    shape: CellShape = 'circle',
    runCells?: number[] | null,
    runOptions?: RunOverlayOptions,
    backgroundToken?: string
) {
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    ctx.fillStyle = backgroundToken ? readMapToken(backgroundToken) : COLORS.BACKGROUND
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    const bounds = getVisibleBounds(canvas, zoom, offset)

    const startX = Math.max(0, bounds.minX)
    const startY = Math.max(0, bounds.minY)
    const endX = Math.min(mapSize.width, bounds.maxX)
    const endY = Math.min(mapSize.height, bounds.maxY)

    const hasRun = !!runCells && runCells.length === cells.length
    const getRunColor = runOptions?.getRunColor ?? colorForPathValue
    const ignoreRunValues = runOptions?.ignoreRunValues
    const runOpacity = runOptions?.opacity ?? (parseFloat(COLORS.RUN_OPACITY) || DRAWING.RUN_OVERLAY_OPACITY)

    const scale = zoom
    const ox = offset.x
    const oy = offset.y
    const size = Math.max(1, scale * 0.5)
    const floorSize = Math.max(1, scale * 0.45)
    const wallSize = Math.max(1.5, scale * 0.75)

    for (let y = startY; y < endY; y++) {
        const row = y * mapSize.width

        for (let x = startX; x < endX; x++) {
            const idx = row + x
            const floorValue = cells[idx]
            const cx = ox + x * scale + scale / 2
            const cy = oy + y * scale + scale / 2

            if (floorValue !== undefined && floorValue !== 0) {
                const isWall = floorValue !== 1
                ctx.fillStyle = isWall ? COLORS.WALL : COLORS.EMPTY
                ctx.save()
                ctx.translate(cx, cy)
                ctx.fill(getShape(shape, isWall ? wallSize : floorSize))
                ctx.restore()
            }

            if (hasRun) {
                const runValue = runCells![idx]
                if (runValue !== undefined && runValue !== 0 && !ignoreRunValues?.has(runValue)) {
                    ctx.save()
                    ctx.globalAlpha = runOpacity
                    ctx.fillStyle = getRunColor(runValue)
                    ctx.translate(cx, cy)
                    ctx.fill(getShape(shape, size))
                    ctx.restore()
                }
            }
        }
    }
}

/* ---------------- ZONES & LABELS ---------------- */

export interface DrawZonesOptions {
    showLabels?: boolean
    /** Map of zone.id -> 1-based sequence index when ordered cleaning is active */
    selectedOrderMap?: Record<string, number>
    highlightedId?: string
    /** Currently active cleaning zone for live room tracking */
    activeZoneId?: string
}

function drawRoundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
) {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.lineTo(x + w - r, y)
    ctx.quadraticCurveTo(x + w, y, x + w, y + r)
    ctx.lineTo(x + w, y + h - r)
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
    ctx.lineTo(x + r, y + h)
    ctx.quadraticCurveTo(x, y + h, x, y + h - r)
    ctx.lineTo(x, y + r)
    ctx.quadraticCurveTo(x, y, x + r, y)
    ctx.closePath()
}

function drawZone(
    ctx: CanvasRenderingContext2D,
    zone: Zone,
    zoom: number,
    offset: { x: number; y: number },
    mapSize: { height: number; width: number },
    options?: DrawZonesOptions
) {
    if (zone.vertices.length < 3) return

    const orderNum = options?.selectedOrderMap?.[zone.id]
    const isActiveZone = options?.activeZoneId === zone.id
    const isHighlighted = options?.highlightedId === zone.id || orderNum !== undefined || isActiveZone
    const outline = isActiveZone ? '#3ddc97' : (normalizeHex(zone.color) ?? COLORS.LINE_COLOR)
    const fillAlpha = isActiveZone
        ? 0.38
        : isHighlighted
            ? Math.min(0.42, DRAWING.ZONE_FILL_ALPHA * 1.9)
            : DRAWING.ZONE_FILL_ALPHA

    ctx.save()
    ctx.fillStyle = withAlpha(isActiveZone ? '#3ddc97' : zone.color, fillAlpha, COLORS.POLYGON_FILL)
    ctx.strokeStyle = outline
    ctx.lineWidth = Math.max(
        isActiveZone
            ? DRAWING.MIN_LINE_WIDTH + 2.2
            : isHighlighted
                ? DRAWING.MIN_LINE_WIDTH + 1.2
                : DRAWING.MIN_LINE_WIDTH,
        zoom * DRAWING.POLYGON_LINE_WIDTH_SCALE * (isActiveZone ? 1.6 : isHighlighted ? 1.35 : 1)
    )

    if (zone.function === 'nogo') {
        ctx.setLineDash([6, 4])
    }

    const sx = mapSize.width * zoom
    const sy = mapSize.height * zoom

    ctx.beginPath()
    const first = zone.vertices[0]
    ctx.moveTo(offset.x + first[0] * sx, offset.y + first[1] * sy)
    for (let i = 1; i < zone.vertices.length; i++) {
        const p = zone.vertices[i]
        ctx.lineTo(offset.x + p[0] * sx, offset.y + p[1] * sy)
    }
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    ctx.restore()

    // Draw room name pill label
    const showLabels = options?.showLabels ?? true
    const rawName = (zone.name || '').trim()
    if (showLabels && rawName && rawName !== '__vacuula_clean_here__') {
        const [cxNorm, cyNorm] = calcRelevancy(zone.vertices)
        const cx = offset.x + cxNorm * sx
        const cy = offset.y + cyNorm * sy

        const text = isActiveZone
            ? (orderNum !== undefined ? `#${orderNum} ⚡ ${rawName}` : `⚡ ${rawName}`)
            : (orderNum !== undefined ? `#${orderNum} ${rawName}` : rawName)
        ctx.save()
        ctx.font = '600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif'
        const metrics = ctx.measureText(text)
        const padX = 8
        const pillH = 22
        const pillW = metrics.width + padX * 2

        drawRoundedRect(ctx, cx - pillW / 2, cy - pillH / 2, pillW, pillH, 6)
        ctx.fillStyle = isActiveZone
            ? '#064e3b'
            : orderNum !== undefined
                ? outline
                : 'rgba(13, 17, 23, 0.82)'
        ctx.fill()
        ctx.strokeStyle = outline
        ctx.lineWidth = isActiveZone ? 1.8 : 1.25
        ctx.stroke()

        ctx.fillStyle = isActiveZone
            ? '#ecfdf5'
            : orderNum !== undefined
                ? '#08130e'
                : '#f0f4f8'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(text, cx, cy + 0.5)
        ctx.restore()
    }
}

export function drawZones(
    ctx: CanvasRenderingContext2D,
    zones: Zone[],
    zoom: number,
    offset: { x: number; y: number },
    mapSize: { height: number; width: number },
    options?: DrawZonesOptions
) {
    for (const p of zones) {
        drawZone(ctx, p, zoom, offset, mapSize, options)
    }
}

/* ---------------- POLYLINES ---------------- */

function drawNoGoLine(
    ctx: CanvasRenderingContext2D,
    nogoLine: NoGoLine,
    zoom: number,
    offset: { x: number; y: number },
    mapSize: { height: number; width: number },
) {
    if (nogoLine.vertices.length < 2) return

    ctx.strokeStyle = normalizeHex(nogoLine.color) ?? COLORS.LINE_COLOR

    const sx = mapSize.width * zoom
    const sy = mapSize.height * zoom

    ctx.beginPath()

    const first = nogoLine.vertices[0]
    ctx.moveTo(offset.x + first[0] * sx, offset.y + first[1] * sy)

    for (let i = 1; i < nogoLine.vertices.length; i++) {
        const p = nogoLine.vertices[i]
        ctx.lineTo(offset.x + p[0] * sx, offset.y + p[1] * sy)
    }

    ctx.stroke()
}

export function drawNoGoLines(
    ctx: CanvasRenderingContext2D,
    nogoLines: NoGoLine[],
    zoom: number,
    offset: { x: number; y: number },
    mapSize: { height: number; width: number },
) {
    ctx.lineWidth = Math.max(DRAWING.MIN_LINE_WIDTH, zoom * DRAWING.POLYLINE_LINE_WIDTH_SCALE)

    for (const p of nogoLines) {
        drawNoGoLine(ctx, p, zoom, offset, mapSize)
    }
}

/* ---------------- IN PROGRESS ---------------- */

export interface DrawInProgressOptions {
    hoverPoint?: Point | null
    closed?: boolean
}

export function drawInProgressPolyline(
    ctx: CanvasRenderingContext2D,
    pts: Point[],
    zoom: number,
    offset: { x: number; y: number },
    mapSize: { height: number; width: number },
    options?: DrawInProgressOptions
) {
    if (!pts.length) return

    const sx = mapSize.width * zoom
    const sy = mapSize.height * zoom

    ctx.save()
    ctx.strokeStyle = COLORS.IN_PROGRESS
    ctx.lineWidth = Math.max(DRAWING.MIN_LINE_WIDTH, zoom * DRAWING.IN_PROGRESS_LINE_WIDTH_SCALE)

    if (pts.length > 1) {
        ctx.beginPath()
        const first = pts[0]
        ctx.moveTo(offset.x + first[0] * sx, offset.y + first[1] * sy)
        for (let i = 1; i < pts.length; i++) {
            const p = pts[i]
            ctx.lineTo(offset.x + p[0] * sx, offset.y + p[1] * sy)
        }
        if (options?.closed && pts.length >= 3) {
            ctx.closePath()
            ctx.fillStyle = withAlpha(COLORS.IN_PROGRESS, 0.18, COLORS.POLYGON_FILL)
            ctx.fill()
        }
        ctx.stroke()
    }

    // Hover preview segment from last vertex to cursor
    if (options?.hoverPoint && !options?.closed && pts.length >= 1) {
        const last = pts[pts.length - 1]
        const hov = options.hoverPoint
        ctx.save()
        ctx.setLineDash([5, 5])
        ctx.globalAlpha = 0.75
        ctx.beginPath()
        ctx.moveTo(offset.x + last[0] * sx, offset.y + last[1] * sy)
        ctx.lineTo(offset.x + hov[0] * sx, offset.y + hov[1] * sy)
        ctx.stroke()
        ctx.restore()
    }

    // Draggable vertex handles
    for (let i = 0; i < pts.length; i++) {
        const p = pts[i]
        const px = offset.x + p[0] * sx
        const py = offset.y + p[1] * sy
        ctx.beginPath()
        ctx.arc(px, py, i === 0 ? DRAWING.POINT_RADIUS + 1.5 : DRAWING.POINT_RADIUS, 0, Math.PI * 2)
        ctx.fillStyle = i === 0 ? '#ffffff' : COLORS.IN_PROGRESS
        ctx.fill()
        ctx.lineWidth = 2
        ctx.strokeStyle = COLORS.IN_PROGRESS
        ctx.stroke()
    }
    ctx.restore()
}

/* ---------------- CROSSHAIR ---------------- */

export function drawCrosshair(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement
) {
    const cx = canvas.width / 2
    const cy = canvas.height / 2

    ctx.strokeStyle = COLORS.CROSSHAIR
    ctx.lineWidth = 2

    ctx.beginPath()
    ctx.moveTo(cx - DRAWING.CROSSHAIR_SIZE, cy)
    ctx.lineTo(cx + DRAWING.CROSSHAIR_SIZE, cy)
    ctx.stroke()

    ctx.beginPath()
    ctx.moveTo(cx, cy - DRAWING.CROSSHAIR_SIZE)
    ctx.lineTo(cx, cy + DRAWING.CROSSHAIR_SIZE)
    ctx.stroke()

    ctx.fillStyle = COLORS.CROSSHAIR
    ctx.beginPath()
    ctx.arc(cx, cy, DRAWING.CROSSHAIR_CENTER_RADIUS, 0, Math.PI * 2)
    ctx.fill()
}

/* ---------------- BASE (DOCK + ROBOT) ---------------- */

const DOCK_VIEWBOX = { x: -10, y: -18, w: 20, h: 36 }
const DOCK_UNIT_R = 16
const ROBOT_RADIUS_MM = 165

let dockImage: HTMLImageElement | null = null
let dockReady = false
const dockReadyListeners = new Set<() => void>()

function getDockImage(): HTMLImageElement {
    if (!dockImage) {
        dockImage = new Image()
        dockImage.onload = () => {
            dockReady = true
            dockReadyListeners.forEach(fn => fn())
            dockReadyListeners.clear()
        }
        dockImage.src = dockUrl
    }
    return dockImage
}

export function onDockImageReady(fn: () => void) {
    if (dockReady) return
    dockReadyListeners.add(fn)
    getDockImage()
}

export type { BasePose } from './types'

export interface DrawBaseOptions {
    isDocked?: boolean
    isCharging?: boolean
    charge?: number
    isOnline?: boolean
}

function drawDockedNeato(ctx: CanvasRenderingContext2D, rPx: number, isCharging: boolean) {
    const r = Math.max(13, rPx)
    ctx.save()

    // Soft drop shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)'
    ctx.shadowBlur = Math.max(4, r * 0.35)
    ctx.shadowOffsetY = Math.max(2, r * 0.15)

    const w = r * 1.85
    const hw = w / 2
    const frontY = r * 1.6
    const cornerR = r * 0.28
    const rearY = -r * 0.1

    // D-shape chassis
    ctx.beginPath()
    ctx.moveTo(-hw + cornerR, frontY)
    ctx.lineTo(hw - cornerR, frontY)
    ctx.quadraticCurveTo(hw, frontY, hw, frontY - cornerR)
    ctx.lineTo(hw, rearY)
    ctx.bezierCurveTo(hw, -r * 0.95, -hw, -r * 0.95, -hw, rearY)
    ctx.lineTo(-hw, frontY - cornerR)
    ctx.quadraticCurveTo(-hw, frontY, -hw + cornerR, frontY)
    ctx.closePath()

    ctx.fillStyle = '#1e242b'
    ctx.fill()

    // Reset shadow for crisp inner lines
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    ctx.shadowOffsetY = 0

    ctx.strokeStyle = '#475569'
    ctx.lineWidth = Math.max(1.2, r * 0.08)
    ctx.stroke()

    // Bumper split line
    ctx.strokeStyle = '#334155'
    ctx.lineWidth = Math.max(1, r * 0.05)
    ctx.beginPath()
    ctx.moveTo(-hw + cornerR * 0.5, frontY - cornerR * 0.8)
    ctx.lineTo(hw - cornerR * 0.5, frontY - cornerR * 0.8)
    ctx.stroke()

    // Circular LiDAR Turret (iconic Neato feature)
    const turretR = r * 0.36
    const turretY = r * 0.45
    ctx.beginPath()
    ctx.arc(0, turretY, turretR, 0, Math.PI * 2)
    ctx.fillStyle = '#0f172a'
    ctx.fill()
    ctx.strokeStyle = '#38bdf8'
    ctx.lineWidth = Math.max(1.2, r * 0.07)
    ctx.stroke()

    // Turret inner laser scanner lens
    ctx.beginPath()
    ctx.arc(0, turretY, turretR * 0.42, 0, Math.PI * 2)
    ctx.fillStyle = isCharging ? '#3ddc97' : '#0284c7'
    ctx.fill()

    // Status LED dot
    const ledY = frontY - cornerR * 1.5
    ctx.beginPath()
    ctx.arc(0, ledY, Math.max(1.5, r * 0.08), 0, Math.PI * 2)
    ctx.fillStyle = isCharging ? '#3ddc97' : '#22c55e'
    ctx.fill()

    ctx.restore()
}

export function drawBase(
    ctx: CanvasRenderingContext2D,
    base: BasePose,
    zoom: number,
    offset: { x: number; y: number },
    mapSize: { height: number; width: number },
    resolution: number,
    options?: DrawBaseOptions,
) {
    const img = getDockImage()
    if (!dockReady) return

    const cx = offset.x + base.x * mapSize.width * zoom
    const cy = offset.y + base.y * mapSize.height * zoom

    const rPx = (ROBOT_RADIUS_MM / (resolution || 40)) * zoom
    const s = rPx / DOCK_UNIT_R

    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate((base.dir * Math.PI) / 180)
    ctx.drawImage(img, DOCK_VIEWBOX.x * s, DOCK_VIEWBOX.y * s, DOCK_VIEWBOX.w * s, DOCK_VIEWBOX.h * s)

    const isDocked = options?.isDocked ?? false
    if (isDocked) {
        drawDockedNeato(ctx, rPx, !!options?.isCharging)
    }
    ctx.restore()

    if (zoom >= 0.45) {
        ctx.save()
        ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif'
        const chargeText = options?.charge !== undefined ? `${options.charge}%` : ''
        const badgeText = isDocked
            ? (chargeText ? `⚡ Docked • ${chargeText}` : '⚡ Docked at Base')
            : 'Base'
        const metrics = ctx.measureText(badgeText)
        const padX = 7
        const pillH = 20
        const pillW = metrics.width + padX * 2
        const badgeY = cy + Math.max(18, rPx * 1.35) + 6
        const badgeX = cx

        drawRoundedRect(ctx, badgeX - pillW / 2, badgeY - pillH / 2, pillW, pillH, 5)
        ctx.fillStyle = isDocked ? 'rgba(15, 23, 42, 0.92)' : 'rgba(24, 28, 31, 0.85)'
        ctx.fill()
        ctx.strokeStyle = isDocked ? '#3ddc97' : '#475569'
        ctx.lineWidth = 1.2
        ctx.stroke()

        ctx.fillStyle = isDocked ? '#3ddc97' : '#94a3b8'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(badgeText, badgeX, badgeY + 0.5)
        ctx.restore()
    }
}
