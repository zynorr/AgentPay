/**
 * Inline SVG icon set. Stroke-based, 24x24 viewBox, 1.5px stroke,
 * currentColor fill so icons inherit their text color.
 */
function base(path, extra = {}) {
  return (
    <svg
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...extra}
    >
      {path}
    </svg>
  );
}

export const Bolt = (p) =>
  base(<path d="M13 2 4.5 13.5H11L9.5 22 19 10.5h-6.5L13 2z" />, p);

export const Wallet = (p) =>
  base(
    <>
      <path d="M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v1" />
      <path d="M3 7v11a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2z" />
      <path d="M16.5 14.5h.01" />
    </>,
    p,
  );

export const Send = (p) =>
  base(
    <>
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4 20-7z" />
    </>,
    p,
  );

export const Lock = (p) =>
  base(
    <>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>,
    p,
  );

export const Layers = (p) =>
  base(
    <>
      <path d="m12 2 9 5-9 5-9-5 9-5z" />
      <path d="m3 12 9 5 9-5" />
      <path d="m3 17 9 5 9-5" />
    </>,
    p,
  );

export const Check = (p) => base(<path d="m4 12.5 5 5L20 6.5" />, p);

export const X = (p) => base(<path d="M6 6l12 12M18 6 6 18" />, p);

export const CheckCircle = (p) =>
  base(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.5 2.5 2.5 4.5-5.5" />
    </>,
    p,
  );

export const AlertTriangle = (p) =>
  base(
    <>
      <path d="M12 3 2.5 20h19L12 3z" />
      <path d="M12 10v4" />
      <path d="M12 17.5h.01" />
    </>,
    p,
  );

export const Cpu = (p) =>
  base(
    <>
      <rect x="5" y="5" width="14" height="14" rx="2" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
      <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
    </>,
    p,
  );

export const Activity = (p) =>
  base(<path d="M3 12h4l3 8 4-16 3 8h4" />, p);

export const Clock = (p) =>
  base(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </>,
    p,
  );

export const Refresh = (p) =>
  base(
    <>
      <path d="M21 12a9 9 0 1 1-2.6-6.3" />
      <path d="M21 3v6h-6" />
    </>,
    p,
  );

export const Copy = (p) =>
  base(
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </>,
    p,
  );

export const ArrowUpRight = (p) =>
  base(<path d="M7 17 17 7M8 7h9v9" />, p);

export const Sparkle = (p) =>
  base(
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />,
    p,
  );

export const Shield = (p) =>
  base(
    <>
      <path d="M12 2 4 5.5V11c0 5 3.4 8.5 8 10.5 4.6-2 8-5.5 8-10.5V5.5L12 2z" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </>,
    p,
  );

