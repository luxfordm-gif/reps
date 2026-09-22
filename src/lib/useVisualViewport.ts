import { useEffect, useState } from 'react';

/** The part of the page the user can actually see, in CSS pixels. */
export interface ViewportBox {
  height: number;
}

// `position: fixed` is measured against the layout viewport, which doesn't
// shrink when the on-screen keyboard opens — so a sheet pinned to the bottom of
// it ends up behind the keyboard, and the browser scrolls the whole page to
// compensate. Sizing the sheet to the visual viewport instead puts it above the
// keyboard on its own, so there is nothing for the browser to scroll.
//
// Only the height is reported. `visualViewport.offsetTop` looks like the other
// half of the answer — offset the sheet by however far the visual viewport has
// been panned down the layout viewport — and on paper it is, but every surface
// that reads this hook also locks the page behind it, so there is nothing to
// pan and the offset should always be 0. It isn't on iOS Safari: opening the
// keyboard pans the visual viewport *and* carries fixed elements along with it,
// so adding the offset counts the same shift twice. That's the setup flow
// dropping its heading a hundred points down the screen the moment you type,
// and taking Continue off the bottom with it. Reading height alone leaves each
// sheet where the browser already put it.
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
  if (!vv) return null;
  // A pinch-zoomed visual viewport is shorter than the screen without the
  // keyboard being anywhere near it; a sheet has no business shrinking for
  // that, and never wants to be taller than the window either.
  return { height: Math.min(vv.height, window.innerHeight) };
}
