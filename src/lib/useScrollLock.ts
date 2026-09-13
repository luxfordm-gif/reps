import { useEffect } from 'react';

// Freezes the page behind a sheet for as long as the sheet is mounted.
//
// `overflow: hidden` on its own isn't enough: when a sheet focuses an input and
// the on-screen keyboard opens, the browser scrolls the document to bring that
// input into view, which drags the page behind the sheet upwards. Pinning the
// body at its current offset leaves nothing to scroll, so the background stays
// exactly where the user left it. The offset is put back — and the scroll
// position restored — when the sheet closes.
export function useScrollLock() {
  useEffect(() => {
    const { body } = document;
    const scrollY = window.scrollY;
    const previous = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      height: body.style.height,
      overflow: body.style.overflow,
    };

    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
    // The stylesheet gives body `height: 100%`, which a fixed box resolves
    // against the viewport — the page behind would be cropped to one screen.
    body.style.height = 'auto';
    body.style.overflow = 'hidden';

    return () => {
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.left = previous.left;
      body.style.right = previous.right;
      body.style.width = previous.width;
      body.style.height = previous.height;
      body.style.overflow = previous.overflow;
      window.scrollTo(0, scrollY);
    };
  }, []);
}
