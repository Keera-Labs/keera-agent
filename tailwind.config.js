/** @type {import('tailwindcss').Config} */
export default {
    content: [
        './resources/js/**/*.{ts,tsx}',
        './resources/views/**/*.html',
    ],

    theme: {
        extend: {
            // ── Dark sidebar / editor theme ──────────────────────────
            colors: {
                // Backgrounds
                'bg-canvas':  '#010409',
                'bg-base':    '#0d1117',
                'bg-surface': '#161b22',

                // Borders
                'border':       '#21262d',
                'border-muted': '#30363d',

                // Text
                'text-primary':   '#e6edf3',
                'text-secondary': '#c9d1d9',
                'text-tertiary':  '#8b949e',
                'text-muted':     '#7d8590',
                'text-ghost':     '#6e7681',
                'text-faint':     '#484f58',

                // Accent (blue)
                'accent':          '#58a6ff',
                'accent-muted':    '#79c0ff',
                'accent-emphasis': '#1f6feb',
                'accent-subtle':   '#0d419d',

                // Success (green)
                'success':          '#3fb950',
                'success-emphasis': '#238636',
                'success-border':   '#2ea043',

                // Warning (yellow)
                'warning':        '#d29922',
                'warning-bright': '#f0b429',
                'warning-subtle': '#4a3800',

                // Danger (red)
                'danger':        '#ff7b72',
                'danger-light':  '#ffa198',
                'danger-subtle': '#67060c',
                'danger-canvas': '#1c1012',

                // Priority
                'priority-medium-bg': '#1c2128',

                // Language dots
                'lang-python':     '#3572a5',
                'lang-typescript': '#3178c6',
                'lang-go':         '#00add8',
                'lang-rust':       '#dea584',
                'lang-javascript': '#f1e05a',

                // ── Light UI theme (content area, white background) ──
                'ui-white':        '#ffffff',
                'ui-page':         '#f1f5f9',
                'ui-surface':      '#f9fafb',
                'ui-border':       '#e5e7eb',
                'ui-border-focus': '#bfdbfe',
                'ui-text':         '#111827',
                'ui-body':         '#374151',
                'ui-muted':        '#6b7280',
                'ui-faint':        '#9ca3af',
                'ui-ghost':        '#d1d5db',
                'ui-blue':         '#3b82f6',
                'ui-blue-bg':      '#eff6ff',
                'ui-green':        '#22c55e',
                'ui-red':          '#ef4444',
            },

            fontFamily: {
                mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
            },

            borderRadius: {
                'sm': '4px',
                DEFAULT: '6px',
                'md': '8px',
                'lg': '10px',
                'xl': '12px',
            },

            boxShadow: {
                'dropdown': '0 8px 24px rgba(0,0,0,0.4)',
                'modal':    '0 16px 48px rgba(0,0,0,0.5)',
            },
        },
    },

    plugins: [],
}
