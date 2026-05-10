/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'SF Pro Display',
          'Inter',
          'system-ui',
          'sans-serif',
        ],
      },
      colors: {
        ink: {
          DEFAULT: '#0A0A0A',
          soft: '#1A1A1A',
        },
        paper: {
          DEFAULT: '#FAFAFA',
          card: '#FFFFFF',
        },
        muted: '#8E8E93',
        line: '#E5E5EA',
      },
      borderRadius: {
        card: '24px',
        pill: '9999px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.04)',
      },
    },
  },
  plugins: [],
};
