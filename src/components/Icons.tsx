/**
 * Glyphs more than one screen draws. The close cross had five copies, each a
 * pixel or a stroke-weight apart; one drawing here, sized by the caller.
 */
export function CloseIcon({
  size = 20,
  strokeWidth = 1.9,
}: {
  size?: number;
  strokeWidth?: number;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M5 5l10 10M15 5L5 15"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </svg>
  );
}
