/** @type {import('tailwindcss').Config} */
export default {
    content: [
        './resources/js/**/*.{ts,tsx}',
        './resources/views/**/*.html',
    ],

    theme: {
        extend: {
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
