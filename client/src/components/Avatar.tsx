// The companion's animated face: an SVG rig that works for every look. It breathes, blinks, shows
// moods (happy, thinking, sleepy for Low power, resting, concerned) and moves its mouth with
// `mouth` (0–1), which the Talk screen drives from the voice audio.

import type { Look, Mood } from "../api";

interface Rig {
  eyeY: number; eyeDX: number; mouthY: number; eye: "round" | "screen";
  back: React.ReactNode; front?: React.ReactNode;
}

const INK = "#2A1D3A";

const RIGS: Record<Look, Rig> = {
  fox: {
    eyeY: 104, eyeDX: 21, mouthY: 140, eye: "round",
    back: (
      <>
        <path d="M58 86 L44 36 L92 64 Z" fill="#E07A2C" /><path d="M64 78 L56 50 L82 66 Z" fill="#FFE3CF" />
        <path d="M142 86 L156 36 L108 64 Z" fill="#E07A2C" /><path d="M136 78 L144 50 L118 66 Z" fill="#FFE3CF" />
        <ellipse cx="100" cy="112" rx="58" ry="50" fill="#F28C38" />
        <path d="M58 118 Q100 176 142 118 Q122 128 100 126 Q78 128 58 118 Z" fill="#FFF4EC" />
      </>
    ),
    front: <ellipse cx="100" cy="126" rx="7" ry="5" fill={INK} />,
  },
  cat: {
    eyeY: 106, eyeDX: 22, mouthY: 138, eye: "round",
    back: (
      <>
        <path d="M54 92 L58 40 L96 70 Z" fill="#E9A74F" /><path d="M146 92 L142 40 L104 70 Z" fill="#E9A74F" />
        <path d="M62 82 L64 54 L86 70 Z" fill="#FFD9E8" /><path d="M138 82 L136 54 L114 70 Z" fill="#FFD9E8" />
        <circle cx="100" cy="114" r="54" fill="#F2B45A" />
        <path d="M70 96 Q76 90 82 96 M118 96 Q124 90 130 96" stroke="#D98E35" strokeWidth="4" fill="none" strokeLinecap="round" />
      </>
    ),
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
    back: (
      <>
        <path d="M66 78 Q52 44 70 30 Q66 56 82 70 Z" fill="#F2E3B0" /><path d="M134 78 Q148 44 130 30 Q134 56 118 70 Z" fill="#F2E3B0" />
        <path d="M92 64 L100 48 L108 64 Z" fill="#9B7BD0" />
        <ellipse cx="100" cy="112" rx="56" ry="52" fill="#6FBF8E" />
        <ellipse cx="100" cy="136" rx="34" ry="22" fill="#A8DDB5" />
      </>
    ),
    front: (
      <>
        <circle cx="92" cy="128" r="3" fill="#2F6B47" /><circle cx="108" cy="128" r="3" fill="#2F6B47" />
      </>
    ),
  },
  robot: {
    eyeY: 104, eyeDX: 22, mouthY: 136, eye: "screen",
    back: (
      <>
        <line x1="100" y1="64" x2="100" y2="40" stroke="#8E9AB0" strokeWidth="5" strokeLinecap="round" />
        <circle cx="100" cy="36" r="8" fill="#F59646" />
        <rect x="50" y="64" width="100" height="92" rx="24" fill="#B8C4D6" />
        <rect x="62" y="82" width="76" height="40" rx="14" fill="#2A2F45" />
        <circle cx="50" cy="110" r="7" fill="#8E9AB0" /><circle cx="150" cy="110" r="7" fill="#8E9AB0" />
      </>
    ),
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
    back: (
      <>
        <circle cx="74" cy="82" r="22" fill="#79C26B" /><circle cx="126" cy="82" r="22" fill="#79C26B" />
        <ellipse cx="100" cy="122" rx="64" ry="44" fill="#79C26B" />
        <circle cx="74" cy="80" r="14" fill="#F4FBEF" /><circle cx="126" cy="80" r="14" fill="#F4FBEF" />
      </>
    ),
  },
  owl: {
    eyeY: 104, eyeDX: 22, mouthY: 144, eye: "round",
    back: (
      <>
        <path d="M56 80 L50 44 L84 66 Z" fill="#8A6246" /><path d="M144 80 L150 44 L116 66 Z" fill="#8A6246" />
        <ellipse cx="100" cy="114" rx="58" ry="54" fill="#A57A5A" />
        <circle cx="78" cy="104" r="20" fill="#E9D3B8" /><circle cx="122" cy="104" r="20" fill="#E9D3B8" />
      </>
    ),
    front: <path d="M93 122 L107 122 L100 134 Z" fill="#F59646" />,
  },
  panda: {
    eyeY: 106, eyeDX: 22, mouthY: 140, eye: "round",
    back: (
      <>
        <circle cx="60" cy="70" r="18" fill="#2A2530" /><circle cx="140" cy="70" r="18" fill="#2A2530" />
        <ellipse cx="100" cy="114" rx="58" ry="52" fill="#F4F1F4" />
        <ellipse cx="78" cy="106" rx="14" ry="17" transform="rotate(-25 78 106)" fill="#2A2530" />
        <ellipse cx="122" cy="106" rx="14" ry="17" transform="rotate(25 122 106)" fill="#2A2530" />
      </>
    ),
    front: <ellipse cx="100" cy="126" rx="8" ry="5" fill="#2A2530" />,
  },
};

export const LOOK_EMOJI: Record<Look, string> = {
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

export function AvatarSvg({ look, mood = "happy", mouth = 0, size = 120 }: { look: Look; mood?: Mood; mouth?: number; size?: number }) {
  const rig = RIGS[look] ?? RIGS.fox;
  return (
    <svg className={`avatar ${mood}`} width={size} height={size} viewBox="0 0 200 200" role="img" aria-label={`${look}, ${mood}`}>
      <g className="breathe">
        {rig.back}
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
      {(mood === "sleepy" || mood === "resting") && (
        <g className="zzz" fill="#FBEAF6" fontFamily="Nunito, sans-serif" fontWeight="900">
          <text x="150" y="58" fontSize="20">z</text>
          <text x="164" y="40" fontSize="14">z</text>
        </g>
      )}
      {mood === "thinking" && (
        <g className="dots" fill="#FBEAF6">
          <circle cx="150" cy="44" r="5" /><circle cx="164" cy="44" r="5" /><circle cx="178" cy="44" r="5" />
        </g>
      )}
    </svg>
  );
}

/** The avatar inside its glowing orb, as in the designs. */
export function Avatar({
  look, mood = "happy", mouth = 0, size = 52, variant = "plain",
}: { look: Look; mood?: Mood; mouth?: number; size?: number; variant?: "plain" | "ring" | "halo" | "side" }) {
  return (
    <span className={`orb ${variant}`} style={{ width: size, height: size }}>
      <AvatarSvg look={look} mood={mood} mouth={mouth} size={Math.round(size * 0.92)} />
    </span>
  );
}
