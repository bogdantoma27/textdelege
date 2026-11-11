type IconProps = { size?: number };

const stroke = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "2",
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
  "aria-hidden": "true",
  focusable: "false",
} as const;

export function Logo({ size = 36, onMast = false }: IconProps & { onMast?: boolean }) {
  const page = onMast ? "#ffffff" : "#0b2a6b";
  const line = onMast ? "#0b2a6b" : "#ffffff";
  return (
    <svg width={size} height={size} viewBox="0 0 44 44" aria-hidden="true" focusable="false">
      <rect x="6" y="5" width="32" height="34" rx="2" fill={page} />
      <rect x="12" y="13" width="20" height="3" fill={line} />
      <rect x="12" y="19" width="20" height="3" fill={line} />
      <rect x="12" y="25" width="13" height="3" fill={line} />
      <rect x="6" y="32" width="32" height="3" fill={line} opacity=".3" />
      <circle cx="27" cy="33.5" r="4.5" fill="#f2c230" />
    </svg>
  );
}

export function SearchIcon({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} {...stroke}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function ArrowUpIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} {...stroke}>
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}

export function ArrowDownIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} {...stroke}>
      <path d="M12 5v14M19 12l-7 7-7-7" />
    </svg>
  );
}

export function ChevronRightIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} {...stroke}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

export function ChevronLeftIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} {...stroke}>
      <path d="m15 6-6 6 6 6" />
    </svg>
  );
}

export function CalendarIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} {...stroke}>
      <path d="M4 6h16v14H4zM4 10h16M8 3v5M16 3v5" />
    </svg>
  );
}

export function CupIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} {...stroke}>
      <path d="M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM17 9h1.5a2.5 2.5 0 0 1 0 5H17" />
      <path d="M10.5 15.5c-1.7-1.2-2.8-2.2-2.8-3.4a1.4 1.4 0 0 1 2.8-.4 1.4 1.4 0 0 1 2.8.4c0 1.2-1.1 2.2-2.8 3.4z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ExternalIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} {...stroke}>
      <path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" />
    </svg>
  );
}

export function CopyIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} {...stroke}>
      <path d="M9 9h11v11H9zM5 15H4V4h11v1" />
    </svg>
  );
}
