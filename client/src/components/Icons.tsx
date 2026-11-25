// Kith's own nav icons: soft, rounded line icons in the app's style. They use currentColor, so
// they follow the text colour (lilac when active). The active one gets a gentle filled accent.

import type { ReactNode } from "react";

export type IconName = "chat" | "study" | "create" | "settings" | "grownup" | "call" | "stories" | "art" | "oc" | "desk"
  | "mic" | "send" | "keyboard" | "endcall" | "stop" | "sidechats" | "newchat" | "split" | "close" | "archive"
  | "fire" | "battery" | "moon" | "check" | "warn" | "clock" | "hourglass" | "alarm" | "lock" | "camera" | "pin" | "scroll"
  | "shield" | "bulb" | "question" | "brush" | "landmark" | "map" | "mask" | "trash" | "plus" | "arrow" | "back" | "play"
  | "speaker" | "joystick" | "eye" | "cards" | "timer" | "note" | "siren" | "phone" | "bell" | "brain" | "cloud" | "idcard"
  | "calendar" | "heart" | "pencil" | "compass" | "folder" | "journal" | "cap" | "gamepad" | "people" | "sparkle" | "laptop"
  | "music" | "breath" | "chat2" | "star" | "home" | "expand" | "shrink" | "globe" | "micoff";

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
  // a microphone
  mic: (on) => (
    <>
      <rect x="9" y="3.5" width="6" height="11" rx="3" fill={on ? "currentColor" : "none"} fillOpacity={on ? 0.25 : 0} />
      <path d="M6 11.5a6 6 0 0 0 12 0" /><path d="M12 17.5v3" /><path d="M9 20.5h6" />
    </>
  ),
  // the mic, crossed out: muted
  micoff: () => (
    <>
      <path d="M15 9.5V6.5a3 3 0 0 0-5.6-1.5M9 9v2.5a3 3 0 0 0 4.6 2.5" />
      <path d="M6 11.5a6 6 0 0 0 9.6 4.8M18 11.5c0 .7-.1 1.4-.3 2" /><path d="M12 17.5v3" /><path d="M9 20.5h6" /><path d="M4.5 4.5l15 15" />
    </>
  ),
  // a paper plane heading up
  send: () => (
    <>
      <path d="M12 19V6" /><path d="M6.5 11.5L12 6l5.5 5.5" />
    </>
  ),
  // a keyboard
  keyboard: () => (
    <>
      <rect x="3.5" y="6.5" width="17" height="11" rx="2.5" />
      <path d="M7 10h.01M10 10h.01M13 10h.01M16 10h.01M7 13h.01M17 13h.01" strokeWidth="2.2" />
      <path d="M9.5 14h5" />
    </>
  ),
  // hang up: a handset turned down
  endcall: () => (
    <path d="M3.6 13.6c4.6-4 12.2-4 16.8 0 .6.5.7 1.4.2 2l-1.3 1.6c-.5.6-1.3.7-1.9.3l-2.5-1.6c-.5-.3-.7-.9-.6-1.5l.3-1.3c-1.7-.5-3.5-.5-5.2 0l.3 1.3c.1.6-.1 1.2-.6 1.5l-2.5 1.6c-.6.4-1.4.3-1.9-.3l-1.3-1.6c-.5-.6-.4-1.5.2-2Z" fill="currentColor" fillOpacity={0.25} />
  ),
  // stop (end listening)
  stop: () => <rect x="7" y="7" width="10" height="10" rx="2.5" fill="currentColor" />,
  // two overlapping speech bubbles: side chats
  sidechats: (on) => (
    <>
      <path d="M3.5 6.5c0-1.4 1.1-2.5 2.5-2.5h7c1.4 0 2.5 1.1 2.5 2.5v4.5c0 1.4-1.1 2.5-2.5 2.5H8.5l-3 2.5v-2.6c-1.2-.2-2-1.2-2-2.4V6.5Z" fill={on ? "currentColor" : "none"} fillOpacity={on ? 0.2 : 0} />
      <path d="M17.5 9h.5c1.4 0 2.5 1.1 2.5 2.5V16c0 1.2-.8 2.2-2 2.4V21l-3-2.5H12c-1.1 0-2.1-.7-2.4-1.7" />
    </>
  ),
  // a bubble with a plus
  newchat: () => (
    <>
      <path d="M5 6.5C5 5.1 6.1 4 7.5 4h9C17.9 4 19 5.1 19 6.5v7c0 1.4-1.1 2.5-2.5 2.5H11l-4 3.5V16h.5H7.5C6.1 16 5 14.9 5 13.5v-7Z" />
      <path d="M12 7.5v5M9.5 10h5" />
    </>
  ),
  // a branch: split off into a side chat
  split: () => (
    <>
      <circle cx="7" cy="5.5" r="2" /><circle cx="7" cy="18.5" r="2" /><circle cx="17" cy="9" r="2" />
      <path d="M7 7.5v9" /><path d="M17 11c0 3-3 4-7.5 5.5" />
    </>
  ),
  close: () => <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  archive: () => (
    <>
      <rect x="4" y="5" width="16" height="4" rx="1.2" /><path d="M5.5 9v8.5c0 .8.7 1.5 1.5 1.5h10c.8 0 1.5-.7 1.5-1.5V9" /><path d="M10 13h4" />
    </>
  ),
  fire: () => <path d="M12 21c-3.6 0-6-2.4-6-5.6 0-3.1 2.2-4.8 3.3-7.4.4 1.6 1.3 2.6 2.3 3 .2-2.8 1.3-5.4 3.6-7 0 3 3 5.2 3 9.1 0 4.3-2.6 7.9-6.2 7.9Z M12 21c-1.4 0-2.5-1-2.5-2.5 0-1.6 1.4-2.4 2.5-4 1.1 1.6 2.5 2.4 2.5 4 0 1.5-1.1 2.5-2.5 2.5Z" />,
  battery: () => <><rect x="3.5" y="7.5" width="15" height="9" rx="2" /><path d="M20.5 10.5v3" /><path d="M6.5 10.5v3" strokeWidth="2.4" /></>,
  moon: () => <path d="M18.5 15A7.5 7.5 0 0 1 9 5.5a7.5 7.5 0 1 0 9.5 9.5Z" />,
  check: () => <path d="M5 12.5l4.5 4.5L19 7.5" />,
  warn: () => <><path d="M12 4l9 15.5H3L12 4Z" /><path d="M12 10v4M12 16.8h.01" /></>,
  clock: () => <><circle cx="12" cy="12" r="8" /><path d="M12 7.5V12l3 2" /></>,
  hourglass: () => <><path d="M7 4h10M7 20h10" /><path d="M8 4c0 4 8 4 8 8s-8 4-8 8M16 4c0 4-8 4-8 8s8 4 8 8" /></>,
  alarm: () => <><circle cx="12" cy="13" r="7" /><path d="M12 9.5V13l2.5 1.5M5 4.5L3 6.5M19 4.5l2 2" /></>,
  lock: () => <><rect x="5.5" y="10.5" width="13" height="9" rx="2" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></>,
  camera: () => <><path d="M4 8.5c0-.8.7-1.5 1.5-1.5H8l1.5-2h5L16 7h2.5c.8 0 1.5.7 1.5 1.5v9c0 .8-.7 1.5-1.5 1.5h-13C4.7 19 4 18.3 4 17.5v-9Z" /><circle cx="12" cy="13" r="3.2" /></>,
  pin: () => <><path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11Z" /><circle cx="12" cy="10" r="2.3" /></>,
  scroll: () => <><path d="M7 4h10.5A1.5 1.5 0 0 1 19 5.5V7h-3" /><path d="M16 7v11.5a2 2 0 0 1-2 2H6.5A2.5 2.5 0 0 1 4 18v-.5h9.5V5.5A1.5 1.5 0 0 0 12 4" /><path d="M8 9h4.5M8 12.5h4.5" /></>,
  shield: () => <path d="M12 3.5l7 2.8v5.2c0 4.3-2.9 7.6-7 9-4.1-1.4-7-4.7-7-9V6.3l7-2.8Z" />,
  bulb: () => <><path d="M9 17.5h6M10 20.5h4" /><path d="M8.5 14.5C7 13.3 6 11.6 6 9.6a6 6 0 0 1 12 0c0 2-1 3.7-2.5 4.9-.6.5-1 1.2-1 2H9.5c0-.8-.4-1.5-1-2Z" /></>,
  question: () => <><circle cx="12" cy="12" r="8.5" /><path d="M9.6 9.5a2.5 2.5 0 0 1 4.8 1c0 1.7-2.4 2-2.4 3.5M12 16.8h.01" /></>,
  brush: () => <><path d="M14.5 4.5l5 5-7.5 7.5-5-5 7.5-7.5Z" /><path d="M7 12l-2.5 2.5c-1 1-1 4 0 5s4 1 5 0L12 17" /></>,
  landmark: () => <><path d="M4 9.5L12 4l8 5.5H4Z" /><path d="M6 10v7M10 10v7M14 10v7M18 10v7M3.5 19.5h17" /></>,
  map: () => <><path d="M4 6.5l5-2 6 2 5-2v13l-5 2-6-2-5 2v-13Z" /><path d="M9 4.5v13M15 6.5v13" /></>,
  mask: () => <><path d="M4 6c5-1.5 11-1.5 16 0v5c0 4.5-3.6 8-8 8s-8-3.5-8-8V6Z" /><path d="M8 10.5c.8-.6 1.7-.6 2.5 0M13.5 10.5c.8-.6 1.7-.6 2.5 0M9 15c1.7 1.3 4.3 1.3 6 0" /></>,
  trash: () => <><path d="M4.5 7h15M9.5 7V5h5v2" /><path d="M6.5 7l1 12.5h9l1-12.5" /><path d="M10 11v5M14 11v5" /></>,
  plus: () => <path d="M12 5v14M5 12h14" />,
  arrow: () => <path d="M5 12h13M13 6.5l5.5 5.5-5.5 5.5" />,
  back: () => <path d="M19 12H6M11 6.5L5.5 12l5.5 5.5" />,
  play: () => <path d="M8 5.5v13l10.5-6.5L8 5.5Z" fill="currentColor" fillOpacity={0.2} />,
  speaker: () => <><path d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3v-5Z" /><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" /></>,
  joystick: () => <><circle cx="12" cy="6.5" r="2.5" /><path d="M12 9v6" /><path d="M5 15.5h14v3a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18.5v-3Z" /></>,
  eye: () => <><path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.8" /></>,
  cards: () => <><rect x="7.5" y="4" width="12" height="15" rx="2" transform="rotate(8 13.5 11.5)" /><rect x="4.5" y="5" width="12" height="15" rx="2" /></>,
  timer: () => <><circle cx="12" cy="13.5" r="7" /><path d="M10 3.5h4M12 13.5V9.5M17.5 7l1.5-1.5" /></>,
  note: () => <><path d="M6 4h9l4 4v12H6V4Z" /><path d="M15 4v4h4M9 12h6M9 15.5h6" /></>,
  siren: () => <><path d="M7 18v-5a5 5 0 0 1 10 0v5" /><path d="M5 18h14v2.5H5V18Z" /><path d="M12 4V2.5M19 6.5l1-1M5 6.5l-1-1" /></>,
  phone: () => <path d="M7.5 4.5l2.2 3.2c.4.6.3 1.3-.2 1.8l-1.1 1.1c.9 1.9 2.4 3.4 4.3 4.3l1.1-1.1c.5-.5 1.2-.6 1.8-.2l3.2 2.2c.6.4.8 1.2.4 1.8l-1 1.5c-.7 1-2 1.5-3.2 1.1C9.9 18.6 5.4 14.1 3.8 9c-.4-1.2.1-2.5 1.1-3.2l1.5-1c.6-.4 1.4-.2 1.8.4Z" />,
  bell: () => <><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15l1.5-2Z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>,
  brain: () => <><path d="M12 5.5c-1-1.7-4-1.7-4.8.6-2.2.2-3 2.6-2 4.1-1.4 1.2-1 3.8.8 4.4-.2 2 1.7 3.5 3.6 2.8.6 1.3 2.4 1.7 2.4 1.7V5.5Z" /><path d="M12 5.5c1-1.7 4-1.7 4.8.6 2.2.2 3 2.6 2 4.1 1.4 1.2 1 3.8-.8 4.4.2 2-1.7 3.5-3.6 2.8-.6 1.3-2.4 1.7-2.4 1.7" /></>,
  cloud: () => <path d="M7 18.5a4 4 0 0 1-.6-8 5.5 5.5 0 0 1 10.6-1.3A4.3 4.3 0 0 1 17.3 18.5H7Z" />,
  idcard: () => <><rect x="3.5" y="5.5" width="17" height="13" rx="2" /><circle cx="8.8" cy="11" r="2" /><path d="M6 15.5c.8-1.4 4.8-1.4 5.6 0M14 10h4M14 13.5h3" /></>,
  calendar: () => <><rect x="4" y="5.5" width="16" height="14" rx="2" /><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4M8.5 14h.01M12 14h.01M15.5 14h.01" /></>,
  heart: () => <path d="M12 19.5c-5-3.6-8-6.4-8-10a4 4 0 0 1 8-1.7 4 4 0 0 1 8 1.7c0 3.6-3 6.4-8 10Z" fill="currentColor" fillOpacity={0.15} />,
  pencil: () => <><path d="M15.5 4.5l4 4L9 19H5v-4L15.5 4.5Z" /><path d="M13.5 6.5l4 4" /></>,
  // a globe with a speech bubble tail: languages
  globe: (on) => <><circle cx="11" cy="11" r="7.5" fill={on ? "currentColor" : "none"} fillOpacity={on ? 0.18 : 0} /><path d="M3.5 11h15M11 3.5c2.2 2.2 3 4.7 3 7.5s-.8 5.3-3 7.5M11 3.5c-2.2 2.2-3 4.7-3 7.5s.8 5.3 3 7.5M16.5 16.5l3.5 3.5" /></>,
  compass: () => <><circle cx="12" cy="12" r="8.5" /><path d="M15.5 8.5l-2 5-5 2 2-5 5-2Z" fill="currentColor" fillOpacity={0.2} /></>,
  folder: () => <path d="M3.5 7c0-.8.7-1.5 1.5-1.5h4.3l2 2H19c.8 0 1.5.7 1.5 1.5v8.5c0 .8-.7 1.5-1.5 1.5H5c-.8 0-1.5-.7-1.5-1.5V7Z" />,
  journal: () => <><path d="M6 4h11a1.5 1.5 0 0 1 1.5 1.5v13A1.5 1.5 0 0 1 17 20H6V4Z" /><path d="M9 4v16M11.5 8.5h4.5M11.5 11.5h4.5" /></>,
  cap: () => <><path d="M2.5 9.5L12 5l9.5 4.5L12 14 2.5 9.5Z" /><path d="M6.5 11.5v4c3 2.3 8 2.3 11 0v-4M21.5 9.5v5" /></>,
  gamepad: () => <><path d="M7 8h10a4 4 0 0 1 3.9 4.9l-.9 3.6a2 2 0 0 1-3.4.8L14.5 15h-5l-2.1 2.3a2 2 0 0 1-3.4-.8l-.9-3.6A4 4 0 0 1 7 8Z" /><path d="M8.5 10.5v3M7 12h3M15.5 11.2h.01M17.3 12.8h.01" /></>,
  people: () => <><circle cx="8.5" cy="8.5" r="3" /><circle cx="16.5" cy="9.5" r="2.5" /><path d="M3 19c.7-3 2.9-4.5 5.5-4.5S13.3 16 14 19M14.5 15.2c.6-.4 1.3-.7 2-.7 2.2 0 3.8 1.3 4.5 4" /></>,
  sparkle: () => <path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9L12 3.5Z" fill="currentColor" fillOpacity={0.18} />,
  laptop: () => <><rect x="5" y="5" width="14" height="10" rx="1.5" /><path d="M3 18.5h18l-1.5-3.5h-15L3 18.5Z" /></>,
  music: () => <><path d="M9 17.5V6l10-2v11" /><circle cx="6.5" cy="17.5" r="2.5" /><circle cx="16.5" cy="15" r="2.5" /></>,
  breath: () => <><path d="M3.5 9h11a2.5 2.5 0 1 0-2.5-2.5" /><path d="M3.5 13h15a2.5 2.5 0 1 1-2.5 2.5" /><path d="M3.5 17h6" /></>,
  chat2: () => <path d="M5 6.5C5 5.1 6.1 4 7.5 4h9C17.9 4 19 5.1 19 6.5v7c0 1.4-1.1 2.5-2.5 2.5H11l-4 3.5V16h.5H7.5C6.1 16 5 14.9 5 13.5v-7Z" />,
  expand: () => <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />,
  shrink: () => <path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5" />,
  home: () => <><path d="M4 11l8-6.5 8 6.5" /><path d="M6 9.5V19h12V9.5" /><path d="M10 19v-5h4v5" /></>,
  star: () => <path d="M12 3.8l2.4 5 5.4.6-4 3.7 1.1 5.4L12 15.8l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6L12 3.8Z" />,
  // a little computer
  desk: (on) => (
    <>
      <rect x="4" y="5" width="16" height="11" rx="2" fill={on ? "currentColor" : "none"} fillOpacity={on ? 0.18 : 0} />
      <path d="M9 19.5h6" /><path d="M12 16v3.5" />
    </>
  ),
};

export function Icon({ name, on = false, size = 24, style }: { name: IconName; on?: boolean; size?: number; style?: React.CSSProperties }) {
  return (
    <svg className="navicon" style={style} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {P[name](on)}
    </svg>
  );
}

/** An icon and its words, side by side (for chips, tabs and buttons). */
export function IL({ i, children, size = 15 }: { i: IconName; children: React.ReactNode; size?: number }) {
  return <span className="il"><Icon name={i} size={size} />{children}</span>;
}
