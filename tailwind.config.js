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
        // Surfaces: the greys that separate one area from another. Translucent
        // rather than opaque, so the same fill reads correctly on the page and
        // inside a white card. Three weights, by what they're for — a panel
        // recessed into a card, that panel a shade heavier, and the flash of a
        // press.
        surface: {
          DEFAULT: 'rgba(229, 229, 234, 0.3)',
          strong: 'rgba(229, 229, 234, 0.6)',
        },
        pressed: 'rgba(229, 229, 234, 0.4)',
        // Meaning, not hue: the three states that need a colour of their own.
        // Values are Tailwind's red/amber/green, which is what the app already
        // used — named here so the next one doesn't have to pick a shade.
        danger: {
          DEFAULT: '#B91C1C',
          strong: '#DC2626',
          soft: '#FEF2F2',
          line: '#FECACA',
        },
        warn: {
          DEFAULT: '#92400E',
          soft: '#FFFBEB',
          line: '#FDE68A',
        },
        good: {
          DEFAULT: '#166534',
          soft: '#F0FDF4',
        },
      },
      // Type by role rather than by size. The sizes Tailwind already names —
      // xs (12) through 2xl (24) — carry the body of the app; these are the
      // ends of the scale it has no name for.
      fontSize: {
        // Uppercase eyebrow, badge, stat label. Tracked, always short.
        label: '10px',
        // The quiet line under a row: a breakdown, a hint, a timestamp.
        caption: '11px',
        // Screen title in a compact header — 17px because that's the size iOS
        // sets a navigation bar in, and this app is read on a phone.
        nav: '17px',
        // Large title, the iOS 34pt one: a screen's name, a headline figure.
        display: '34px',
        // The one number a screen exists to show.
        'display-lg': '40px',
        'display-xl': '64px',
      },
      // Corners step down as surfaces nest: a card holds panels, a panel holds
      // controls. Anything smaller than a control — a dot, a chart bar, a
      // checkbox — keeps Tailwind's own small steps; it isn't part of this.
      borderRadius: {
        card: '24px',
        panel: '16px',
        control: '12px',
        pill: '9999px',
      },
      // Elevation, by how far off the page something sits. The plate graphics
      // in the barbell calculator keep their own inset lighting — they're an
      // illustration of a real object, not a surface in this system.
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.04)',
        lift: '0 8px 24px rgba(0,0,0,0.18)',
        'lift-soft': '0 8px 24px rgba(0,0,0,0.08)',
        hairline: '0 1px 2px rgba(0,0,0,0.06)',
        'hairline-up': '0 -2px 10px rgba(0,0,0,0.06)',
      },
    },
  },
  plugins: [],
};
