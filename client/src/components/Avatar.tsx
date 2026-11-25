import { useId } from "react";
// The companion's animated face: an SVG rig that works for every look. It breathes, blinks, shows
// moods (happy, thinking, sleepy for Low power, resting, concerned) and moves its mouth with
// `mouth` (0–1), which the Talk screen drives from the voice audio.

import type { Look, Mood } from "../api";

interface Rig {
  eyeY: number; eyeDX: number; mouthY: number; eye: "round" | "screen";
  back: React.ReactNode | ((gradientId: string) => React.ReactNode); front?: React.ReactNode;
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

const RIGS: Record<Look, Rig> = {
  // Buddy: the Kith app icon's face (design/icon/source/fg.svg, scaled to 200).
  buddy: {
    eyeY: 100, eyeDX: 16, mouthY: 128, eye: "round",
    back: (gid: string) => (
      <>
        {buddyGrad(gid)}
        <path d="M100 48 C138 48 155 75 155 107 C155 139 133 155 100 155 C67 155 45 139 45 107 C45 75 62 48 100 48 Z" fill={`url(#${gid})`} />
        <circle cx="75" cy="120" r="6" fill="#FFF4FB" fillOpacity="0.55" />
        <circle cx="125" cy="120" r="6" fill="#FFF4FB" fillOpacity="0.55" />
      </>
    ),
  },
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

/**
 * Its own little laptop, seen from where we are: in front of it, so we see the BACK of the lid (with
 * the Kith glow) and the screen faces the companion (it lights up its face). The laptop is turned at
 * an angle, so part of the keyboard shows beside the lid, with its paws on the keys.
 * Shapes from Microsoft's Fluent Emoji "Laptop" (MIT licence, see THIRD_PARTY_NOTICES.md), in the
 * laptop's own 32×32 units.
 */
function Laptop({ look }: { look: Look }) {
  const paw = PAW[look];
  return (
    <g className="laptop" transform="translate(40 108) scale(3.2)">
      {/* the keyboard, behind the lid and turned towards the companion; its left end shows */}
      <g transform="translate(-4 -7) skewY(-12)">
          <path d="M27.9999 20L15.9999 19L3.99992 20L2.01992 28.8911C1.9104 29.657 2.99521 29.5 3.49992 29.5H28.4999C29.0046 29.5 30.0894 29.657 29.9799 28.8911L27.9999 20Z" fill="#D3D3D3" />
          <path fillRule="evenodd" clipRule="evenodd" d="M27.27 21.28L27.99 24.53C28.04 24.77 27.86 24.99 27.62 24.99H4.37997C4.13997 24.99 3.95997 24.76 4.00997 24.53L4.72997 21.28C4.76997 21.11 4.91997 20.99 5.09997 20.99H26.9C27.08 20.99 27.23 21.11 27.27 21.28ZM8.18555 24.5H6.75344L6.87845 23.75H8.2793L8.18555 24.5ZM10.1241 24.5H8.68944L8.7832 23.75H10.1866L10.1241 24.5ZM11.9623 24.5H10.6259L10.6884 23.75H11.9936L11.9623 24.5ZM13.8123 24.5H12.4627L12.494 23.75H13.8435L13.8123 24.5ZM15.75 24.5H14.3127L14.344 23.75H15.75V24.5ZM17.6873 24.5H16.25V23.75H17.656L17.6873 24.5ZM19.5373 24.5H18.1877L18.1565 23.75H19.506L19.5373 24.5ZM21.3741 24.5H20.0377L20.0064 23.75H21.3116L21.3741 24.5ZM23.3106 24.5H21.8759L21.8134 23.75H23.2168L23.3106 24.5ZM25.2466 24.5H23.8145L23.7207 23.75H25.1216L25.2466 24.5ZM27 24.5H25.7535L25.6284 23.75H26.875L27 24.5ZM26.6667 22.5L26.7917 23.25H25.5451L25.4201 22.5H26.6667ZM26.5 21.5L26.5833 22H25.3368L25.2535 21.5H26.5ZM23.4395 21.5H24.7466L24.8299 22H23.5019L23.4395 21.5ZM21.6259 21.5H22.9356L22.9981 22H21.6675L21.6259 21.5ZM19.9127 21.5H21.1241L21.1658 22H19.9335L19.9127 21.5ZM18.0627 21.5H19.4123L19.4331 22H18.0835L18.0627 21.5ZM16.25 21.5H17.5623L17.5831 22H16.25V21.5ZM14.4377 21.5H15.75V22H14.4169L14.4377 21.5ZM12.5877 21.5H13.9373L13.9164 22H12.5669L12.5877 21.5ZM10.8759 21.5H12.0873L12.0665 22H10.8342L10.8759 21.5ZM9.06444 21.5H10.3741L10.3325 22H9.00195L9.06444 21.5ZM7.25344 21.5H8.56055L8.49805 22H7.17012L7.25344 21.5ZM5.5 21.5H6.74655L6.66322 22H5.41667L5.5 21.5ZM5.20834 23.25L5.33334 22.5H6.57989L6.45489 23.25H5.20834ZM5 24.5L5.12501 23.75H6.37155L6.24655 24.5H5ZM25.0382 23.25L24.9132 22.5H23.5644L23.6582 23.25H25.0382ZM23.1543 23.25L23.0606 22.5H21.7092L21.7717 23.25H23.1543ZM21.27 23.25L21.2075 22.5H19.9544L19.9856 23.25H21.27ZM19.4852 23.25L19.4539 22.5H18.1044L18.1356 23.25H19.4852ZM17.6352 23.25L17.6039 22.5H16.25V23.25H17.6352ZM7.08678 22.5L6.96178 23.25H8.3418L8.43555 22.5H7.08678ZM8.93945 22.5L8.8457 23.25H10.2283L10.2908 22.5H8.93945ZM10.7925 22.5L10.73 23.25H12.0144L12.0456 22.5H10.7925ZM12.5461 22.5L12.5148 23.25H13.8644L13.8956 22.5H12.5461ZM14.3961 22.5L14.3648 23.25H15.75V22.5H14.3961Z" fill="#9B9B9B" />
          <path d="M29.09 29C29.44 29 29.74 28.8 29.89 28.51L29.98 28.89L29.9834 28.9133C29.9921 28.9736 30 29.0279 30 29.09C30 29.59 29.59 30 29.09 30H2.91C2.41 30 2 29.59 2 29.09C2 29.02 2.01 28.96 2.03 28.9L2.11 28.52C2.26 28.8 2.56 29 2.91 29H29.09Z" fill="#9B9B9B" />
          <path d="M10.82 27.99H21.18C21.34 27.99 21.46 27.84 21.42 27.68L21.04 26.18C21.01 26.07 20.91 25.99 20.8 25.99H11.2C11.09 25.99 10.99 26.07 10.96 26.18L10.58 27.68C10.54 27.84 10.66 27.99 10.82 27.99Z" fill="#9B9B9B" />
      </g>
      {/* arm reaching to the keys we can see; the other paw is on the keys behind the lid */}
      <path d="M3 4 Q0 9 3.2 14.6" stroke={paw} strokeWidth="3.4" strokeLinecap="round" fill="none" />
      <g fill={paw} stroke="rgba(0,0,0,0.2)" strokeWidth="0.3">
        <ellipse className="paw-l" cx="3.4" cy="14.8" rx="2.7" ry="1.7" />
        <ellipse className="paw-r" cx="8.6" cy="13.6" rx="2.6" ry="1.6" />
      </g>
      {/* the back of the lid, angled */}
      <g transform="translate(8 1) skewY(-12) scale(0.85 1)">
          <path d="M27 2H5C4.45 2 4 2.45 4 3V19.99H28V3C28 2.45 27.55 2 27 2Z" fill="#7167A4" />
        <circle className="lid-glow" cx="16" cy="11" r="2.6" fill="#D9A3E0" />
        <circle cx="15" cy="10.6" r="0.45" fill="#2A1C27" /><circle cx="17" cy="10.6" r="0.45" fill="#2A1C27" />
      </g>
    </g>
  );
}

export function AvatarSvg({ look, mood = "happy", mouth = 0, size = 120, laptop = false, lookAround = true }: {
  look: Look; mood?: Mood; mouth?: number; size?: number;
  /** Show it working on its own laptop (used while its desk is busy). */
  laptop?: boolean;
  /** Glance left and right now and then while idle. */
  lookAround?: boolean;
}) {
  const rig = RIGS[look] ?? RIGS.fox;
  const gid = `kith-g${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const idle = lookAround && !laptop && mouth === 0 && (mood === "happy" || mood === "concerned");
  return (
    <svg className={`avatar ${mood}${laptop ? " working" : ""}`} width={size} height={size} viewBox="0 0 200 200" role="img"
      aria-label={`${look}, ${laptop ? "working on its laptop" : mood}`}>
      <g className="breathe">
        {typeof rig.back === "function" ? rig.back(gid) : rig.back}
        <g className={laptop ? "face at-screen" : idle ? "face glance" : "face"}>
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
        {laptop && <ellipse className="screen-light" cx="100" cy="104" rx="52" ry="30" fill="#9CF0D0" />}
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
  look, mood = "happy", mouth = 0, size = 52, variant = "plain", laptop = false,
}: { look: Look; mood?: Mood; mouth?: number; size?: number; variant?: "plain" | "ring" | "halo" | "side"; laptop?: boolean }) {
  return (
    <span className={`orb ${variant}`} style={{ width: size, height: size }}>
      <AvatarSvg look={look} mood={mood} mouth={mouth} size={Math.round(size * 0.92)} laptop={laptop} />
    </span>
  );
}
