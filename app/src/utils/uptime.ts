/**
 * Format elapsed seconds into a human-readable uptime counter string:
 * - < 60s: "{s}s" (e.g. "45s")
 * - < 60m: "{m}m {ss}s" (e.g. "12m 04s")
 * - < 24h: "{h}h {mm}m {ss}s" (e.g. "2h 15m 30s")
 * - >= 24h: "{d}d {hh}h {mm}m {ss}s" (e.g. "3d 04h 12m 08s")
 */
export function formatUptime(totalSeconds: number): string {
    if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
        return '0s'
    }
    const s = Math.floor(totalSeconds)
    const days = Math.floor(s / 86400)
    const hours = Math.floor((s % 86400) / 3600)
    const minutes = Math.floor((s % 3600) / 60)
    const seconds = s % 60

    const pad = (n: number) => String(n).padStart(2, '0')

    if (days > 0) {
        return `${days}d ${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`
    }
    if (hours > 0) {
        return `${hours}h ${pad(minutes)}m ${pad(seconds)}s`
    }
    if (minutes > 0) {
        return `${minutes}m ${pad(seconds)}s`
    }
    return `${seconds}s`
}

export function computeRobotUptimeSeconds(
    entry: { connected?: boolean; connected_at?: string | null; uptime?: number | null },
    nowMs: number = Date.now()
): number | null {
    if (!entry.connected) return null
    if (entry.connected_at) {
        const parsed = new Date(entry.connected_at).getTime()
        if (!Number.isNaN(parsed)) {
            return Math.max(0, Math.floor((nowMs - parsed) / 1000))
        }
    }
    if (typeof entry.uptime === 'number') {
        return Math.max(0, Math.floor(entry.uptime))
    }
    return 0
}

export function computeFleetAverageUptimeSeconds(
    robots: Record<string, { connected?: boolean; connected_at?: string | null; uptime?: number | null }>,
    nowMs: number = Date.now()
): number | null {
    const online = Object.values(robots).filter((r) => r.connected)
    if (online.length === 0) return null
    const uptimes = online.map((r) => computeRobotUptimeSeconds(r, nowMs) ?? 0)
    const sum = uptimes.reduce((a, b) => a + b, 0)
    return Math.round(sum / online.length)
}

