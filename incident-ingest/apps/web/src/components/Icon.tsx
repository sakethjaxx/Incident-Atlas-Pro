import type { SVGProps } from "react";

export type IconName =
  | "dashboard"
  | "search"
  | "incidents"
  | "graph"
  | "qa"
  | "eval"
  | "upload"
  | "menu"
  | "close"
  | "arrowRight"
  | "arrowUp"
  | "database"
  | "fileText"
  | "building"
  | "stack"
  | "inbox"
  | "alert"
  | "checkCircle"
  | "spark"
  | "clock"
  | "wrench"
  | "pulse"
  | "refresh";

type IconProps = SVGProps<SVGSVGElement> & {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  title?: string;
};

function IconPath({ name }: { name: IconName }) {
  switch (name) {
    case "dashboard":
      return (
        <>
          <path d="M4 5h7v7H4z" />
          <path d="M13 5h7v5h-7z" />
          <path d="M13 12h7v7h-7z" />
          <path d="M4 14h7v5H4z" />
        </>
      );
    case "search":
      return (
        <>
          <circle cx="11" cy="11" r="6" />
          <path d="m20 20-3.5-3.5" />
        </>
      );
    case "incidents":
      return (
        <>
          <path d="M8 6h12" />
          <path d="M8 12h12" />
          <path d="M8 18h12" />
          <path d="M4 6h.01" />
          <path d="M4 12h.01" />
          <path d="M4 18h.01" />
        </>
      );
    case "graph":
      return (
        <>
          <circle cx="6" cy="12" r="2" />
          <circle cx="18" cy="6" r="2" />
          <circle cx="18" cy="18" r="2" />
          <path d="m8 11 8-4" />
          <path d="m8 13 8 4" />
        </>
      );
    case "qa":
      return (
        <>
          <path d="M9.2 9.2a3 3 0 1 1 4.9 2.4c-.7.6-1.4 1.1-1.8 1.8-.2.3-.3.7-.3 1.1" />
          <path d="M12 18h.01" />
          <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7A2.5 2.5 0 0 1 17.5 16H10l-4 4v-4H6.5A2.5 2.5 0 0 1 4 13.5z" />
        </>
      );
    case "eval":
      return (
        <>
          <path d="M5 19V9" />
          <path d="M12 19V5" />
          <path d="M19 19v-8" />
          <path d="M3 19h18" />
        </>
      );
    case "upload":
      return (
        <>
          <path d="M12 16V5" />
          <path d="m7 10 5-5 5 5" />
          <path d="M5 19h14" />
          <path d="M5 19a2 2 0 0 1-2-2v-2" />
          <path d="M19 19a2 2 0 0 0 2-2v-2" />
        </>
      );
    case "menu":
      return (
        <>
          <path d="M4 7h16" />
          <path d="M4 12h16" />
          <path d="M4 17h16" />
        </>
      );
    case "close":
      return (
        <>
          <path d="m6 6 12 12" />
          <path d="M18 6 6 18" />
        </>
      );
    case "arrowRight":
      return (
        <>
          <path d="M5 12h14" />
          <path d="m13 6 6 6-6 6" />
        </>
      );
    case "arrowUp":
      return (
        <>
          <path d="M12 19V5" />
          <path d="m6 11 6-6 6 6" />
        </>
      );
    case "database":
      return (
        <>
          <ellipse cx="12" cy="5" rx="7" ry="3" />
          <path d="M5 5v7c0 1.7 3.1 3 7 3s7-1.3 7-3V5" />
          <path d="M5 12v7c0 1.7 3.1 3 7 3s7-1.3 7-3v-7" />
        </>
      );
    case "fileText":
      return (
        <>
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5" />
          <path d="M9 13h6" />
          <path d="M9 17h6" />
        </>
      );
    case "building":
      return (
        <>
          <path d="M4 20h16" />
          <path d="M6 20V5l6-2 6 2v15" />
          <path d="M9 8h.01" />
          <path d="M12 8h.01" />
          <path d="M15 8h.01" />
          <path d="M9 12h.01" />
          <path d="M12 12h.01" />
          <path d="M15 12h.01" />
          <path d="M11 20v-4h2v4" />
        </>
      );
    case "stack":
      return (
        <>
          <path d="m12 4 8 4-8 4-8-4 8-4Z" />
          <path d="m4 12 8 4 8-4" />
          <path d="m4 16 8 4 8-4" />
        </>
      );
    case "inbox":
      return (
        <>
          <path d="M4 13.5 6.5 6A2 2 0 0 1 8.4 4.6h7.2A2 2 0 0 1 17.5 6l2.5 7.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
          <path d="M4 14h4l2 3h4l2-3h4" />
        </>
      );
    case "alert":
      return (
        <>
          <path d="m12 4 8 15H4z" />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        </>
      );
    case "checkCircle":
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="m8.5 12 2.5 2.5 4.5-5" />
        </>
      );
    case "spark":
      return (
        <>
          <path d="M12 3v5" />
          <path d="M12 16v5" />
          <path d="M4.5 7.5 8 9" />
          <path d="m16 15 3.5 1.5" />
          <path d="m19.5 7.5-3.5 1.5" />
          <path d="M8 15 4.5 16.5" />
          <path d="m12 7 2 3 3 2-3 2-2 3-2-3-3-2 3-2z" />
        </>
      );
    case "clock":
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </>
      );
    case "wrench":
      return (
        <>
          <path d="m14.5 6.5 3 3" />
          <path d="M11.5 9.5 5 16a2.1 2.1 0 0 0 3 3l6.5-6.5" />
          <path d="M15 4a3 3 0 0 0-2 5l2 2a3 3 0 1 0 5-2l-2-2A3 3 0 0 0 15 4Z" />
        </>
      );
    case "pulse":
      return (
        <>
          <path d="M3 12h4l2.5-5 4 10 2.5-5H21" />
        </>
      );
    case "refresh":
      return (
        <>
          <path d="M20 11a8 8 0 1 0 2 5.5" />
          <path d="M20 4v7h-7" />
        </>
      );
    default:
      return null;
  }
}

export default function Icon({
  name,
  size = 18,
  strokeWidth = 1.8,
  title,
  ...props
}: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      <IconPath name={name} />
    </svg>
  );
}
