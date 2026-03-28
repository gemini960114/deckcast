import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        headline: ['"Plus Jakarta Sans"', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
        label: ['Inter', 'sans-serif'],
      },
      borderRadius: {
        DEFAULT: '1rem',
        lg: '2rem',
        xl: '3rem',
        full: '9999px',
      },
      colors: {
        primary: '#10b981',
        'primary-dim': '#059669',
        'primary-container': '#d1fae5',
        'on-primary': '#ffffff',
        'on-primary-container': '#064e3b',
        surface: '#ffffff',
        'surface-container-lowest': '#ffffff',
        'surface-container-low': '#f7faf9',
        'surface-container': '#f0f4f2',
        'surface-container-high': '#eef2f1',
        'surface-container-highest': '#e2e8e5',
        'on-surface': '#111827',
        'on-surface-variant': '#4b5563',
        'outline-variant': '#d1d5db',
      },
    },
  },
  plugins: [],
};
export default config;
