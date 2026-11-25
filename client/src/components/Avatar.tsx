import { useEffect, useId, useState } from "react";
// The companion's animated face: an SVG rig that works for every look. It breathes, blinks, shows
// moods (happy, thinking, sleepy for Low power, resting, concerned) and moves its mouth with
// `mouth` (0–1), which the Talk screen drives from the voice audio.

import type { Look, Mood } from "../api";

interface Rig {
  eyeY: number; eyeDX: number; mouthY: number; eye: "round" | "screen";
  back: React.ReactNode | ((gradientId: string) => React.ReactNode); front?: React.ReactNode;
  ears?: React.ReactNode; markings?: React.ReactNode;
}

const INK = "#2A1D3A";

// Each avatar gets its own gradient id: a shared one breaks when the first copy is in a hidden part of the page.
const buddyGrad = (id: string) => (
  <defs>
    <linearGradient id={id} x1="0.15" y1="0.05" x2="0.85" y2="1">
      <stop offset="0" stopColor="#E7B4EE" /><stop offset="0.55" stopColor="#EFA6B8" /><stop offset="1" stopColor="#F7A055" />
    </linearGradient>
  </defs>
);

// Each look is three layers, so a glance turns the whole head:
//   ears     move a little (they swing with the turn)
//   back     the head itself
//   markings the face's own patches (muzzle, eye patches, face discs, snout…) move with the eyes
const RIGS: Record<Look, Rig> = {
  // Buddy: the Kith app icon's face (design/icon/source/fg.svg, scaled to 200).
  buddy: {
    eyeY: 100, eyeDX: 16, mouthY: 128, eye: "round",
    back: (gid: string) => (
      <>
        {buddyGrad(gid)}
        <path d="M100 48 C138 48 155 75 155 107 C155 139 133 155 100 155 C67 155 45 139 45 107 C45 75 62 48 100 48 Z" fill={`url(#${gid})`} />
      </>
    ),
    markings: (
      <>
        <circle cx="75" cy="120" r="6" fill="#FFF4FB" fillOpacity="0.55" />
        <circle cx="125" cy="120" r="6" fill="#FFF4FB" fillOpacity="0.55" />
      </>
    ),
  },
  fox: {
    eyeY: 104, eyeDX: 21, mouthY: 140, eye: "round",
    ears: (
      <>
        <path d="M58 86 L44 36 L92 64 Z" fill="#E07A2C" /><path d="M64 78 L56 50 L82 66 Z" fill="#FFE3CF" />
        <path d="M142 86 L156 36 L108 64 Z" fill="#E07A2C" /><path d="M136 78 L144 50 L118 66 Z" fill="#FFE3CF" />
      </>
    ),
    back: <ellipse cx="100" cy="112" rx="58" ry="50" fill="#F28C38" />,
    markings: <path d="M58 118 Q100 176 142 118 Q122 128 100 126 Q78 128 58 118 Z" fill="#FFF4EC" />,
    front: <ellipse cx="100" cy="126" rx="7" ry="5" fill={INK} />,
  },
  cat: {
    eyeY: 106, eyeDX: 22, mouthY: 138, eye: "round",
    ears: (
      <>
        <path d="M54 92 L58 40 L96 70 Z" fill="#E9A74F" /><path d="M146 92 L142 40 L104 70 Z" fill="#E9A74F" />
        <path d="M62 82 L64 54 L86 70 Z" fill="#FFD9E8" /><path d="M138 82 L136 54 L114 70 Z" fill="#FFD9E8" />
      </>
    ),
    back: <circle cx="100" cy="114" r="54" fill="#F2B45A" />,
    markings: <path d="M70 96 Q76 90 82 96 M118 96 Q124 90 130 96" stroke="#D98E35" strokeWidth="4" fill="none" strokeLinecap="round" />,
    front: (
      <>
        <path d="M94 124 L106 124 L100 131 Z" fill="#E9728F" />
        <g stroke="#7A4A2A" strokeWidth="2" strokeLinecap="round" opacity="0.6">
          <path d="M58 128 L80 130 M58 138 L80 135 M142 128 L120 130 M142 138 L120 135" />
        </g>
      </>
    ),
  },
  dragon: {
    eyeY: 102, eyeDX: 22, mouthY: 142, eye: "round",
    ears: (
      <>
        <path d="M66 78 Q52 44 70 30 Q66 56 82 70 Z" fill="#F2E3B0" /><path d="M134 78 Q148 44 130 30 Q134 56 118 70 Z" fill="#F2E3B0" />
        <path d="M92 64 L100 48 L108 64 Z" fill="#9B7BD0" />
      </>
    ),
    back: <ellipse cx="100" cy="112" rx="56" ry="52" fill="#6FBF8E" />,
    markings: <ellipse cx="100" cy="136" rx="34" ry="22" fill="#A8DDB5" />,
    front: (
      <>
        <circle cx="92" cy="128" r="3" fill="#2F6B47" /><circle cx="108" cy="128" r="3" fill="#2F6B47" />
      </>
    ),
  },
  robot: {
    eyeY: 104, eyeDX: 22, mouthY: 136, eye: "screen",
    ears: (
      <>
        <line x1="100" y1="64" x2="100" y2="40" stroke="#8E9AB0" strokeWidth="5" strokeLinecap="round" />
        <circle cx="100" cy="36" r="8" fill="#F59646" />
        <circle cx="50" cy="110" r="7" fill="#8E9AB0" /><circle cx="150" cy="110" r="7" fill="#8E9AB0" />
      </>
    ),
    back: <rect x="50" y="64" width="100" height="92" rx="24" fill="#B8C4D6" />,
    markings: <rect x="62" y="82" width="76" height="40" rx="14" fill="#2A2F45" />,
  },
  star: {
    eyeY: 108, eyeDX: 17, mouthY: 134, eye: "round",
    back: (
      <path
        d="M100 38 L117 84 L166 86 L128 116 L141 164 L100 137 L59 164 L72 116 L34 86 L83 84 Z"
        fill="#F7CF5A" stroke="#F2B45A" strokeWidth="6" strokeLinejoin="round"
      />
    ),
  },
  frog: {
    eyeY: 80, eyeDX: 26, mouthY: 136, eye: "round",
    ears: <><circle cx="74" cy="82" r="22" fill="#79C26B" /><circle cx="126" cy="82" r="22" fill="#79C26B" /></>,
    back: <ellipse cx="100" cy="122" rx="64" ry="44" fill="#79C26B" />,
    markings: <><circle cx="74" cy="80" r="14" fill="#F4FBEF" /><circle cx="126" cy="80" r="14" fill="#F4FBEF" /></>,
  },
  owl: {
    eyeY: 104, eyeDX: 22, mouthY: 144, eye: "round",
    ears: <><path d="M56 80 L50 44 L84 66 Z" fill="#8A6246" /><path d="M144 80 L150 44 L116 66 Z" fill="#8A6246" /></>,
    back: <ellipse cx="100" cy="114" rx="58" ry="54" fill="#A57A5A" />,
    markings: <><circle cx="78" cy="104" r="20" fill="#E9D3B8" /><circle cx="122" cy="104" r="20" fill="#E9D3B8" /></>,
    front: <path d="M93 122 L107 122 L100 134 Z" fill="#F59646" />,
  },
  panda: {
    eyeY: 106, eyeDX: 22, mouthY: 140, eye: "round",
    ears: <><circle cx="60" cy="70" r="18" fill="#2A2530" /><circle cx="140" cy="70" r="18" fill="#2A2530" /></>,
    back: <ellipse cx="100" cy="114" rx="58" ry="52" fill="#F4F1F4" />,
    markings: (
      <>
        <ellipse cx="78" cy="106" rx="14" ry="17" transform="rotate(-25 78 106)" fill="#2A2530" />
        <ellipse cx="122" cy="106" rx="14" ry="17" transform="rotate(25 122 106)" fill="#2A2530" />
      </>
    ),
    front: <ellipse cx="100" cy="126" rx="8" ry="5" fill="#2A2530" />,
  },
};

