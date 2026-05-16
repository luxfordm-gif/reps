import { useEffect, useState } from 'react';
import { Logo } from './Logo';

interface Props {
  visible: boolean;
}

export function Splash({ visible }: Props) {
  // Keep the overlay mounted briefly after `visible` flips false so we can
  // play the fade-out before unmount.
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      return;
    }
    const t = window.setTimeout(() => setMounted(false), 320);
    return () => window.clearTimeout(t);
  }, [visible]);

  if (!mounted) return null;

  return (
    <div
      aria-hidden
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black"
      style={{
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? 'auto' : 'none',
        transition: 'opacity 280ms ease-out',
      }}
    >
      <style>{`
        @keyframes reps-splash-enter {
          0% { opacity: 0; transform: scale(0.96); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes reps-splash-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.78; }
        }
        @keyframes reps-splash-dash {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(220%); }
        }
      `}</style>
      <div
        style={{
          animation:
            'reps-splash-enter 180ms ease-out both, reps-splash-pulse 1600ms ease-in-out 200ms infinite',
        }}
      >
        <Logo className="h-10 w-auto brightness-0 invert" />
      </div>
      <div className="mt-7 h-px w-14 overflow-hidden">
        <div
          className="h-full w-1/2 bg-white/85"
          style={{
            animation: 'reps-splash-dash 1100ms cubic-bezier(0.45, 0.05, 0.55, 0.95) infinite',
          }}
        />
      </div>
    </div>
  );
}
