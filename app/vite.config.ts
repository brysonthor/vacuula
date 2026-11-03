/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
    plugins: [react()],
    base: "/",
    server: {
        proxy: {
            '/api': {
                target: process.env.VACUULA_API ?? 'http://192.168.1.161:8050',
                changeOrigin: true,
            },
        },
    },
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: './src/test/setup.ts',
        coverage: {
            provider: 'v8',
            reporter: ['text', 'text-summary'],
            include: ['src/**/*.{ts,tsx}'],
            exclude: [
                'src/**/*.spec.{ts,tsx}',
                'src/test/**',
                'src/main.tsx',
                'src/**/*.d.ts',
                'src/types/**',
                'src/i18n/locales/**',
            ],
        },
    },
})
