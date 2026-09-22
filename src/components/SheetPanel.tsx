import type { CSSProperties, ReactNode } from 'react';

/**
 * The panel inside a sheet that has a field in it.
 *
 * Every one of these used to be a single scrollable box: header, fields and
 * buttons together in one `overflow-y-auto`. That is fine until the keyboard
 * opens. The browser's response to a focused field is to scroll the nearest
 * thing it can to bring that field into view, and on a sheet sized to the
 * visual viewport the nearest thing it can scroll is the sheet itself — so it
 * scrolled, and the title went off the top of the screen while the page
 * underneath stayed exactly where it was. That is the "it's pushing the page
 * up" that was reported from three different screens.
 *
 * So the header is kept out of the scrolling part. Whatever doesn't fit
 * beside the keyboard moves; the title and the way out don't.
 *
 * `inset` is the padding either side of both halves — 'none' for a sheet whose
 * contents bring their own, which is also the case where the header is
 * expected to draw its own full-width divider.
 */
export function SheetPanel({
  className = '',
  inset = 6,
  header,
  children,
  style,
}: {
  /** The box itself: width, rounding, background, shadow, any animation. */
  className?: string;
  inset?: 6 | 5 | 'none';
  /** Stays put. Leave it out for a sheet with nothing to pin. */
  header?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const padX = inset === 'none' ? '' : inset === 5 ? 'px-5' : 'px-6';
  const padTop = inset === 'none' ? '' : inset === 5 ? 'pt-5' : 'pt-6';
  const padBottom = inset === 5 ? '1.25rem' : inset === 'none' ? '0px' : '1.5rem';
  return (
    <div
      className={`flex max-h-full flex-col ${className}`}
      style={style}
      onClick={(e) => e.stopPropagation()}
    >
      {header != null && <div className={`shrink-0 ${padX} ${padTop}`}>{header}</div>}
      <div
        className={`min-h-0 flex-1 overflow-y-auto overscroll-contain ${padX} ${
          header == null ? padTop : ''
        }`}
        style={{ paddingBottom: `calc(env(safe-area-inset-bottom, 0px) + ${padBottom})` }}
      >
        {children}
      </div>
    </div>
  );
}
