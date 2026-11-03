import type { ReactNode } from 'react'
import { useApp } from '../../context/useApp'

export function RequireRobot({ children }: { children: ReactNode }) {
    const { robot } = useApp()
    if (!robot) return null;
    return <>{children}</>
}