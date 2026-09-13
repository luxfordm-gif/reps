import { useEffect, useState } from 'react';

/** The part of the page the user can actually see, in layout-viewport pixels. */
export interface ViewportBox {
  top: number;
  height: number;
}

// `position: fixed` is measured against the layout viewport, which on Android
// doesn't shrink when the keyboard opens — so a sheet pinned to the bottom of
// it ends up behind the keyboard, and the browser scrolls the whole page to
// compensate. Sizing the sheet to the visual viewport instead puts it above the
// keyboard on its own, so there is nothing for the browser to scroll.
//
// Returns null where visualViewport isn't supported; callers should fall back
// to filling the layout viewport.
export function useVisualViewport(): ViewportBox | null {
  const [box, setBox] = useState<ViewportBox | null>(read);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setBox(read());
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return box;
}

function read(): ViewportBox | null {
  const vv = window.visualViewport;
  return vv ? { top: vv.offsetTop, height: vv.height } : null;
}
