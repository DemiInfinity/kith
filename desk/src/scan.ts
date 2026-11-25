// Checks a desk item before it's saved. Interactive things (HTML) run in a locked sandbox in the
// app anyway (no network, no storage, no access to the app); this is a second lock so nothing that
// tries to reach out is ever kept.

const BLOCKED: { why: string; re: RegExp }[] = [
  { why: "loads something from the internet", re: /\b(src|href|action|poster|data)\s*=\s*["']?\s*(https?:|\/\/|ftp:)/i },
  { why: "loads something from the internet", re: /url\(\s*["']?\s*(https?:|\/\/)/i },
  { why: "imports from the internet", re: /@import/i },
  { why: "uses the network", re: /\bfetch\s*\(|\b(XMLHttpRequest|WebSocket|EventSource|sendBeacon|RTCPeerConnection|importScripts)\b/ },
  { why: "uses the network", re: /\bimport\s*\(/ },
  { why: "uses storage", re: /\b(localStorage|sessionStorage|indexedDB|document\.cookie|caches\.open)\b/ },
  { why: "opens windows or leaves the page", re: /\b(window\.open|window\.top|window\.parent|top\.location|parent\.location|location\.href\s*=|location\.assign|location\.replace)\b/ },
  { why: "uses frames or embeds", re: /<\s*(iframe|frame|object|embed|base|link|meta\s+http-equiv)\b/i },
  { why: "uses a service worker", re: /\bserviceWorker\b/ },
  { why: "asks for the camera, microphone or location", re: /\b(getUserMedia|geolocation|mediaDevices)\b/ },
];

export interface ScanResult { ok: boolean; problems: string[] }

export function scanItem(format: string, content: string): ScanResult {
  const problems = new Set<string>();
  if (content.length > 400_000) problems.add("is too big");
  if (format === "html" || format === "svg") {
    for (const b of BLOCKED) if (b.re.test(content)) problems.add(b.why);
  }
  if (format === "svg" && /<\s*script\b/i.test(content)) problems.add("has a script inside a drawing");
  if (format === "svg" && /\bon[a-z]+\s*=/i.test(content)) problems.add("has a script inside a drawing");
  return { ok: problems.size === 0, problems: [...problems] };
}
