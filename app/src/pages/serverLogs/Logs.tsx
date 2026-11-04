import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    IoArrowDownOutline,
    IoCheckmarkOutline,
    IoCloudDownloadOutline,
    IoCopyOutline,
    IoPauseOutline,
    IoPlayOutline,
    IoRefreshOutline,
    IoSearchOutline,
} from 'react-icons/io5'
import { useApp } from '../../context/useApp'
import { BASE_PATH, Http } from '../../http'
import HeaderLoadingSpinner from '../../components/loading/HeaderLoadingSpinner'
import styles from './Logs.module.scss'

type LogLevelFilter = 'ALL' | 'ERROR' | 'WARNING' | 'INFO' | 'DEBUG'

const LEVELS: LogLevelFilter[] = ['ALL', 'ERROR', 'WARNING', 'INFO', 'DEBUG']

function detectSeverity(line: string): 'error' | 'warn' | 'debug' | 'info' {
    const upper = line.toUpperCase()
    if (upper.includes('ERROR') || upper.includes('CRITICAL') || upper.includes('TRACEBACK')) {
        return 'error'
    }
    if (upper.includes('WARNING') || upper.includes('WARN')) {
        return 'warn'
    }
    if (upper.includes('DEBUG')) {
        return 'debug'
    }
    return 'info'
}

function matchesLevel(line: string, filter: LogLevelFilter): boolean {
    if (filter === 'ALL') return true
    const sev = detectSeverity(line)
    if (filter === 'ERROR') return sev === 'error'
    if (filter === 'WARNING') return sev === 'warn'
    if (filter === 'DEBUG') return sev === 'debug'
    return sev === 'info'
}

export default function Logs() {
    const { serverInfo } = useApp()
    const [rawText, setRawText] = useState('')
    const [fullMode, setFullMode] = useState(false)
    const [liveTail, setLiveTail] = useState(true)
    const [search, setSearch] = useState('')
    const [level, setLevel] = useState<LogLevelFilter>('ALL')
    const [copied, setCopied] = useState(false)
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
    const viewerRef = useRef<HTMLDivElement>(null)

    const fetchLogs = useCallback(() => {
        Http.getServerLogs(fullMode)
            .then((res) => {
                const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data, null, 2)
                setRawText(text)
                setLastUpdated(new Date())
            })
            .catch((err) => {
                console.error('Failed to fetch server logs', err)
            })
    }, [fullMode])

    useEffect(() => {
        fetchLogs()
    }, [fetchLogs])

    useEffect(() => {
        if (!liveTail) return
        const id = setInterval(() => {
            fetchLogs()
        }, 3000)
        return () => clearInterval(id)
    }, [liveTail, fetchLogs])

    const allLines = useMemo(() => {
        if (!rawText) return []
        const split = rawText.split(/\r?\n/)
        if (split.length > 0 && split[split.length - 1] === '') {
            split.pop()
        }
        return split
    }, [rawText])

    const filteredLines = useMemo(() => {
        const q = search.trim().toLowerCase()
        return allLines
            .map((text, idx) => ({ num: idx + 1, text, sev: detectSeverity(text) }))
            .filter((item) => {
                if (!matchesLevel(item.text, level)) return false
                if (q && !item.text.toLowerCase().includes(q)) return false
                return true
            })
    }, [allLines, level, search])

    const scrollToBottom = useCallback(() => {
        const el = viewerRef.current
        if (!el) return
        el.scrollTop = el.scrollHeight
    }, [])

    useEffect(() => {
        if (liveTail) {
            scrollToBottom()
        }
    }, [filteredLines.length, liveTail, scrollToBottom])

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(filteredLines.map((l) => l.text).join('\n'))
            setCopied(true)
            setTimeout(() => setCopied(false), 1800)
        } catch (err) {
            console.error('Clipboard copy failed', err)
        }
    }

    return (
        <div className={styles.page}>
            <header className={styles.header}>
                <div className={styles.titleBlock}>
                    <h1>
                        Vacuula Server Logs
                        <HeaderLoadingSpinner size={18} />
                    </h1>
                    <p>
                        Live server stream • Vacuula v{serverInfo.version} ({serverInfo.timezone})
                    </p>
                </div>
                <div className={styles.actionsGroup}>
                    <button
                        type="button"
                        className={`${styles.btn} ${liveTail ? styles.active : ''}`}
                        onClick={() => setLiveTail((v) => !v)}
                    >
                        {liveTail ? <IoPauseOutline size={15} /> : <IoPlayOutline size={15} />}
                        <span>{liveTail ? 'Live Tail (3s)' : 'Paused'}</span>
                    </button>
                    <button
                        type="button"
                        className={`${styles.btn} ${fullMode ? styles.active : ''}`}
                        onClick={() => setFullMode((v) => !v)}
                    >
                        <span>{fullMode ? 'Showing: Full Log' : 'Showing: Recent'}</span>
                    </button>
                    <button
                        type="button"
                        className={styles.btn}
                        onClick={() => void fetchLogs()}
                    >
                        <IoRefreshOutline size={15} />
                        <span>Refresh</span>
                    </button>
                </div>
            </header>

            <div className={styles.toolbar}>
                <div className={styles.searchWrap}>
                    <IoSearchOutline size={17} />
                    <input
                        type="search"
                        placeholder="Filter log lines by serial, route, error, or keyword…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>

                <div className={styles.pillGroup}>
                    {LEVELS.map((lvl) => (
                        <button
                            key={lvl}
                            type="button"
                            className={`${styles.pill} ${level === lvl ? styles.active : ''}`}
                            onClick={() => setLevel(lvl)}
                        >
                            {lvl}
                        </button>
                    ))}
                </div>

                <div className={styles.actionsGroup}>
                    <button type="button" className={styles.btn} onClick={() => void handleCopy()}>
                        {copied ? <IoCheckmarkOutline size={15} /> : <IoCopyOutline size={15} />}
                        <span>{copied ? 'Copied' : 'Copy'}</span>
                    </button>
                    <button type="button" className={styles.btn} onClick={scrollToBottom}>
                        <IoArrowDownOutline size={15} />
                        <span>Bottom</span>
                    </button>
                    <a
                        className={styles.btn}
                        href={`${BASE_PATH}/api/log/full?download=true`}
                        download
                    >
                        <IoCloudDownloadOutline size={15} />
                        <span>Download</span>
                    </a>
                </div>
            </div>

            <div ref={viewerRef} className={styles.viewer}>
                {filteredLines.length === 0 ? (
                    <div className={styles.emptyState}>
                        No log lines match the current filter.
                    </div>
                ) : (
                    filteredLines.map((line) => (
                        <div key={line.num} className={`${styles.logLine} ${styles[line.sev]}`}>
                            <span className={styles.lineNum}>{line.num}</span>
                            <span className={styles.lineText}>{line.text}</span>
                        </div>
                    ))
                )}
            </div>

            <footer className={styles.footerMeta}>
                <span>
                    Showing {filteredLines.length} of {allLines.length} lines
                </span>
                <span>
                    {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : 'Loading…'}
                </span>
            </footer>
        </div>
    )
}
