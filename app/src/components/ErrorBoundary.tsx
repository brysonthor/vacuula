import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
    children: ReactNode
}

interface State {
    hasError: boolean
    error: Error | null
    errorInfo: ErrorInfo | null
}

export class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null,
        errorInfo: null,
    }

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error, errorInfo: null }
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('Uncaught error in UI:', error, errorInfo)
        this.setState({ error, errorInfo })
    }

    public render() {
        if (this.state.hasError) {
            return (
                <div
                    style={{
                        padding: '2.5rem',
                        maxWidth: '720px',
                        margin: '3rem auto',
                        fontFamily: 'system-ui, -apple-system, sans-serif',
                        background: '#16191d',
                        color: '#f0f3f6',
                        borderRadius: '16px',
                        border: '1px solid rgba(255, 92, 92, 0.4)',
                        boxShadow: '0 12px 32px rgba(0, 0, 0, 0.4)',
                    }}
                >
                    <h2 style={{ color: '#ff6b6b', marginTop: 0, fontSize: '1.8rem' }}>
                        Something went wrong
                    </h2>
                    <p style={{ fontSize: '1.2rem', color: '#ffaaaa', lineHeight: 1.5 }}>
                        {this.state.error?.message || 'An unexpected rendering error occurred.'}
                    </p>
                    {this.state.error?.stack && (
                        <pre
                            style={{
                                background: '#0e1013',
                                padding: '1.2rem',
                                borderRadius: '10px',
                                overflowX: 'auto',
                                fontSize: '0.85rem',
                                color: '#c9d1d9',
                                whiteSpace: 'pre-wrap',
                                border: '1px solid #25292e',
                                maxHeight: '300px',
                            }}
                        >
                            {this.state.error.stack}
                        </pre>
                    )}
                    <button
                        type="button"
                        onClick={() => {
                            window.location.href = '/'
                        }}
                        style={{
                            marginTop: '1.5rem',
                            padding: '0.85rem 1.8rem',
                            background: '#00e5a3',
                            color: '#002518',
                            fontSize: '1.1rem',
                            fontWeight: 700,
                            border: 'none',
                            borderRadius: '10px',
                            cursor: 'pointer',
                        }}
                    >
                        Reload Fleet View
                    </button>
                </div>
            )
        }

        return this.props.children
    }
}