export const LOOK_EMOJI: Record<Look, string> = {
  buddy: "",
  fox: "🦊", cat: "🐱", dragon: "🐉", robot: "🤖", star: "⭐", frog: "🐸", owl: "🦉", panda: "🐼",
};
export const LOOKS = Object.keys(RIGS) as Look[];

function Eyes({ rig, mood, look }: { rig: Rig; mood: Mood; look: Look }) {
  const { eyeY: y, eyeDX: dx } = rig;
  const light = look === "panda" || look === "robot";
  const fill = rig.eye === "screen" ? "#9CF0D0" : light ? "#FFFFFF" : INK;
  const closed = mood === "sleepy" || mood === "resting";
  if (closed) {
    return (
      <g stroke={light ? "#FFFFFF" : INK} strokeWidth="4" strokeLinecap="round" fill="none">
        <path d={`M${100 - dx - 7} ${y} Q${100 - dx} ${y + 6} ${100 - dx + 7} ${y}`} />
        <path d={`M${100 + dx - 7} ${y} Q${100 + dx} ${y + 6} ${100 + dx + 7} ${y}`} />
      </g>
    );
  }
  return (
    <g className="eyes">
      <g className="pupils">
        {rig.eye === "screen" ? (
          <>
            <rect x={100 - dx - 7} y={y - 9} width="14" height="18" rx="5" fill={fill} />
            <rect x={100 + dx - 7} y={y - 9} width="14" height="18" rx="5" fill={fill} />
          </>
        ) : (
          <>
            <ellipse cx={100 - dx} cy={y} rx="7.5" ry="9" fill={fill} />
            <ellipse cx={100 + dx} cy={y} rx="7.5" ry="9" fill={fill} />
            <circle cx={100 - dx + 2.5} cy={y - 3.5} r="2.6" fill={light ? INK : "#FFFFFF"} />
            <circle cx={100 + dx + 2.5} cy={y - 3.5} r="2.6" fill={light ? INK : "#FFFFFF"} />
          </>
        )}
      </g>
      {mood === "concerned" && (
        <g stroke={light ? "#2A2530" : INK} strokeWidth="3.5" strokeLinecap="round">
          <path d={`M${100 - dx - 9} ${y - 16} L${100 - dx + 6} ${y - 19}`} />
          <path d={`M${100 + dx + 9} ${y - 16} L${100 + dx - 6} ${y - 19}`} />
        </g>
      )}
    </g>
  );
}

