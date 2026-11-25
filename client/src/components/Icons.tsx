// Kith's own nav icons: soft, rounded line icons in the app's style. They use currentColor, so
// they follow the text colour (lilac when active). The active one gets a gentle filled accent.

import type { ReactNode } from "react";

export type IconName = "chat" | "study" | "create" | "settings" | "grownup" | "call" | "stories" | "art" | "oc" | "desk";

const P: Record<IconName, (on: boolean) => ReactNode> = {
  // a speech bubble with three dots
  chat: (on) => (
    <>
      <path d="M5 6.5C5 5.1 6.1 4 7.5 4h9C17.9 4 19 5.1 19 6.5v7c0 1.4-1.1 2.5-2.5 2.5H11l-4 3.5V16h0.5H7.5C6.1 16 5 14.9 5 13.5v-7Z" fill={on ? "currentColor" : "none"} fillOpacity={on ? 0.18 : 0} />
      <circle cx="9" cy="10" r="0.9" fill="currentColor" stroke="none" /><circle cx="12" cy="10" r="0.9" fill="currentColor" stroke="none" /><circle cx="15" cy="10" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  // an open book with a bookmark
  study: (on) => (
    <>
      <path d="M12 6.5C10 5 7.5 4.6 4.5 5v12.5c3-.4 5.5 0 7.5 1.5 2-1.5 4.5-1.9 7.5-1.5V5c-3-.4-5.5 0-7.5 1.5Z" fill={on ? "currentColor" : "none"} fillOpacity={on ? 0.18 : 0} />
      <path d="M12 6.5V19" /><path d="M15.5 5.2v4.3l1.3-1 1.3 1V5.1" />
    </>
  ),
  // a sparkle with a little one
  create: (on) => (
    <>
      <path d="M11 4l1.7 4.3L17 10l-4.3 1.7L11 16l-1.7-4.3L5 10l4.3-1.7L11 4Z" fill={on ? "currentColor" : "none"} fillOpacity={on ? 0.2 : 0} />
      <path d="M17.5 14.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z" />
    </>
  ),
  // a soft gear
  settings: (on) => (
    <>
      <circle cx="12" cy="12" r="3" fill={on ? "currentColor" : "none"} fillOpacity={on ? 0.25 : 0} />
      <path d="M12 3.5l1.4 2.2 2.5-.7.5 2.6 2.6.5-.7 2.5 2.2 1.4-2.2 1.4.7 2.5-2.6.5-.5 2.6-2.5-.7L12 20.5l-1.4-2.2-2.5.7-.5-2.6-2.6-.5.7-2.5L3.5 12l2.2-1.4-.7-2.5 2.6-.5.5-2.6 2.5.7L12 3.5Z" />
    </>
  ),
  // two hands holding a heart
  grownup: () => (
    <>
      <path d="M12 9.2c-.9-1.9-4-1.6-4 .8 0 1.7 2 3 4 4.6 2-1.6 4-2.9 4-4.6 0-2.4-3.1-2.7-4-.8Z" fill="currentColor" fillOpacity={0.3} />
      <path d="M3.5 13.5l3.5 3.5c.8.8 1.8 1.2 2.9 1.2H14" /><path d="M20.5 13.5L17 17c-.8.8-1.8 1.2-2.9 1.2" />
    </>
  ),
  // a phone handset
  call: (on) => (
    <path d="M7.5 4.5l2.2 3.2c.4.6.3 1.3-.2 1.8l-1.1 1.1c.9 1.9 2.4 3.4 4.3 4.3l1.1-1.1c.5-.5 1.2-.6 1.8-.2l3.2 2.2c.6.4.8 1.2.4 1.8l-1 1.5c-.7 1-2 1.5-3.2 1.1C9.9 18.6 5.4 14.1 3.8 9c-.4-1.2.1-2.5 1.1-3.2l1.5-1c.6-.4 1.4-.2 1.8.4Z" fill={on ? "currentColor" : "none"} fillOpacity={on ? 0.25 : 0} />
  ),
  // a quill
  stories: (on) => (
    <>
      <path d="M19 4c-6 1-10.5 5.5-12 12l1 1c6.5-1.5 11-6 12-12l-1-1Z" fill={on ? "currentColor" : "none"} fillOpacity={on ? 0.18 : 0} />
      <path d="M7 16l-2.5 4" /><path d="M10.5 13.5l3-3" />
    </>
  ),
  // a palette
  art: (on) => (
    <>
      <path d="M12 4C7.3 4 4 7.3 4 11.5S7.3 20 11 20c1.4 0 1.8-1 1.3-2-.6-1.2.2-2.5 1.6-2.5H16c2.3 0 4-1.6 4-4C20 7.3 16.4 4 12 4Z" fill={on ? "currentColor" : "none"} fillOpacity={on ? 0.18 : 0} />
      <circle cx="8.5" cy="10.5" r="1" fill="currentColor" stroke="none" /><circle cx="11.5" cy="7.8" r="1" fill="currentColor" stroke="none" /><circle cx="15.3" cy="9" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  // a star with a smile (original characters)
  oc: (on) => (
    <>
      <path d="M12 3.8l2.4 5 5.4.6-4 3.7 1.1 5.4L12 15.8l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6L12 3.8Z" fill={on ? "currentColor" : "none"} fillOpacity={on ? 0.2 : 0} />
      <path d="M10.4 12.2c.9.8 2.3.8 3.2 0" />
    </>
  ),
  // a little computer
  desk: (on) => (
    <>
      <rect x="4" y="5" width="16" height="11" rx="2" fill={on ? "currentColor" : "none"} fillOpacity={on ? 0.18 : 0} />
      <path d="M9 19.5h6" /><path d="M12 16v3.5" />
    </>
  ),
};

export function Icon({ name, on = false, size = 24 }: { name: IconName; on?: boolean; size?: number }) {
  return (
    <svg className="navicon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {P[name](on)}
    </svg>
  );
}
