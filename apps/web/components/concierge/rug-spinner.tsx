export function RugSpinner({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      style={{ animation: "rugspin 3.5s linear infinite", flexShrink: 0 }}
      aria-hidden="true"
    >
      {/* Top fringes — 6 organic strands with varied lengths and slight lean */}
      <line x1="11.0" y1="6.2" x2="10.5" y2="2.0" stroke="#D4C5A9" strokeWidth="1.0" strokeLinecap="round" />
      <line x1="13.8" y1="6.2" x2="14.2" y2="1.5" stroke="#D4C5A9" strokeWidth="0.85" strokeLinecap="round" />
      <line x1="16.8" y1="6.2" x2="16.5" y2="2.8" stroke="#D4C5A9" strokeWidth="1.1" strokeLinecap="round" />
      <line x1="20.0" y1="6.2" x2="20.1" y2="1.8" stroke="#D4C5A9" strokeWidth="0.9" strokeLinecap="round" />
      <line x1="23.2" y1="6.2" x2="23.6" y2="2.4" stroke="#D4C5A9" strokeWidth="1.05" strokeLinecap="round" />
      <line x1="26.2" y1="6.2" x2="25.8" y2="1.5" stroke="#D4C5A9" strokeWidth="0.9" strokeLinecap="round" />
      <line x1="29.0" y1="6.2" x2="29.4" y2="2.2" stroke="#D4C5A9" strokeWidth="0.85" strokeLinecap="round" />

      {/* Rug body */}
      <rect x="8" y="6" width="24" height="28" rx="1.5" fill="#F5EFE0" stroke="#C4613A" strokeWidth="1.5" />

      {/* Inner border frame */}
      <rect x="11.5" y="9.5" width="17" height="21" rx="0.8" fill="none" stroke="#C4613A" strokeWidth="0.7" />

      {/* Corner ornament dots */}
      <circle cx="13" cy="11" r="1.0" fill="#C4613A" />
      <circle cx="27" cy="11" r="1.0" fill="#C4613A" />
      <circle cx="13" cy="29" r="1.0" fill="#C4613A" />
      <circle cx="27" cy="29" r="1.0" fill="#C4613A" />

      {/* Center diamond motif */}
      <polygon points="20,15.5 23.5,20 20,24.5 16.5,20" fill="none" stroke="#C4613A" strokeWidth="0.7" />
      <circle cx="20" cy="20" r="1.3" fill="#C4613A" />

      {/* Bottom fringes — mirror with slightly different lengths */}
      <line x1="11.0" y1="33.8" x2="10.6" y2="38.0" stroke="#D4C5A9" strokeWidth="1.0" strokeLinecap="round" />
      <line x1="13.8" y1="33.8" x2="13.5" y2="38.2" stroke="#D4C5A9" strokeWidth="0.85" strokeLinecap="round" />
      <line x1="16.8" y1="33.8" x2="17.2" y2="37.5" stroke="#D4C5A9" strokeWidth="1.1" strokeLinecap="round" />
      <line x1="20.0" y1="33.8" x2="19.9" y2="38.3" stroke="#D4C5A9" strokeWidth="0.9" strokeLinecap="round" />
      <line x1="23.2" y1="33.8" x2="22.8" y2="37.8" stroke="#D4C5A9" strokeWidth="1.05" strokeLinecap="round" />
      <line x1="26.2" y1="33.8" x2="26.6" y2="38.2" stroke="#D4C5A9" strokeWidth="0.9" strokeLinecap="round" />
      <line x1="29.0" y1="33.8" x2="28.7" y2="37.5" stroke="#D4C5A9" strokeWidth="0.85" strokeLinecap="round" />
    </svg>
  );
}