function Mouth({ rig, mood, open, look }: { rig: Rig; mood: Mood; open: number; look: Look }) {
  const y = rig.mouthY;
  const stroke = look === "robot" ? "#9CF0D0" : INK;
  if (open > 0.06) {
    const rx = 8 + open * 5;
    const ry = 2.5 + open * 9;
    return (
      <g>
        <ellipse cx="100" cy={y} rx={rx} ry={ry} fill={look === "robot" ? "#2A2F45" : "#5A1F3A"} stroke={look === "robot" ? stroke : "none"} strokeWidth="2" />
        {ry > 6 && look !== "robot" && <ellipse cx="100" cy={y + ry * 0.45} rx={rx * 0.6} ry={ry * 0.35} fill="#E9728F" />}
      </g>
    );
  }
  const d =
    mood === "happy" ? `M${88} ${y - 3} Q100 ${y + 9} ${112} ${y - 3}`
    : mood === "thinking" ? `M${93} ${y + 1} Q101 ${y - 2} ${108} ${y + 1}`
    : mood === "concerned" ? `M${90} ${y + 3} Q100 ${y - 3} ${110} ${y + 3}`
    : `M${94} ${y} Q100 ${y + 4} ${106} ${y}`;
  return <path d={d} stroke={stroke} strokeWidth="4" fill="none" strokeLinecap="round" />;
}

const PAW: Record<Look, string> = {
  buddy: "#EFA6B8", fox: "#E07A2C", cat: "#E9A74F", dragon: "#5FAF7E", robot: "#8E9AB0",
  star: "#F2B45A", frog: "#69B25B", owl: "#8A6246", panda: "#2A2530",
};

/** Where the companion sits at its laptop: to the left, and animals with ears a little higher so their arms fit. */
function seat(look: Look) {
  return look === "buddy" || look === "star" ? { x: -34, y: 2 } : { x: -34, y: -8 };
}

/**
 * Its own little laptop, drawn in the Fluent Emoji style and colours. The companion sits to the left,
 * so the laptop is turned to face it: we see the BACK of the lid (with the Kith face), the screen
 * leans away from the companion, and the keyboard sits between them with its paws typing.
 * Geometry: hinge H1 (124,170) → H2 (160,144); the deck runs back towards the companion along
 * V = (-62,-8); the lid rises from the hinge along L = (14,-56), leaning away from the companion.
 */
