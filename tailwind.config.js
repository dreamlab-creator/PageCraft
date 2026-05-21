/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Screenplay page font. Falls back to system Courier if Courier Prime not installed.
        screenplay: [
          'Courier Prime',
          'Courier New',
          'Courier',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'monospace',
        ],
        // UI font: clean, restrained, prestige-software feel.
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
      colors: {
        // Prestige design language: neutral, restrained.
        ink: {
          50:  '#fafaf9',
          100: '#f4f4f2',
          200: '#e6e5e0',
          300: '#d1d0c9',
          400: '#a3a29a',
          500: '#76746b',
          600: '#54534c',
          700: '#3a3933',
          800: '#26251f',
          900: '#171612',
          950: '#0c0b08',
        },
        accent: {
          // Restrained warm bronze. Used very sparingly.
          DEFAULT: '#a8855a',
          soft:    '#c9a87a',
          deep:    '#7d623f',
        },
      },
      boxShadow: {
        page: '0 4px 24px -8px rgba(0,0,0,0.18), 0 2px 6px -2px rgba(0,0,0,0.08)',
        'page-dark':
          '0 8px 32px -8px rgba(0,0,0,0.6), 0 2px 8px -2px rgba(0,0,0,0.4)',
      },
    },
  },
  plugins: [],
}
