import { useCallback, useSyncExternalStore } from 'react'

// Runtime theme: two independent axes persisted in localStorage.
//   mode   -> data-theme  on <html>  ("dark" | "soft" | "light")
//   accent -> data-accent on <html>  (one of ACCENTS)
// The tokens themselves live in ./theme.css; index.html applies the stored
// values before any CSS loads so there is no flash of the wrong background.

export type ThemeMode = 'dark' | 'soft' | 'light'

export const THEME_MODES: ThemeMode[] = ['dark', 'soft', 'light']
export const DEFAULT_THEME: ThemeMode = 'dark'
export const THEME_STORAGE_KEY = 'vacuula.theme'

export interface AccentOption {
    id: string
    label: string
    /** Swatch colour for a future picker (dark-mode value). */
    preview: string
}

// Add an accent here after adding its blocks in theme.css.
export const ACCENTS: AccentOption[] = [
    { id: 'mint', label: 'Mint', preview: '#3ddc97' },
    { id: 'sky', label: 'Sky', preview: '#38bdf8' },
    { id: 'violet', label: 'Violet', preview: '#a78bfa' },
    { id: 'amber', label: 'Amber', preview: '#fbbf24' },
    { id: 'rose', label: 'Rose', preview: '#fb7185' },
]
export const DEFAULT_ACCENT = ACCENTS[0].id
export const ACCENT_STORAGE_KEY = 'vacuula.accent'

// Page background per mode. Must match --bg in theme.css and the script in index.html.
const PAGE_BACKGROUND: Record<ThemeMode, string> = {
    dark: '#0f1113',
    soft: '#25292e',
    light: '#f4f6f5',
}

const isThemeMode = (value: string | null): value is ThemeMode =>
    THEME_MODES.includes(value as ThemeMode)

const readStorage = (key: string): string | null => {
    try {
        return localStorage.getItem(key)
    } catch {
        return null
    }
}

const writeStorage = (key: string, value: string) => {
    try {
        localStorage.setItem(key, value)
    } catch {
        // storage unavailable (private mode, quota) - theme still applies for this session
    }
}

export function getTheme(): ThemeMode {
    const stored = readStorage(THEME_STORAGE_KEY)
    return isThemeMode(stored) ? stored : DEFAULT_THEME
}

export function getAccent(): string {
    const stored = readStorage(ACCENT_STORAGE_KEY)
    return ACCENTS.some(a => a.id === stored) ? (stored as string) : DEFAULT_ACCENT
}

/** Writes the current mode/accent to <html> (attributes, background, colour-scheme, theme-color). */
export function applyTheme(mode: ThemeMode = getTheme(), accent: string = getAccent()) {
    const html = document.documentElement
    html.setAttribute('data-theme', mode)
    html.setAttribute('data-accent', accent)
    html.style.backgroundColor = PAGE_BACKGROUND[mode]
    // "soft" is a dark scheme too (only "light" flips native controls/scrollbars).
    html.style.colorScheme = mode === 'light' ? 'light' : 'dark'
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', PAGE_BACKGROUND[mode])
}

// --- tiny external store so any component can subscribe ---
const listeners = new Set<() => void>()
const notify = () => listeners.forEach(fn => fn())
const subscribe = (fn: () => void) => {
    listeners.add(fn)
    return () => { listeners.delete(fn) }
}

export function setTheme(mode: ThemeMode) {
    writeStorage(THEME_STORAGE_KEY, mode)
    applyTheme(mode, getAccent())
    notify()
}

export function setAccent(accent: string) {
    if (!ACCENTS.some(a => a.id === accent)) return
    writeStorage(ACCENT_STORAGE_KEY, accent)
    applyTheme(getTheme(), accent)
    notify()
}

export function useTheme() {
    const theme = useSyncExternalStore(subscribe, getTheme, () => DEFAULT_THEME)
    const accent = useSyncExternalStore(subscribe, getAccent, () => DEFAULT_ACCENT)
    const set = useCallback((mode: ThemeMode) => setTheme(mode), [])
    const setAccentCb = useCallback((id: string) => setAccent(id), [])
    return { theme, setTheme: set, accent, setAccent: setAccentCb, isDark: theme !== 'light' }
}

// Make sure the attributes are present even if index.html's inline script was
// removed or blocked; harmless when it already ran.
applyTheme()
