// Boot-time configuration from the environment. Nothing family-specific lives in code:
// names, people and endpoints all come from here (see .env.example).
// Settings the parent can change at runtime (budgets, quiet hours, connections…) live in the
// database and start from these defaults (see settings.ts).

const env = process.env;

function list(v: string | undefined): string[] {
  return (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
function num(v: string | undefined, fallback: number): number {
  if (v === undefined || v.trim() === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Expected a number, got "${v}"`);
  return n;
}
function bool(v: string | undefined, fallback = false): boolean {
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

export const config = {
  port: num(env.PORT, 8787),
  host: env.HOST ?? "0.0.0.0",
  publicUrl: (env.KITH_PUBLIC_URL ?? "http://localhost:8787").replace(/\/$/, ""),
  dataDir: env.KITH_DATA_DIR ?? "./data",
  clientDir: env.KITH_CLIENT_DIR ?? "../client/dist",
  timezone: env.KITH_TIMEZONE ?? "Europe/London",
  sessionSecret: env.KITH_SESSION_SECRET ?? "",

  // People. Matched on the verified email (or the OIDC subject) from the sign-in provider.
  people: {
    child: list(env.KITH_CHILD_IDS),
    parents: list(env.KITH_PARENT_IDS),
    // How the companion refers to the child if the sign-in provider gives no first name.
    childName: env.KITH_CHILD_NAME ?? "",
    // What the child calls the grown-up in the loop ("Mum", "Dad", "Grandma"…).
    parentLabel: env.KITH_PARENT_LABEL ?? "your grown-up",
  },

  oidc: {
    issuer: env.KITH_OIDC_ISSUER ?? "",
    clientId: env.KITH_OIDC_CLIENT_ID ?? "",
    clientSecret: env.KITH_OIDC_CLIENT_SECRET ?? "",
    label: env.KITH_OIDC_LABEL ?? "Pocket ID",
  },
  // Local testing only: lets you pick child/parent without a sign-in provider. Never in production.
  devLogin: bool(env.KITH_DEV_LOGIN),

  anthropic: {
    apiKey: env.ANTHROPIC_API_KEY ?? "",
    fullModel: env.KITH_MODEL_FULL ?? "claude-sonnet-5-5",
    lowModel: env.KITH_MODEL_LOW ?? "claude-haiku-5-5",
    safetyModel: env.KITH_MODEL_SAFETY ?? "claude-haiku-5-5",
  },

  voice: {
    sttHost: env.KITH_STT_HOST ?? "whisper",
    sttPort: num(env.KITH_STT_PORT, 10300),
    ttsHost: env.KITH_TTS_HOST ?? "piper",
    ttsPort: num(env.KITH_TTS_PORT, 10200),
    language: env.KITH_STT_LANGUAGE ?? "en",
    // The three voices offered on the Personality screen, as label=piper-voice pairs.
    voices: parseVoices(env.KITH_VOICES ?? "Wren=en_GB-cori-medium,Robin=en_GB-alan-medium,Fern=en_GB-jenny_dioco-medium"),
  },

  desk: {
    url: (env.KITH_DESK_URL ?? "http://desk:8790").replace(/\/$/, ""),
    token: env.KITH_DESK_TOKEN ?? "",
  },

  push: {
    publicKey: env.KITH_VAPID_PUBLIC_KEY ?? "",
    privateKey: env.KITH_VAPID_PRIVATE_KEY ?? "",
    subject: env.KITH_VAPID_SUBJECT ?? "mailto:admin@localhost",
  },

  reporting: {
    // "console" logs reports; "ha-board" posts them to Home Assistant.
    reporters: list(env.KITH_REPORTERS ?? "console"),
    ha: {
      url: (env.KITH_HA_URL ?? "").replace(/\/$/, ""),
      token: env.KITH_HA_TOKEN ?? "",
      service: env.KITH_HA_SERVICE ?? "script.ai_board_post",
      handle: env.KITH_HA_HANDLE ?? "kith",
      kinds: {
        now: env.KITH_HA_KIND_NOW ?? "child_now",
        today: env.KITH_HA_KIND_TODAY ?? "child_today",
        fyi: env.KITH_HA_KIND_FYI ?? "child_fyi",
      },
    },
  },

  // Secrets for parent-approved connections, referenced by name from the connections settings.
  // The parent view never sees or stores them.
  secret(name: string): string {
    return name ? env[name] ?? "" : "";
  },

  // Google Drive for the child's own account (drive.file only). Your own OAuth client; see docs/google.md.
  google: {
    clientId: env.KITH_GOOGLE_CLIENT_ID ?? "",
    clientSecret: env.KITH_GOOGLE_CLIENT_SECRET ?? "",
    // Optional: pre-fills the Google account to connect, and (if set) refuses any other.
    accountHint: env.KITH_GOOGLE_ACCOUNT ?? "",
    expectedEmail: env.KITH_GOOGLE_ACCOUNT ?? "",
    // For the Google Picker (choosing a doc to hand to Kith): a browser API key and the project number.
    pickerApiKey: env.KITH_GOOGLE_PICKER_API_KEY ?? "",
    appId: env.KITH_GOOGLE_PROJECT_NUMBER ?? "",
  },

  // Disabled until a child-safety image detector (e.g. Thorn Safer / IWF hash matching) is wired in.
  drawingUploads: {
    detector: env.KITH_IMAGE_SAFETY_DETECTOR ?? "",
  },
};

export type Config = typeof config;

function parseVoices(v: string): { label: string; voice: string }[] {
  return list(v).map((pair) => {
    const [label, voice] = pair.split("=").map((s) => s.trim());
    return { label, voice: voice ?? label };
  });
}
