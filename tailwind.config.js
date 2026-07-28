/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0a0b10',
        surface: '#14151c',
        card: '#0b0c12',
        border: '#23242e',
        borderSoft: '#1b1c25',
        muted: '#7c7d8c',
        text: '#e7e7ee',
        subtle: '#9a9bab',
        accent: '#6366f1',
        accent2: '#22d3ee',
        ok: '#34d399',
        danger: '#fb7185',
        warn: '#fb923c'
      }
    }
  },
  plugins: []
}
