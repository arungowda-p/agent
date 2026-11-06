// Inline SVG icon set (16px grid, 1.5 stroke). No external icon libraries.

import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Base({ size = 14, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconShield = (p: IconProps) => (
  <Base {...p}>
    <path d="M8 1.75 2.75 3.5v4.25c0 3.1 2.2 5.4 5.25 6.5 3.05-1.1 5.25-3.4 5.25-6.5V3.5L8 1.75Z" />
    <path d="m5.75 8 1.5 1.5 3-3" />
  </Base>
);

export const IconChat = (p: IconProps) => (
  <Base {...p}>
    <path d="M2.75 3.75h10.5v7h-6l-3 2.5v-2.5h-1.5v-7Z" />
  </Base>
);

export const IconBook = (p: IconProps) => (
  <Base {...p}>
    <path d="M2.75 2.75h4a1.25 1.25 0 0 1 1.25 1.25v9.25a1 1 0 0 0-1-1h-4.25V2.75Z" />
    <path d="M13.25 2.75h-4A1.25 1.25 0 0 0 8 4v9.25a1 1 0 0 1 1-1h4.25V2.75Z" />
  </Base>
);

export const IconUpload = (p: IconProps) => (
  <Base {...p}>
    <path d="M8 10.25V2.75M5 5.5l3-2.75 3 2.75" />
    <path d="M2.75 10.5v2.75h10.5V10.5" />
  </Base>
);

export const IconFile = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 1.75h5l3 3v9.5H4V1.75Z" />
    <path d="M9 1.75v3h3" />
  </Base>
);

export const IconCheck = (p: IconProps) => (
  <Base {...p}>
    <path d="m3.25 8.5 3 3 6.5-7" />
  </Base>
);

export const IconX = (p: IconProps) => (
  <Base {...p}>
    <path d="m4 4 8 8M12 4l-8 8" />
  </Base>
);

export const IconAlert = (p: IconProps) => (
  <Base {...p}>
    <path d="M8 2 1.75 13.25h12.5L8 2Z" />
    <path d="M8 6.5v3M8 11.5v.25" />
  </Base>
);

export const IconRefresh = (p: IconProps) => (
  <Base {...p}>
    <path d="M13.25 8a5.25 5.25 0 1 1-1.54-3.71" />
    <path d="M13.25 2.75v2.5h-2.5" />
  </Base>
);

export const IconSparkle = (p: IconProps) => (
  <Base {...p}>
    <path d="M8 2v3M8 11v3M2 8h3M11 8h3M4.1 4.1l1.4 1.4M10.5 10.5l1.4 1.4M4.1 11.9l1.4-1.4M10.5 5.5l1.4-1.4" />
  </Base>
);

export const IconLink = (p: IconProps) => (
  <Base {...p}>
    <path d="M6.75 9.25a2.5 2.5 0 0 0 3.54 0l2-2a2.5 2.5 0 0 0-3.54-3.54l-.75.75" />
    <path d="M9.25 6.75a2.5 2.5 0 0 0-3.54 0l-2 2a2.5 2.5 0 0 0 3.54 3.54l.75-.75" />
  </Base>
);

export const IconSlack = (p: IconProps) => (
  <Base {...p}>
    <path d="M6 2.75v4.5M10 8.75v4.5M2.75 10h4.5M8.75 6h4.5" />
  </Base>
);

export const IconPalette = (p: IconProps) => (
  <Base {...p}>
    <path d="M8 2.25a5.75 5.75 0 1 0 0 11.5c.9 0 1.25-.6 1.25-1.15 0-.75-.6-1-.6-1.75 0-.6.5-1.1 1.1-1.1h1.5a2.5 2.5 0 0 0 2.5-2.5c0-2.75-2.6-5-5.75-5Z" />
    <circle cx="5" cy="7" r=".6" fill="currentColor" />
    <circle cx="7.5" cy="4.75" r=".6" fill="currentColor" />
    <circle cx="10.5" cy="5.5" r=".6" fill="currentColor" />
  </Base>
);

export const IconTag = (p: IconProps) => (
  <Base {...p}>
    <path d="M2.25 2.25h5.5l6 6-5.5 5.5-6-6v-5.5Z" />
    <circle cx="5.25" cy="5.25" r=".75" fill="currentColor" />
  </Base>
);

export const IconSend = (p: IconProps) => (
  <Base {...p}>
    <path d="M14 2 7.25 8.75M14 2l-4.25 12-2.5-5.25L2 6.25 14 2Z" />
  </Base>
);

export const IconPlus = (p: IconProps) => (
  <Base {...p}>
    <path d="M8 3v10M3 8h10" />
  </Base>
);

export const IconTrash = (p: IconProps) => (
  <Base {...p}>
    <path d="M2.75 4.25h10.5M6.25 4.25V2.75h3.5v1.5M4 4.25l.75 9h6.5l.75-9" />
  </Base>
);

export const IconChevronRight = (p: IconProps) => (
  <Base {...p}>
    <path d="m6 3.5 4.5 4.5L6 12.5" />
  </Base>
);

export const IconChevronDown = (p: IconProps) => (
  <Base {...p}>
    <path d="m3.5 6 4.5 4.5L12.5 6" />
  </Base>
);

export const IconDownload = (p: IconProps) => (
  <Base {...p}>
    <path d="M8 2.75v7.5M5 7.5l3 2.75 3-2.75" />
    <path d="M2.75 10.5v2.75h10.5V10.5" />
  </Base>
);

export const IconMonitor = (p: IconProps) => (
  <Base {...p}>
    <rect x="1.75" y="2.75" width="12.5" height="8.5" rx="1" />
    <path d="M5.5 13.75h5M8 11.25v2.5" />
  </Base>
);

export const IconPhone = (p: IconProps) => (
  <Base {...p}>
    <rect x="4.25" y="1.75" width="7.5" height="12.5" rx="1.25" />
    <path d="M7.25 12h1.5" />
  </Base>
);

export const IconUser = (p: IconProps) => (
  <Base {...p}>
    <circle cx="8" cy="5.5" r="2.75" />
    <path d="M2.75 14c.6-2.5 2.75-4 5.25-4s4.65 1.5 5.25 4" />
  </Base>
);

export const IconFlip = (p: IconProps) => (
  <Base {...p}>
    <path d="M2.75 6.5h9.5l-2.5-2.5M13.25 9.5h-9.5l2.5 2.5" />
  </Base>
);

export const IconTarget = (p: IconProps) => (
  <Base {...p}>
    <circle cx="8" cy="8" r="5.75" />
    <circle cx="8" cy="8" r="3" />
    <circle cx="8" cy="8" r=".75" fill="currentColor" />
  </Base>
);

export const IconGrid = (p: IconProps) => (
  <Base {...p}>
    <rect x="2.25" y="2.25" width="4.5" height="4.5" rx=".5" />
    <rect x="9.25" y="2.25" width="4.5" height="4.5" rx=".5" />
    <rect x="2.25" y="9.25" width="4.5" height="4.5" rx=".5" />
    <rect x="9.25" y="9.25" width="4.5" height="4.5" rx=".5" />
  </Base>
);

export const IconDot = ({ className, ...p }: IconProps) => (
  <svg width={p.size ?? 8} height={p.size ?? 8} viewBox="0 0 8 8" aria-hidden="true" className={className}>
    <circle cx="4" cy="4" r="3" fill="currentColor" />
  </svg>
);

export const IconLogo = (p: IconProps) => (
  <Base {...p} strokeWidth={1.75}>
    <path d="M3.5 12.5 8 3.5l4.5 9" />
    <path d="M5.5 9h5" />
  </Base>
);
