import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        teal:  { DEFAULT: '#00A9BA', dim: 'rgba(0,169,186,0.15)' },
        'ta-bg':    '#0A0A0F',
        'ta-card':  '#0D1B2A',
        'ta-card2': '#111827',
        'ta-card3': '#1C2333',
      },
      fontFamily: {
        display: ['Orbitron', 'monospace'],
        body:    ['Exo 2', 'Inter', 'sans-serif'],
      },
      backgroundImage: {
        'teal-gradient': 'linear-gradient(135deg, #00A9BA, #1565C0)',
        'card-glass':    'linear-gradient(135deg, rgba(13,27,42,0.7), rgba(17,24,39,0.7))',
      },
      animation: {
        shimmer: 'shimmer 2s linear infinite',
      },
      keyframes: {
        shimmer: {
          '0%':   { backgroundPosition: '-1000px 0' },
          '100%': { backgroundPosition:  '1000px 0' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
