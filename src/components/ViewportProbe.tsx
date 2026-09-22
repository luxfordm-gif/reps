import { useEffect, useRef, useState } from 'react';

/**
 * What the browser is actually doing with the viewport, printed on the screen.
 *
 * Off unless the URL carries `?vv=1`. It exists because the one thing none of
 * our tooling can reach is an iPhone with its keyboard up, and three very
 * different faults look identical in a photograph of one: the document
 * scrolling, the browser panning the visual viewport underneath a fixed box,
 * and a box sized against a viewport that never shrank.
 *
 * Reading the line, left to right:
 *   ih   window.innerHeight — the layout viewport, which the keyboard doesn't
 *        change on iOS
 *   vv   visualViewport.height — what is actually visible. Far below ih means
 *        the keyboard is up and the browser has told us so
 *   off  visualViewport.offsetTop — how far the browser has panned the visible
 *        window down the page. Anything but 0 with the page locked means the
 *        browser moved the world rather than scrolling it
 *   sy   window.scrollY — the document itself scrolling, which the scroll lock
 *        is supposed to make impossible
 *   me   this strip's own top, in client coordinates. It is fixed at 0, so a
 *        value that isn't 0 — or a screenshot with no strip at all — says
 *        fixed boxes are not where the layout thinks they are
 *   fld  the focused field's top and bottom. Below vv is a field behind the
 *        keyboard, which is what makes a browser start moving things
 */
export function ViewportProbe() {
  const [on] = useState(
    () =>
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('vv') === '1'
  );
  const [text, setText] = useState('');
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!on) return;
    let frame = 0;
    const read = () => {
      const vv = window.visualViewport;
      const me = ref.current?.getBoundingClientRect();
      const active = document.activeElement;
      const field =
        active && active !== document.body && 'getBoundingClientRect' in active
          ? (active as HTMLElement).getBoundingClientRect()
          : null;
      setText(
        [
          `ih${Math.round(window.innerHeight)}`,
          `vv${vv ? Math.round(vv.height) : '-'}`,
          `off${vv ? Math.round(vv.offsetTop) : '-'}`,
          `sy${Math.round(window.scrollY)}`,
          `me${me ? Math.round(me.top) : '-'}`,
          field
            ? `fld${Math.round(field.top)}-${Math.round(field.bottom)}`
            : 'fld-',
        ].join(' ')
      );
      frame = window.requestAnimationFrame(read);
    };
    frame = window.requestAnimationFrame(read);
    return () => window.cancelAnimationFrame(frame);
  }, [on]);

  if (!on) return null;
  return (
    <div
      ref={ref}
      className="pointer-events-none fixed inset-x-0 top-0 z-[999] bg-ink/90 px-2 py-1 text-center font-mono text-[11px] leading-none text-white"
    >
      {text}
    </div>
  );
}