function Laptop({ look }: { look: Look }) {
  const paw = PAW[look];
  const keys: React.ReactNode[] = [];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 7; c++) {
      keys.push(<rect key={`${r}-${c}`} x={0.08 + c * 0.122} y={0.1 + r * 0.13} width={0.1} height={0.1} rx={0.025} fill="#9B9B9B" />);
    }
  }
  return (
    <g className="laptop" transform="translate(12 0)">
      <ellipse cx="112" cy="176" rx="62" ry="7" fill="#000" opacity="0.18" />
      {/* the base: its near side edge, then the deck with keys and trackpad */}
      <polygon points="62,162 124,170 124,176 62,168" fill="#A9A9A9" />
      <polygon points="124,170 160,144 98,136 62,162" fill="#D3D3D3" stroke="#BDBDBD" strokeWidth="1" strokeLinejoin="round" />
      <g transform="matrix(36 -26 -62 -8 124 170)">
        {keys}
        <rect x={0.34} y={0.68} width={0.32} height={0.22} rx={0.05} fill="#BDBDBD" />
      </g>
      {/* arms come out of the left and right of its head, near the bottom, to paws on the keys,
          taking turns like typing (coordinates here are the laptop's: 12 to the right of the avatar's) */}
      {(() => {
        const o = seat(look);
        const L = { x: 48 + o.x - 12, y: 146 + o.y }; // left side of the head, near the bottom
        const R = { x: 152 + o.x - 12, y: 146 + o.y }; // right side
        return (
          <>
            <g className="arm-l">
              <path d={`M${L.x} ${L.y} Q${L.x + 6} ${L.y + 24} ${L.x + 34} ${L.y + 22} T101 158`} stroke={paw} strokeWidth="11" strokeLinecap="round" fill="none" />
              <ellipse cx="102" cy="157.5" rx="7.5" ry="5.2" fill={paw} stroke="rgba(0,0,0,0.15)" strokeWidth="1" />
            </g>
            <g className="arm-r">
              <path d={`M${R.x} ${R.y} Q${R.x + 8} ${R.y + 4} 121 148`} stroke={paw} strokeWidth="10" strokeLinecap="round" fill="none" />
              <ellipse cx="122" cy="148" rx="7" ry="4.8" fill={paw} stroke="rgba(0,0,0,0.15)" strokeWidth="1" />
            </g>
          </>
        );
      })()}
      {/* the lid: its near edge (thickness), then the back of the lid with the Kith face */}
      <polygon points="124,170 138,114 134,115 120,171" fill="#5B528A" />
      <polygon points="124,170 160,144 174,88 138,114" fill="#7167A4" stroke="#857BB8" strokeWidth="1.5" strokeLinejoin="round" />
      <g transform="matrix(1 -0.722 0 1 0 0)">
        <ellipse className="lid-glow" cx="149" cy="236.6" rx="7.5" ry="7" fill="#E7B4EE" />
        <ellipse cx="146.4" cy="236" rx="1.2" ry="1.8" fill="#2A1C27" />
        <ellipse cx="151.6" cy="236" rx="1.2" ry="1.8" fill="#2A1C27" />
      </g>
    </g>
  );
}

/**
 * Mouth movement for talking when there's no live audio to follow: open and close in a
 * syllable-like rhythm (a few quick syllables, then a short pause, like speech).
 */
export function useTalkingMouth(active: boolean): number {
  const [open, setOpen] = useState(0);
  useEffect(() => {
    if (!active) { setOpen(0); return; }
    if (typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches) { setOpen(0.3); return; }
    let t = 0;
    let syllables = 3 + Math.floor(Math.random() * 4);
    const id = setInterval(() => {
      t += 1;
      if (syllables <= 0) {
        // a little pause between words
        setOpen(0);
        if (t % 4 === 0) syllables = 2 + Math.floor(Math.random() * 5);
        return;
      }
      // open on even ticks, close on odd ones, with varied size
      if (t % 2 === 0) setOpen(0.35 + Math.random() * 0.6);
      else { setOpen(0.05); syllables -= 1; }
    }, 110);
    return () => clearInterval(id);
  }, [active]);
  return open;
}

