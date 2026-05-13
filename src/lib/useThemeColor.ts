import { useEffect } from 'react';

const stack: string[] = [];
const DEFAULT = '#FAFAFA';

function apply() {
  if (typeof document === 'undefined') return;
  const next = stack[stack.length - 1] ?? DEFAULT;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', next);
  document.documentElement.style.backgroundColor = next;
  document.body.style.backgroundColor = next;
}

export function useThemeColor(color: string) {
  useEffect(() => {
    stack.push(color);
    apply();
    return () => {
      const idx = stack.lastIndexOf(color);
      if (idx >= 0) stack.splice(idx, 1);
      apply();
    };
  }, [color]);
}
