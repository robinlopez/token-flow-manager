/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Geist', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['Geist Mono', 'ui-monospace', 'monospace'],
      },
      colors: {
        ink: {
          50: '#FAFAF9',
          100: '#F5F5F4',
          200: '#E7E5E4',
          300: '#D6D3D1',
          400: '#A8A29E',
          500: '#78716C',
          600: '#57534E',
          700: '#44403C',
          800: '#292524',
          900: '#1C1917',
          950: '#0C0A09',
        },
        // Primary accent — themeable at runtime. Values live in CSS variables
        // (channel triplets) so swapping the theme re-paints every `forge-*`
        // class. See `styles.css`: :root = Token Flow brand (#181919),
        // [data-theme="forge"] = the original orange.
        forge: {
          50: 'rgb(var(--forge-50) / <alpha-value>)',
          100: 'rgb(var(--forge-100) / <alpha-value>)',
          200: 'rgb(var(--forge-200) / <alpha-value>)',
          300: 'rgb(var(--forge-300) / <alpha-value>)',
          400: 'rgb(var(--forge-400) / <alpha-value>)',
          500: 'rgb(var(--forge-500) / <alpha-value>)',
          600: 'rgb(var(--forge-600) / <alpha-value>)',
          700: 'rgb(var(--forge-700) / <alpha-value>)',
        },
      },
    },
  },
  plugins: [],
};