export function AvatarSvg({ look, mood = "happy", mouth: mouthIn = 0, size = 120, laptop = false, lookAround = true, talking = false }: {
  look: Look; mood?: Mood; mouth?: number; size?: number;
  /** Talking with no audio to follow: the mouth opens and closes by itself. */
  talking?: boolean;
  /** Show it working on its own laptop (used while its desk is busy). */
  laptop?: boolean;
  /** Glance left and right now and then while idle. */
  lookAround?: boolean;
}) {
  const auto = useTalkingMouth(talking && mouthIn === 0);
  const mouth = mouthIn || auto;
  const rig = RIGS[look] ?? RIGS.fox;
  const gid = `kith-g${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const idle = lookAround && !laptop && mouth === 0 && (mood === "happy" || mood === "concerned");
  const faceClass = laptop ? "face at-screen" : idle ? "face glance" : "face";
  return (
    <svg className={`avatar ${mood}${laptop ? " working" : ""}`} width={size} height={size} viewBox="0 0 200 200" role="img"
      aria-label={`${look}, ${laptop ? "working on its laptop" : mood}`}>
      {/* At the laptop, the companion sits to the left, turned towards it. */}
      <g transform={laptop ? `translate(${seat(look).x} ${seat(look).y})` : undefined}>
      <g className="breathe">
        <g className={laptop ? "ears at-screen-ears" : idle ? "ears glance-ears" : "ears"}>{rig.ears}</g>
        <g className={laptop ? "head at-screen-head" : idle ? "head glance-head" : "head"}>
          {typeof rig.back === "function" ? rig.back(gid) : rig.back}
        </g>
        {/* Face markings slide across the face but stay inside the head's outline. */}
        {rig.markings && (
          <>
            {look !== "frog" && <clipPath id={`${gid}-head`}>{typeof rig.back === "function" ? rig.back(`${gid}-c`) : rig.back}</clipPath>}
            <g clipPath={look !== "frog" ? `url(#${gid}-head)` : undefined}>
              <g className={faceClass}>{rig.markings}</g>
            </g>
          </>
        )}
        <g className={faceClass}>
          {mood === "happy" && look !== "robot" && (
            <g fill="#FF8FB8" opacity="0.35">
              <circle cx={100 - rig.eyeDX - 10} cy={rig.mouthY - 10} r="8" />
              <circle cx={100 + rig.eyeDX + 10} cy={rig.mouthY - 10} r="8" />
            </g>
          )}
          <Eyes rig={rig} mood={mood} look={look} />
          {rig.front}
          <Mouth rig={rig} mood={mood} open={mouth} look={look} />
        </g>
      </g>
      </g>
      {laptop && <Laptop look={look} />}
      {(mood === "sleepy" || mood === "resting") && !laptop && (
        <g className="zzz" fill="#FBEAF6" fontFamily="Nunito, sans-serif" fontWeight="900">
          <text x="150" y="58" fontSize="20">z</text>
          <text x="164" y="40" fontSize="14">z</text>
        </g>
      )}
      {mood === "thinking" && !laptop && (
        <g className="dots" fill="#FBEAF6">
          <circle cx="150" cy="44" r="5" /><circle cx="164" cy="44" r="5" /><circle cx="178" cy="44" r="5" />
        </g>
      )}
    </svg>
  );
}

/** A look's button face in pickers: its emoji, or the drawn face for looks without one. */
export function LookIcon({ look }: { look: Look }) {
  return LOOK_EMOJI[look] ? <>{LOOK_EMOJI[look]}</> : <AvatarSvg look={look} size={58} />;
}

/** The Kith logo mark: Buddy's face (design/icon/source/fg.svg). */
export function LogoMark({ size = 64 }: { size?: number }) {
  const id = `kith-logo${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" aria-hidden>
      <defs><linearGradient id={id} x1="0.15" y1="0.05" x2="0.85" y2="1"><stop offset="0" stopColor="#E7B4EE" /><stop offset="0.55" stopColor="#EFA6B8" /><stop offset="1" stopColor="#F7A055" /></linearGradient></defs>
      <path d="M512 246 C706 246 794 382 794 548 C794 712 680 794 512 794 C344 794 230 712 230 548 C230 382 318 246 512 246 Z" fill={`url(#${id})`} />
      <ellipse cx="432" cy="512" rx="40" ry="62" fill="#2A1C27" /><ellipse cx="592" cy="512" rx="40" ry="62" fill="#2A1C27" />
      <circle cx="382" cy="612" r="30" fill="#FFF4FB" fillOpacity="0.55" /><circle cx="642" cy="612" r="30" fill="#FFF4FB" fillOpacity="0.55" />
    </svg>
  );
}

/** The avatar inside its glowing orb, as in the designs. */
export function Avatar({
  look, mood = "happy", mouth = 0, size = 52, variant = "plain", laptop = false, talking = false,
}: { look: Look; mood?: Mood; mouth?: number; size?: number; variant?: "plain" | "ring" | "halo" | "side"; laptop?: boolean; talking?: boolean }) {
  return (
    <span className={`orb ${variant}`} style={{ width: size, height: size }}>
      <AvatarSvg look={look} mood={mood} mouth={mouth} size={Math.round(size * 0.92)} laptop={laptop} talking={talking} />
    </span>
  );
}
