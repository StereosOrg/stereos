/** Stereos logo (S mark) - crisp vector S for 24×24 and up. */
export function StereosLogo({
  size = 24,
  color = 'currentColor',
  className,
}: {
  size?: number;
  color?: string;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      style={{ color, flexShrink: 0 }}
      shapeRendering="geometricPrecision"
      aria-hidden
    >
      {/* Single S path: top-right → center-left → bottom-right; thick stroke stays sharp */}
      <path
        stroke={color}
        strokeWidth={3.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        d="M17 6.5C10 6.5 6 9 6 12c0 3 4 5.5 11 5.5"
      />
    </svg>
  );
}
