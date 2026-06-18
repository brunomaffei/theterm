import React from 'react';

/**
 * Claude "spark" mark — a radiating sunburst. Inherits `currentColor`, so the
 * caller tints it (lime when online, gray when offline).
 */
export default function ClaudeMascot({ size = 15 }: { size?: number }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="10.4" y1="8" x2="14.3" y2="8" />
      <line x1="10.1" y1="9.2" x2="12.3" y2="10.5" />
      <line x1="9.2" y1="10.1" x2="11.2" y2="13.5" />
      <line x1="8" y1="10.4" x2="8" y2="13" />
      <line x1="6.8" y1="10.1" x2="4.9" y2="13.5" />
      <line x1="5.9" y1="9.2" x2="3.7" y2="10.5" />
      <line x1="5.6" y1="8" x2="1.7" y2="8" />
      <line x1="5.9" y1="6.8" x2="3.7" y2="5.5" />
      <line x1="6.8" y1="5.9" x2="4.9" y2="2.5" />
      <line x1="8" y1="5.6" x2="8" y2="3" />
      <line x1="9.2" y1="5.9" x2="11.2" y2="2.5" />
      <line x1="10.1" y1="6.8" x2="12.3" y2="5.5" />
    </svg>
  );
}
