import * as React from "react"

/**
 * Doodle Crew Footer — a site footer drawn like the last page of a sketchbook.
 * The brand's name is stamped across it in giant dry-brush ink, and a crew of
 * hand-drawn characters lives on the letters: one leans against the first
 * letter, one sits on top with its legs dangling, one peeks over the edge.
 * Little ink doodles (papers, folders, laptops, checks) drift down around them.
 *
 * Scroll it into view and it plays out like a short storyboard: the ground line
 * draws itself, the letters stamp down one by one with a puff of ink, the crew
 * pops up, plops down or rises from behind their letters, the doodles start to
 * fall, and the line and buttons rise in last.
 *
 * Then it stays alive: every eye follows your pointer (and blinks), the lines
 * boil like hand-drawn animation, letters wobble when you hover them, a click
 * on any character makes it hop and say its line, and doodles scatter from the
 * pointer and pop when you catch one.
 *
 * No dependencies and nothing fetched: React is the only import, every drawing
 * is inline SVG, and the ink texture is an SVG filter.
 */

// #region crew
// Pure: wordmark layout, seats, gaze, the doodle drift and the storyboard timing.
// Lifted out and run by the test.

/** A small deterministic hash → [0, 1), so every render lays the scene out the same way. */
export const hash = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

/**
 * Lays the wordmark out from per-letter advances (in font units): the left edge
 * of each letter, with `tracking` (in em) added between letters, and the total
 * width. A non-finite or negative advance counts as zero so one bad glyph can't
 * throw the whole word off the page.
 */
export const layoutWord = (advances: number[], tracking: number, fontSize: number): { x: number[]; w: number[]; width: number } => {
  const x: number[] = []
  const w: number[] = []
  let at = 0
  const gap = (Number.isFinite(tracking) ? tracking : 0) * fontSize
  for (let i = 0; i < advances.length; i++) {
    const a = Number.isFinite(advances[i]) && advances[i] > 0 ? advances[i] : 0
    x.push(at)
    w.push(a)
    at += a + (i < advances.length - 1 ? gap : 0)
  }
  return { x, w, width: Math.max(0, at) }
}

export type Seat = "front" | "top" | "behind"

/**
 * Where a crew member stands, in wordmark units (baseline at y = 0, up is
 * negative). `front` stands on the ground in front of the letter, `top` sits on
 * the letter's top edge, `behind` rises from behind the letter so only its top
 * shows above the edge. `offset` slides it along the letter, in letter widths.
 */
export const seatPoint = (seat: Seat, letterX: number, letterW: number, cap: number, offset: number, scale: number): { x: number; y: number } => {
  const x = letterX + letterW * (0.5 + (Number.isFinite(offset) ? offset : 0))
  if (seat === "top") return { x, y: -cap }
  if (seat === "behind") return { x, y: -cap + 30 * scale }
  return { x, y: 0 }
}

/**
 * Where a pupil sits inside its eye: pointed at the target, never further than
 * `max` from the centre, and easing off as the target comes close so the eye
 * doesn't snap when the pointer sits right on the face.
 */
export const lookAt = (ex: number, ey: number, tx: number, ty: number, max: number, reach: number): { x: number; y: number } => {
  const dx = tx - ex
  const dy = ty - ey
  const d = Math.hypot(dx, dy)
  if (!Number.isFinite(d) || d < 1e-6 || max <= 0) return { x: 0, y: 0 }
  const k = (max * Math.min(1, d / Math.max(1e-6, reach))) / d
  return { x: dx * k, y: dy * k }
}

export type Floater = {
  x: number
  y: number
  vx: number
  vy: number
  rot: number
  vr: number
  fall: number
  phase: number
  /** Seconds left in a pop; 0 means alive. */
  pop: number
}

/**
 * One step of a doodle's drift: it falls at its own speed and sways, the
 * pointer pushes it away within `radius`, it eases back to its drift when let
 * go, and it wraps round the box so the sky never empties. A popped doodle
 * waits out its timer and comes back in from the top. `rand` supplies the new
 * x on a wrap.
 */
export const stepFloater = (
  f: Floater,
  dt: number,
  t: number,
  w: number,
  h: number,
  px: number,
  py: number,
  radius: number,
  rand: () => number,
): Floater => {
  const step = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.05)
  const m = 40
  if (f.pop > 0) {
    f.pop -= step
    if (f.pop <= 0) {
      f.pop = 0
      f.x = rand() * w
      f.y = -m
      f.vx = 0
      f.vy = f.fall
    }
    return f
  }
  const sway = Math.sin(t * 0.7 + f.phase) * 14
  if (Number.isFinite(px) && Number.isFinite(py) && radius > 0) {
    const dx = f.x - px
    const dy = f.y - py
    const d = Math.hypot(dx, dy)
    if (d < radius && d > 0.01) {
      const k = (1 - d / radius) * (1 - d / radius) * 2400
      f.vx += (dx / d) * k * step
      f.vy += (dy / d) * k * step
      f.vr += (dx > 0 ? 1 : -1) * k * 0.004 * step
    }
  }
  const ease = Math.min(1, step * 2.4)
  f.vx += (sway - f.vx) * ease
  f.vy += (f.fall - f.vy) * ease
  f.vr += (Math.sin(f.phase * 3) * 18 - f.vr) * Math.min(1, step * 0.8)
  f.x += f.vx * step
  f.y += f.vy * step
  f.rot = (f.rot + f.vr * step) % 360
  if (f.y > h + m) {
    f.y = -m
    f.x = rand() * w
  } else if (f.y < -m * 3) {
    f.y = h + m
  }
  if (f.x < -m) f.x = w + m
  else if (f.x > w + m) f.x = -m
  return f
}

/**
 * The storyboard, in ms from the moment the footer comes into view: the ground
 * line draws, letters stamp left to right, the crew arrives once the word is
 * down, then the doodles, the line of copy word by word, and the buttons.
 */
export const timeline = (letters: number, crew: number, words: number, actions: number) => {
  const L = Math.max(0, Math.floor(letters) || 0)
  const C = Math.max(0, Math.floor(crew) || 0)
  const W = Math.max(0, Math.floor(words) || 0)
  const A = Math.max(0, Math.floor(actions) || 0)
  const letter = (i: number) => 160 + i * 80
  const crewStart = letter(Math.max(0, L - 1)) + 420
  const member = (j: number) => crewStart + j * 130
  const doodles = crewStart + Math.max(0, C - 1) * 130 * 0.5
  const copy = crewStart + 260
  const word = (k: number) => copy + k * 45
  const actionsStart = word(W) + 120
  const action = (k: number) => actionsStart + k * 110
  const total = Math.max(member(Math.max(0, C - 1)) + 720, action(Math.max(0, A - 1)) + 600, letter(Math.max(0, L - 1)) + 560)
  return { ground: 60, letter, crewStart, member, doodles, word, action, total }
}

// #endregion

export type CrewKind = "clerk" | "analyst" | "worker"
export type DoodleKind = "paper" | "folder" | "laptop" | "check"
export type DoodleCrewPreset = "auto" | "paper" | "night" | "riso" | "sunny"

export interface CrewMember {
  kind: CrewKind
  /** Index of the wordmark letter it lives on. */
  letter: number
  /** `front` stands before the letter, `top` sits on it, `behind` peeks over it. Defaults per kind. */
  seat?: Seat
  /** Slides it along the letter, in letter widths. 0 is centred. */
  offset?: number
  /** Size relative to the letter. Defaults to 1. */
  scale?: number
  /** Faces the other way. */
  flip?: boolean
  /** Used in its accessible label. */
  name?: string
  /** What it says when clicked. */
  says?: string
}

export interface FooterLink {
  label: string
  href?: string
}

export interface FooterColumn {
  title: string
  links: FooterLink[]
}

export interface FooterAction {
  label: string
  href?: string
  icon?: DoodleKind
  variant?: "solid" | "outline"
  onClick?: () => void
}

export interface DoodleCrewFooterProps {
  /** The giant word. Short, upper case, 4–9 letters reads best. */
  wordmark?: string
  /** Brand name, top left. */
  brand?: string
  /** One or two sentences under the brand. */
  blurb?: string
  /** The line under the wordmark. */
  tagline?: string
  columns?: FooterColumn[]
  /** The pill buttons under the tagline. */
  actions?: FooterAction[]
  /** Bottom bar, left. */
  copyright?: string
  legal?: FooterLink[]
  socials?: FooterLink[]
  /** Shows a back-to-top button in the bottom bar. Defaults to true. */
  backToTop?: boolean
  crew?: CrewMember[]
  /** Which doodles drift around the word. An empty list turns them off. */
  doodles?: DoodleKind[]
  /** How many doodles at a time. Defaults to 12. */
  doodleCount?: number
  /** `auto` follows the page's --color-background / --color-foreground tokens. */
  preset?: DoodleCrewPreset
  palette?: { background?: string; ink?: string; accent?: string }
  /** Display face for the wordmark. Heavy grotesks stamp best. */
  fontFamily?: string
  /** Face for the tagline and blurb. */
  serifFamily?: string
  /** Letter spacing of the wordmark, in em. Defaults to -0.02. */
  tracking?: number
  /** Pointer, hover and click play. Defaults to true. */
  interactive?: boolean
  /** Minimum height, a definite length. The footer grows past it if its content needs to. */
  height?: string
  className?: string
}

const PRESETS = {
  auto: { background: "var(--color-background, #ffffff)", ink: "var(--color-foreground, #0d0d0d)", accent: "#ff6b2c" },
  paper: { background: "#ffffff", ink: "#0d0d0d", accent: "#ff6b2c" },
  night: { background: "#0e0e10", ink: "#f4f1ea", accent: "#ff8a3d" },
  riso: { background: "#f4f2ff", ink: "#2433c9", accent: "#ff4f8b" },
  sunny: { background: "#ffd94a", ink: "#141414", accent: "#e8402a" },
}

const DEFAULT_CREW: CrewMember[] = [
  { kind: "clerk", letter: 0, seat: "front", offset: -0.4, name: "Clara", says: "Ficha atualizada." },
  { kind: "analyst", letter: 2, seat: "top", offset: 0.05, name: "Rui", says: "Relatório pronto." },
  { kind: "worker", letter: 4, seat: "front", offset: 0.35, flip: true, name: "Aónio", says: "Tudo registado." },
]

const DEFAULT_COLUMNS: FooterColumn[] = [
  { title: "Play", links: [{ label: "Download", href: "#" }, { label: "Patch notes", href: "#" }, { label: "Roadmap", href: "#" }, { label: "Wiki", href: "#" }] },
  { title: "Shop", links: [{ label: "Sticker packs", href: "#" }, { label: "Plushies", href: "#" }, { label: "Art prints", href: "#" }, { label: "Gift cards", href: "#" }] },
  { title: "Community", links: [{ label: "Discord", href: "#" }, { label: "Fan art", href: "#" }, { label: "Events", href: "#" }, { label: "Creators", href: "#" }] },
  { title: "Studio", links: [{ label: "About", href: "#" }, { label: "Careers", href: "#" }, { label: "Press kit", href: "#" }, { label: "Contact", href: "#" }] },
]

const DEFAULT_ACTIONS: FooterAction[] = [
  { label: "See the product", href: "#", icon: "paper", variant: "outline" },
  { label: "Get started", href: "#", icon: "laptop", variant: "solid" },
]

const DEFAULT_DOODLES: DoodleKind[] = ["paper", "folder", "laptop", "check", "paper", "paper", "folder", "laptop"]

const ACCENT = { manila: "#f2c48d" }

// ---- the crew's drawings --------------------------------------------------------
// Each kind is drawn in its own units: base centre at (0, 0), up is negative,
// about 144 units to a letter's cap height. Eyes are listed separately so the
// renderer can aim and blink them.

type Eye = { x: number; y: number; r: number; pupil: number; max: number }
type Art = {
  /** Size against the letters, before the member's own scale. */
  k: number
  box: { l: number; r: number; t: number; b: number }
  eyes: Eye[]
  seat: Seat
  body: (hatch: string) => React.ReactNode
  front?: () => React.ReactNode
}

const ART: { [k: string]: Art } = {
  clerk: {
    k: 1.1,
    box: { l: -46, r: 32, t: -128, b: 8 },
    seat: "front",
    eyes: [
      { x: -5, y: -105, r: 0, pupil: 2.2, max: 1.5 },
      { x: 5, y: -105, r: 0, pupil: 2.2, max: 1.5 },
    ],
    body: (hatch) => (
      <>
        <ellipse className="dcf-shadow" cx="0" cy="2" rx="26" ry="4" />
        <path d="M-12 -48 L-3 -48 L-2 -4 L-12 -4 Z" />
        <path d="M3 -48 L12 -48 L13 -4 L3 -4 Z" />
        <path d="M3 -48 L12 -48 L13 -4 L3 -4 Z" fill={hatch} stroke="none" />
        <path className="k" d="M-14 -4 C-17 1 -5 2 -2 -1 L-2 -7 L-12 -7 Z" />
        <path className="k" d="M13 -4 C16 1 4 2 1 -1 L1 -7 L11 -7 Z" />
        <path d="M-15 -48 C-18 -60 -19 -76 -16 -88 L16 -88 C19 -76 18 -60 15 -48 C5 -44 -5 -44 -15 -48 Z" />
        <path className="n" d="M-7 -88 L0 -79 L7 -88" />
        <path className="a" d="M-2.8 -85 L2.8 -85 L1.9 -77 L0 -74 L-1.9 -77 Z" />
        <path className="a" d="M-1.9 -74 L1.9 -74 L1.2 -60 L0 -57 L-1.2 -60 Z" />
        <path className="n thin" d="M-15 -52 L15 -52" />
        <path className="n" d="M-16 -84 C-25 -78 -28 -68 -26 -58" />
        <circle cx="-26" cy="-56" r="3.4" />
        <path className="n" d="M16 -84 C23 -80 26 -73 25 -66" />
        <circle cx="25" cy="-64" r="3.4" />
        <g transform="rotate(-8 -32 -58)">
          <path className="dcf-paperfill" d="M-42 -72 L-23 -72 L-21 -67 L-24 -45 L-42 -45 Z" />
          <path className="n" d="M-42 -72 L-23 -72 L-21 -67" />
          <path className="n thin" d="M-38 -63 L-26 -63 M-38 -57 L-26 -57" />
        </g>
        <circle cx="0" cy="-104" r="13" />
        <path d="M-13 -108 C-14 -121 -3 -127 6 -123 C14 -120 14 -112 13 -106 C8 -113 -9 -113 -13 -108 Z" />
        <path className="n" d="M-8 -109 L-3 -108 M3 -108 L8 -109" />
        <path className="n" d="M-4 -96 C-1 -93 2 -93 4 -96" />
      </>
    ),
  },
  analyst: {
    k: 1.45,
    box: { l: -26, r: 28, t: -84, b: 46 },
    seat: "top",
    eyes: [
      { x: -5, y: -60, r: 0, pupil: 1.7, max: 1.5 },
      { x: 5, y: -60, r: 0, pupil: 1.7, max: 1.5 },
    ],
    body: (hatch) => (
      <>
        <path d="M-11 -6 L-2 -6 C-2 8 -4 20 -5 30 L-14 30 C-14 18 -14 6 -11 -6 Z" />
        <path d="M2 -6 L11 -6 C13 6 15 16 18 27 L9 30 C7 18 4 6 2 -6 Z" />
        <path d="M2 -6 L11 -6 C13 6 15 16 18 27 L9 30 C7 18 4 6 2 -6 Z" fill={hatch} stroke="none" />
        <path className="k" d="M-16 30 C-19 36 -19 41 -12 42 L-1 42 C3 41 1 34 -4 30 Z" />
        <path className="k" d="M9 29 C6 34 8 40 14 40 L24 38 C27 36 25 30 20 27 Z" />
        <path d="M-15 -4 C-19 -16 -19 -28 -15 -40 L15 -40 C19 -28 19 -16 15 -4 C5 0 -5 0 -15 -4 Z" />
        <path className="n" d="M-7 -40 L0 -33 L7 -40" />
        <path className="dcf-paperfill" d="M-12.5 -35 L12.5 -35 L12.5 -14 L-12.5 -14 Z" />
        <circle className="n" cx="0" cy="-24.5" r="3" />
        <path d="M-16 -14 L16 -14 L13 -6 L-13 -6 Z" />
        <path className="n thin" d="M-11 -10.5 L11 -10.5" />
        <path className="n" d="M-15 -36 C-21 -31 -22 -24 -19 -17" />
        <path className="n" d="M15 -36 C21 -31 22 -24 19 -17" />
        <circle cx="0" cy="-60" r="13" />
        <path d="M-13 -63 C-12 -76 -6 -80 3 -80 C11 -80 13 -73 13 -63 C7 -68 -7 -68 -13 -63 Z" />
        <path className="n thin" d="M3 -80 L4 -72" />
        <circle className="n" cx="-5" cy="-60" r="4.6" />
        <circle className="n" cx="5" cy="-60" r="4.6" />
        <path className="n thin" d="M-9.6 -60 L-13 -61 M9.6 -60 L13 -61 M-0.4 -60 L0.4 -60" />
        <path className="n" d="M-4 -50 C-1 -47 2 -47 4 -50" />
      </>
    ),
  },
  worker: {
    k: 1.12,
    box: { l: -30, r: 44, t: -140, b: 8 },
    seat: "front",
    eyes: [
      { x: -5, y: -103, r: 0, pupil: 2.2, max: 1.5 },
      { x: 5, y: -103, r: 0, pupil: 2.2, max: 1.5 },
    ],
    body: (hatch) => (
      <>
        <ellipse className="dcf-shadow" cx="0" cy="2" rx="26" ry="4" />
        <path d="M-12 -48 L-3 -48 L-2 -4 L-12 -4 Z" />
        <path d="M3 -48 L12 -48 L13 -4 L3 -4 Z" />
        <path d="M3 -48 L12 -48 L13 -4 L3 -4 Z" fill={hatch} stroke="none" />
        <path className="k" d="M-14 -4 C-17 1 -5 2 -2 -1 L-2 -7 L-12 -7 Z" />
        <path className="k" d="M13 -4 C16 1 4 2 1 -1 L1 -7 L11 -7 Z" />
        <path d="M-15 -48 C-18 -60 -19 -76 -16 -88 L16 -88 C19 -76 18 -60 15 -48 C5 -44 -5 -44 -15 -48 Z" />
        <path className="n" d="M-7 -88 L0 -78 L7 -88" />
        <path className="n" d="M-16.5 -73 L16.5 -73" />
        <path d="M-16.7 -70 L16.7 -70 L16.7 -63.5 L-16.7 -63.5 Z" fill={hatch} stroke="none" />
        <path className="n" d="M0 -78 L0 -63" />
        <path className="n" d="M-16 -84 C-25 -79 -28 -70 -26 -61" />
        <circle cx="-26" cy="-59" r="3.4" />
        <path className="n" d="M16 -84 C25 -80 29 -73 28 -64" />
        <circle cx="28" cy="-62" r="3.4" />
        <g transform="rotate(8 30 -58)">
          <rect className="dcf-paperfill" x="20" y="-72" width="21" height="27" rx="2" />
          <path className="n thin" d="M24.5 -63 L36 -63.5 M25 -57 L37 -57 M25.5 -51 L34 -51" />
        </g>
        <circle cx="0" cy="-103" r="13" />
        <path d="M-15 -113 C-15 -131 15 -131 15 -113 Z" />
        <path className="a" d="M-1.5 -129 L1.5 -129 L1.5 -113 L-1.5 -113 Z" />
        <path d="M-19 -113 L19 -113 C19 -108 -19 -108 -19 -113 Z" />
        <path className="n" d="M-4 -93 C-1 -90 2 -90 4 -93" />
      </>
    ),
  },
}

/** Each doodle in a 32-unit box centred on (0, 0). */
const Doodle = ({ kind }: { kind: DoodleKind }) => {
  switch (kind) {
    case "paper":
      return (
        <>
          <path className="dcf-paperfill" d="M-10 -13 H5 L11 -7 V13 H-10 Z" />
          <path fill="none" d="M5 -13 V-7 H11" />
          <path fill="none" d="M-6 -1 H6 M-6 4 H6 M-6 9 H2" />
        </>
      )
    case "folder":
      return (
        <>
          <path fill={ACCENT.manila} d="M-13 -8 H-3 L-1 -5 H13 V12 H-13 Z" />
        </>
      )
    case "laptop":
      return (
        <>
          <path className="dcf-paperfill" d="M-9 -11 H9 V4 H-9 Z" />
          <path fill="none" d="M-14 4 H14 L11 11 H-11 Z" />
          <path fill="none" d="M-11 7.5 L11 7.5" />
          <circle fill="var(--dcf-ink)" cx="0" cy="-3.5" r="1.4" />
        </>
      )
    case "check":
      return (
        <>
          <circle cx="0" cy="0" r="11.5" fill="var(--dcf-accent)" />
          <path fill="none" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" d="M-5.2 0 L-1.4 4.6 L6.5 -5.2" />
        </>
      )
  }
  return null
}

const DoodleIcon = ({ kind, size = 18 }: { kind: DoodleKind; size?: number }) => (
  <svg className="dcf-icon" viewBox="-16 -16 32 32" width={size} height={size} aria-hidden="true">
    <Doodle kind={kind} />
  </svg>
)

type Metrics = { advances: number[]; cap: number }

const FONT_SIZE = 200
const DEFAULT_FONT = '"Arial Black", "Inter Display", Inter, "Helvetica Neue", Helvetica, Arial, sans-serif'
const DEFAULT_SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif'

const estimate = (word: string): Metrics => ({
  advances: Array.from(word).map((c) => (c === " " ? 0.3 : /[IJ1]/.test(c) ? 0.42 : /[MW]/.test(c) ? 0.98 : 0.76) * FONT_SIZE),
  cap: 0.73 * FONT_SIZE,
})

const measure = (word: string, family: string): Metrics | null => {
  if (typeof document === "undefined") return null
  const ctx = document.createElement("canvas").getContext("2d")
  if (!ctx) return null
  ctx.font = "900 " + FONT_SIZE + "px " + family
  const chars = Array.from(word)
  const advances: number[] = []
  let prev = 0
  for (let i = 0; i < chars.length; i++) {
    const wNow = ctx.measureText(chars.slice(0, i + 1).join("")).width
    advances.push(wNow - prev)
    prev = wNow
  }
  const m = ctx.measureText(word.replace(/\s/g, "") || "H")
  const cap = m.actualBoundingBoxAscent > 0 ? m.actualBoundingBoxAscent : 0.73 * FONT_SIZE
  return { advances, cap }
}

const useIso = typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect

const Link = ({ link, className }: { link: FooterLink; className?: string }) =>
  link.href ? (
    <a className={className} href={link.href}>
      <span>{link.label}</span>
      <svg className="dcf-squiggle" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true">
        <path pathLength={1} d="M1 5 C10 1 16 7 25 4 S40 1 50 4 S66 7 75 4 S90 1 99 4" />
      </svg>
    </a>
  ) : (
    <span className={className}>{link.label}</span>
  )

export default function DoodleCrewFooter({
  wordmark = "MISCHIEF",
  brand = "mischief",
  blurb = "We draw every frame by hand and ship a new chapter every season. Come make a little trouble with us.",
  tagline = "A hand-drawn world for the troublemaker in all of us.",
  columns = DEFAULT_COLUMNS,
  actions = DEFAULT_ACTIONS,
  copyright = "© 2026 Mischief Games. Drawn by hand in Lisbon.",
  legal = [{ label: "Privacy", href: "#" }, { label: "Terms", href: "#" }, { label: "Cookies", href: "#" }],
  socials = [{ label: "Discord", href: "#" }, { label: "YouTube", href: "#" }, { label: "TikTok", href: "#" }, { label: "X", href: "#" }],
  backToTop = true,
  crew = DEFAULT_CREW,
  doodles = DEFAULT_DOODLES,
  doodleCount = 12,
  preset = "auto",
  palette,
  fontFamily = DEFAULT_FONT,
  serifFamily = DEFAULT_SERIF,
  tracking = -0.02,
  interactive = true,
  height = "760px",
  className,
}: DoodleCrewFooterProps) {
  const uid = React.useId().replace(/[^a-zA-Z0-9_-]/g, "")
  const word = wordmark.toUpperCase()
  const chars = React.useMemo(() => Array.from(word), [word])
  const colors = { ...(PRESETS[preset] || PRESETS.auto), ...(palette || {}) }

  const rootRef = React.useRef(null as HTMLElement | null)
  const svgRef = React.useRef(null as SVGSVGElement | null)
  const worldRef = React.useRef(null as HTMLDivElement | null)
  const crewLayerRefs = React.useRef([] as (SVGGElement | null)[])
  const eyeRefs = React.useRef([] as { blink: SVGGElement | null; pupil: SVGGElement | null }[][])
  const doodleRefs = React.useRef([] as (HTMLDivElement | null)[])

  const [metrics, setMetrics] = React.useState(() => estimate(word))
  const [play, setPlay] = React.useState(false)
  const [reduced, setReduced] = React.useState(false)
  const [talking, setTalking] = React.useState(-1)
  const [hopping, setHopping] = React.useState(-1)
  const talkTimer = React.useRef(0)

  // ---- measure the real face, again once late web fonts land ----
  useIso(() => {
    const run = () => {
      const m = measure(word, fontFamily)
      if (m) setMetrics(m)
    }
    run()
    const fonts = typeof document !== "undefined" ? document.fonts : undefined
    if (!fonts) return
    let alive = true
    fonts.ready.then(() => alive && run())
    fonts.addEventListener?.("loadingdone", run)
    return () => {
      alive = false
      fonts.removeEventListener?.("loadingdone", run)
    }
  }, [word, fontFamily])

  const layout = React.useMemo(() => layoutWord(metrics.advances, tracking, FONT_SIZE), [metrics, tracking])
  const cap = metrics.cap

  const placed = React.useMemo(
    () =>
      crew
        .map((m, i) => {
          const art = ART[m.kind]
          if (!art || !chars.length) return null
          const li = clamp(Math.floor(m.letter) || 0, 0, chars.length - 1)
          const scale = (cap / 144) * art.k * (m.scale ?? 1)
          const seat = m.seat || art.seat
          const p = seatPoint(seat, layout.x[li], layout.w[li], cap, m.offset ?? 0, scale)
          return { i, m, art, seat, scale, ...p, flip: m.flip ? -1 : 1 }
        })
        .filter(Boolean) as { i: number; m: CrewMember; art: Art; seat: Seat; scale: number; x: number; y: number; flip: number }[],
    [crew, chars.length, layout, cap],
  )

  // The viewBox hugs the word, the crew and the ground.
  const view = React.useMemo(() => {
    let l = 0
    let r = layout.width
    let t = -cap
    let b = 30
    for (const p of placed) {
      const bx = p.flip > 0 ? [p.art.box.l, p.art.box.r] : [-p.art.box.r, -p.art.box.l]
      l = Math.min(l, p.x + bx[0] * p.scale)
      r = Math.max(r, p.x + bx[1] * p.scale)
      t = Math.min(t, p.y + p.art.box.t * p.scale)
      b = Math.max(b, p.y + p.art.box.b * p.scale)
    }
    const pad = 24
    return { x: l - pad, y: t - pad, w: r - l + pad * 2, h: b - t + pad * 2 }
  }, [layout, placed, cap])

  const words = tagline.split(/\s+/).filter(Boolean)
  const tl = timeline(chars.length, placed.length, words.length, actions.length)

  const ground = React.useMemo(() => {
    const x0 = view.x + 6
    const x1 = view.x + view.w - 6
    let d = "M" + x0.toFixed(1) + " 6"
    const n = 14
    for (let k = 1; k <= n; k++) {
      const x = x0 + ((x1 - x0) * k) / n
      d += " Q" + (x - (x1 - x0) / n / 2).toFixed(1) + " " + (6 + (hash(k * 3.1) - 0.5) * 5).toFixed(1) + " " + x.toFixed(1) + " " + (6 + (hash(k * 7.7) - 0.5) * 2).toFixed(1)
    }
    let tufts = ""
    for (let k = 0; k < 22; k++) {
      const x = x0 + 20 + hash(k * 11.3) * (x1 - x0 - 40)
      const s = 0.7 + hash(k * 5.9) * 0.6
      tufts += "M" + x.toFixed(1) + " 6 l" + (2 * s).toFixed(1) + " " + (-9 * s).toFixed(1) + " M" + (x + 3 * s).toFixed(1) + " 6 l" + (1 * s).toFixed(1) + " " + (-12 * s).toFixed(1) + " M" + (x + 6 * s).toFixed(1) + " 6 l" + (-1 * s).toFixed(1) + " " + (-7 * s).toFixed(1) + " "
    }
    const pebbles = Array.from({ length: 9 }, (_, k) => ({ x: x0 + 40 + hash(k * 17.1) * (x1 - x0 - 80), y: 14 + hash(k * 2.3) * 8, r: 2 + hash(k * 9.4) * 2.6 }))
    return { d, tufts, pebbles }
  }, [view])

  // ---- doodles ----
  const doodleList = React.useMemo(() => {
    const kinds = doodles.length ? doodles : []
    const n = kinds.length ? clamp(Math.floor(doodleCount) || 0, 0, 40) : 0
    return Array.from({ length: n }, (_, k) => ({
      kind: kinds[k % kinds.length],
      size: 22 + hash(k * 4.7) * 14,
      seed: k,
    }))
  }, [doodles, doodleCount])

  const sim = React.useRef({
    floaters: [] as Floater[],
    w: 0,
    h: 0,
    px: NaN,
    py: NaN,
    inside: false,
    visible: false,
    gaze: [] as { x: number; y: number; tx: number; ty: number; next: number; blinkAt: number; blink: number }[],
    seed: 1,
    start: 0,
  })

  // Lay the doodles out once the world has a size; keep them when it resizes.
  useIso(() => {
    const el = worldRef.current
    if (!el) return
    const s = sim.current
    const size = () => {
      const r = el.getBoundingClientRect()
      const ow = s.w
      const oh = s.h
      s.w = r.width
      s.h = r.height
      if (s.floaters.length !== doodleList.length || !ow) {
        s.floaters = doodleList.map((_, k) => ({
          x: (0.04 + 0.92 * ((k + hash(k * 9.1) * 0.8) / Math.max(1, doodleList.length))) * r.width,
          y: (0.02 + hash(k * 3.3) * 0.56) * r.height,
          vx: 0,
          vy: 0,
          rot: (hash(k * 1.7) - 0.5) * 50,
          vr: (hash(k * 6.1) - 0.5) * 30,
          fall: 9 + hash(k * 2.9) * 16,
          phase: hash(k * 8.3) * Math.PI * 2,
          pop: 0,
        }))
      } else if (ow && oh) {
        for (const f of s.floaters) {
          f.x *= r.width / ow
          f.y *= r.height / oh
        }
      }
      paintDoodles()
    }
    size()
    if (typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(size)
    ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doodleList])

  const paintDoodles = () => {
    const s = sim.current
    const k = clamp(s.w / 1100, 0.5, 1)
    for (let i = 0; i < s.floaters.length; i++) {
      const el = doodleRefs.current[i]
      const f = s.floaters[i]
      if (!el || !f) continue
      let sc = k
      let op = 1
      if (f.pop > 0) {
        const age = 1.4 - f.pop
        sc = k * (1 + Math.min(1, age / 0.3) * 0.7)
        op = Math.max(0, 1 - age / 0.3)
      }
      el.style.transform = "translate3d(" + f.x.toFixed(1) + "px," + f.y.toFixed(1) + "px,0) rotate(" + f.rot.toFixed(1) + "deg) scale(" + sc.toFixed(3) + ")"
      el.style.opacity = String(op)
    }
  }

  // ---- reduced motion ----
  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    const on = () => setReduced(mq.matches)
    on()
    mq.addEventListener?.("change", on)
    return () => mq.removeEventListener?.("change", on)
  }, [])

  // ---- the storyboard starts when the footer comes into view; the loop sleeps off-screen ----
  React.useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const s = sim.current
    if (typeof IntersectionObserver === "undefined") {
      s.visible = true
      setPlay(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          s.visible = e.isIntersecting
          if (e.isIntersecting && e.intersectionRatio > 0.12) setPlay(true)
        }
      },
      { threshold: [0, 0.12, 0.3] },
    )
    io.observe(root)
    return () => io.disconnect()
  }, [])

  React.useEffect(() => {
    if (play && !sim.current.start) sim.current.start = performance.now()
  }, [play])

  // ---- the living loop: eyes, blinks, doodles, line boil ----
  React.useEffect(() => {
    if (typeof window === "undefined") return
    const s = sim.current
    let raf = 0
    let last = performance.now()
    let boilAt = 0
    let boil = 0
    const rand = () => {
      s.seed = (s.seed * 16807) % 2147483647
      return s.seed / 2147483647
    }
    const svgPoint = (svg: SVGSVGElement, cx: number, cy: number) => {
      const m = svg.getScreenCTM()
      if (!m) return null
      const inv = m.inverse()
      return { x: inv.a * cx + inv.c * cy + inv.e, y: inv.b * cx + inv.d * cy + inv.f }
    }
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      if (!s.visible || document.hidden) {
        last = now
        return
      }
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const t = now / 1000
      const svg = svgRef.current
      const world = worldRef.current

      // eyes
      let target = null as null | { x: number; y: number }
      if (svg && s.inside && interactive) target = svgPoint(svg, s.px, s.py)
      for (let c = 0; c < placed.length; c++) {
        const p = placed[c]
        const g = (s.gaze[c] ||= { x: 0, y: 0, tx: 0, ty: 0, next: 0, blinkAt: t + 1 + hash(c * 3.7) * 3, blink: 0 })
        if (!target && t > g.next) {
          // idle: glance somewhere, now and then at a neighbour
          const other = placed[(c + 1 + Math.floor(rand() * Math.max(1, placed.length - 1))) % placed.length]
          if (other && rand() < 0.45) {
            g.tx = other.x
            g.ty = other.y - 60 * other.scale
          } else {
            g.tx = p.x + (rand() - 0.5) * 900
            g.ty = p.y - 80 * p.scale + (rand() - 0.5) * 500
          }
          g.next = t + 1.4 + rand() * 2.6
        }
        if (t > g.blinkAt) {
          g.blink = 0.16
          g.blinkAt = t + 2.2 + rand() * 4
        }
        g.blink = Math.max(0, g.blink - dt)
        const lid = g.blink > 0 ? 0.12 + Math.abs(g.blink - 0.08) / 0.08 * 0.88 : 1
        const eyes = eyeRefs.current[c] || []
        for (let e = 0; e < p.art.eyes.length; e++) {
          const eye = p.art.eyes[e]
          const ex = p.x + eye.x * p.scale * p.flip
          const ey = p.y + eye.y * p.scale
          const tx = target ? target.x : g.tx
          const ty = target ? target.y : g.ty
          const o = lookAt(ex, ey, tx, ty, eye.max, 220)
          const ref = eyes[e]
          if (!ref) continue
          const key = "_o" + e
          const prev = (g as unknown as { [k: string]: { x: number; y: number } })[key] || { x: 0, y: 0 }
          const ease = Math.min(1, dt * (target ? 14 : 6))
          const nx = prev.x + (o.x * p.flip - prev.x) * ease
          const ny = prev.y + (o.y - prev.y) * ease
          ;(g as unknown as { [k: string]: { x: number; y: number } })[key] = { x: nx, y: ny }
          if (ref.pupil) ref.pupil.setAttribute("transform", "translate(" + nx.toFixed(2) + " " + ny.toFixed(2) + ")")
          if (ref.blink) ref.blink.setAttribute("transform", "translate(0 " + (eye.y * (1 - lid)).toFixed(2) + ") scale(1 " + lid.toFixed(3) + ")")
        }
      }

      // doodles
      if (world && s.floaters.length) {
        const started = play && s.start ? now - s.start > tl.doodles || reduced : false
        if (started) {
          const r = world.getBoundingClientRect()
          const px = s.inside && interactive ? s.px - r.left : NaN
          const py = s.inside && interactive ? s.py - r.top : NaN
          if (!reduced) for (const f of s.floaters) stepFloater(f, dt, t, s.w, s.h, px, py, 110, rand)
          paintDoodles()
        }
      }

      // line boil: three hand-drawn takes swapped at 8 fps
      if (!reduced && now - boilAt > 125) {
        boilAt = now
        boil = (boil + 1) % 3
        const f = "url(#" + uid + "-boil" + boil + ")"
        for (const el of crewLayerRefs.current) if (el) el.setAttribute("filter", f)
      }
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placed, play, reduced, interactive, uid, tl.doodles])

  React.useEffect(() => () => window.clearTimeout(talkTimer.current), [])

  const onPointerMove = (e: React.PointerEvent) => {
    const s = sim.current
    s.px = e.clientX
    s.py = e.clientY
    s.inside = true
  }
  const onPointerLeave = () => {
    sim.current.inside = false
  }

  const poke = (c: number) => {
    if (!interactive) return
    setTalking(c)
    setHopping(-1)
    requestAnimationFrame(() => setHopping(c))
    window.clearTimeout(talkTimer.current)
    talkTimer.current = window.setTimeout(() => {
      setTalking(-1)
      setHopping(-1)
    }, 2600)
  }

  const popDoodle = (k: number) => {
    if (!interactive) return
    const f = sim.current.floaters[k]
    if (f && f.pop <= 0) {
      f.pop = 1.4
      paintDoodles()
    }
  }

  const toTop = () => {
    if (typeof window === "undefined") return
    window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" })
  }

  const hatch = "url(#" + uid + "-hatch)"
  const vars = {
    "--dcf-bg": colors.background,
    "--dcf-ink": colors.ink,
    "--dcf-accent": colors.accent,
    "--dcf-serif": serifFamily,
    "--dcf-display": fontFamily,
    minHeight: height,
  } as React.CSSProperties

  const pct = (v: number, base: number, span: number) => (((v - base) / span) * 100).toFixed(3) + "%"

  const renderCrew = (p: (typeof placed)[number], part: "body" | "front") => (
    <g key={p.i + part} transform={"translate(" + p.x.toFixed(2) + " " + p.y.toFixed(2) + ") scale(" + (p.scale * p.flip).toFixed(4) + " " + p.scale.toFixed(4) + ")"}>
      <g className={"dcf-arrive dcf-arrive-" + p.seat} style={{ "--d": tl.member(p.i) + "ms" } as React.CSSProperties}>
        <g className={"dcf-hopper" + (hopping === p.i ? " is-hop" : "")}>
          <g className="dcf-art">
            {part === "body" ? (
              <>
                {p.art.body(hatch)}
                {p.art.eyes.map((eye, e) => (
                  <g
                    key={e}
                    ref={(el) => {
                      ;(eyeRefs.current[p.i] ||= [])[e] = { ...(eyeRefs.current[p.i]?.[e] || { pupil: null }), blink: el }
                    }}
                  >
                    {eye.r > 0 && <circle cx={eye.x} cy={eye.y} r={eye.r} />}
                    <g
                      ref={(el) => {
                        ;(eyeRefs.current[p.i] ||= [])[e] = { ...(eyeRefs.current[p.i]?.[e] || { blink: null }), pupil: el }
                      }}
                    >
                      <circle className="k" cx={eye.x} cy={eye.y} r={eye.pupil} />
                      <circle className="dcf-glint" cx={eye.x + eye.pupil * 0.35} cy={eye.y - eye.pupil * 0.4} r={eye.pupil * 0.32} />
                    </g>
                  </g>
                ))}
              </>
            ) : (
              p.art.front?.()
            )}
          </g>
        </g>
      </g>
    </g>
  )

  return (
    <footer
      ref={rootRef}
      className={"dcf" + (className ? " " + className : "")}
      data-play={play || reduced ? "1" : "0"}
      data-interactive={interactive ? "1" : "0"}
      style={vars}
      onPointerMove={onPointerMove}
      onPointerDown={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      <style>{CSS}</style>

      <div className="dcf-top dcf-rise" style={{ "--d": "0ms" } as React.CSSProperties}>
        <div className="dcf-brand">
          <span className="dcf-logo" aria-hidden="true">
            <svg viewBox="-60 -150 120 120" width="30" height="30">
              <g className="dcf-art">
                <path d="M-22 -132 H8 L28 -112 V-44 H-22 Z" />
                <path className="n" d="M8 -132 V-112 H28" />
                <path className="n thin" d="M-13 -92 H17 M-13 -79 H17 M-13 -66 H4" />
              </g>
            </svg>
          </span>
          <span className="dcf-brandname">{brand}</span>
        </div>
        {blurb && <p className="dcf-blurb">{blurb}</p>}
        {columns.length > 0 && (
          <nav className="dcf-cols" aria-label="Rodapé">
            {columns.map((col) => (
              <div className="dcf-col" key={col.title}>
                <h3 className="dcf-coltitle">{col.title}</h3>
                <ul>
                  {col.links.map((l) => (
                    <li key={l.label}>
                      <Link link={l} className="dcf-link" />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        )}
      </div>

      <div className="dcf-world" ref={worldRef}>
        <div className="dcf-stage">
          <h2 className="dcf-sr">{wordmark}</h2>
          <svg
            ref={svgRef}
            className="dcf-svg"
            viewBox={view.x.toFixed(1) + " " + view.y.toFixed(1) + " " + view.w.toFixed(1) + " " + view.h.toFixed(1)}
            aria-hidden="false"
            role="group"
            aria-label={wordmark + " — conhece a equipa"}
          >
            <defs>
              <pattern id={uid + "-hatch"} width="4.6" height="4.6" patternUnits="userSpaceOnUse" patternTransform="rotate(38)">
                <line x1="0" y1="0" x2="0" y2="4.6" style={{ stroke: "var(--dcf-ink)" }} strokeWidth="1.25" />
              </pattern>
              {[0, 1, 2].map((k) => (
                <filter key={k} id={uid + "-boil" + k} x="-10%" y="-10%" width="120%" height="120%">
                  <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed={k * 7 + 3} result="n" />
                  <feDisplacementMap in="SourceGraphic" in2="n" scale="2.6" xChannelSelector="R" yChannelSelector="G" />
                </filter>
              ))}
              <filter id={uid + "-ink"} x="-4%" y="-6%" width="108%" height="112%">
                <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="3" seed="11" result="edge" />
                <feDisplacementMap in="SourceGraphic" in2="edge" scale="5" xChannelSelector="R" yChannelSelector="G" result="rough" />
                <feTurbulence type="fractalNoise" baseFrequency="0.018 0.32" numOctaves="2" seed="4" result="streak" />
                <feColorMatrix in="streak" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -16 5.6" result="streakA" />
                <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="1" seed="9" result="speck" />
                <feColorMatrix in="speck" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -24 7.0" result="speckA" />
                <feComposite in="streakA" in2="speckA" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="holes" />
                <feComposite in="rough" in2="holes" operator="out" />
              </filter>
            </defs>

            <g ref={(el) => void (crewLayerRefs.current[0] = el)}>
              <g className="dcf-ground">
                <path className="dcf-draw" pathLength={1} d={ground.d} style={{ "--d": tl.ground + "ms" } as React.CSSProperties} />
                <path className="dcf-tufts dcf-fade" d={ground.tufts} style={{ "--d": tl.ground + 500 + "ms" } as React.CSSProperties} />
                {ground.pebbles.map((pb, k) => (
                  <ellipse key={k} className="dcf-pebble dcf-fade" cx={pb.x} cy={pb.y} rx={pb.r * 1.5} ry={pb.r} style={{ "--d": tl.ground + 600 + "ms" } as React.CSSProperties} />
                ))}
              </g>
              {placed.filter((p) => p.seat === "behind").map((p) => renderCrew(p, "body"))}
            </g>

            {chars.map((c, i) =>
              c === " " ? null : (
                <g key={i} className="dcf-letter" style={{ "--d": tl.letter(i) + "ms", "--r": ((hash(i * 2.3) - 0.5) * 9).toFixed(2) + "deg" } as React.CSSProperties}>
                  <g className="dcf-glyph">
                    <text x={layout.x[i]} y={0} fontSize={FONT_SIZE} fontWeight={900} style={{ fontFamily }} filter={"url(#" + uid + "-ink)"}>
                      {c}
                    </text>
                  </g>
                  <path
                    className="dcf-dust"
                    d={
                      "M" + (layout.x[i] - 6) + " -6 l-16 -6 M" + (layout.x[i] - 4) + " -16 l-12 -12 M" + (layout.x[i] + layout.w[i] + 6) + " -6 l16 -6 M" + (layout.x[i] + layout.w[i] + 4) + " -16 l12 -12"
                    }
                  />
                </g>
              ),
            )}

            <g ref={(el) => void (crewLayerRefs.current[1] = el)}>
              {placed.filter((p) => p.seat === "behind").map((p) => renderCrew(p, "front"))}
              {placed.filter((p) => p.seat !== "behind").map((p) => renderCrew(p, "body"))}
            </g>

            {interactive &&
              placed.map((p) => {
                const bx = p.flip > 0 ? [p.art.box.l, p.art.box.r] : [-p.art.box.r, -p.art.box.l]
                const top = p.seat === "behind" ? p.art.box.t : p.art.box.t
                const bottom = p.seat === "behind" ? -30 : p.art.box.b
                return (
                  <rect
                    key={"hit" + p.i}
                    className="dcf-hit"
                    x={p.x + bx[0] * p.scale}
                    y={p.y + top * p.scale}
                    width={(bx[1] - bx[0]) * p.scale}
                    height={(bottom - top) * p.scale}
                    rx={12}
                    role="button"
                    tabIndex={0}
                    aria-label={(p.m.name || p.m.kind) + (p.m.says ? ": " + p.m.says : "")}
                    onClick={() => poke(p.i)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        poke(p.i)
                      }
                    }}
                  />
                )
              })}
          </svg>

          <div className="dcf-bubbles" aria-live="polite">
            {placed.map((p) =>
              talking === p.i && p.m.says ? (
                <div
                  key={p.i}
                  className={"dcf-bubble" + (p.x > view.x + view.w * 0.72 ? " is-left" : "")}
                  style={{ left: pct(p.x, view.x, view.w), top: pct(p.y + p.art.box.t * p.scale - 6, view.y, view.h) }}
                >
                  {p.m.says}
                </div>
              ) : null,
            )}
          </div>
        </div>

        {doodleList.length > 0 && (
          <div className="dcf-doodles" aria-hidden="true">
            {doodleList.map((d, k) => (
              <div
                key={k}
                className="dcf-doodle"
                ref={(el) => void (doodleRefs.current[k] = el)}
                style={{ width: d.size, height: d.size, marginLeft: -d.size / 2, marginTop: -d.size / 2 }}
                onPointerDown={() => popDoodle(k)}
              >
                <span className="dcf-doodle-in" style={{ "--d": tl.doodles + k * 70 + "ms" } as React.CSSProperties}>
                  <svg viewBox="-16 -16 32 32" width={d.size} height={d.size}>
                    <Doodle kind={d.kind} />
                  </svg>
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="dcf-cta">
          <p className="dcf-tagline">
            {words.map((w, k) => (
              <span key={k} className="dcf-word" style={{ "--d": tl.word(k) + "ms" } as React.CSSProperties}>
                {w}{" "}
              </span>
            ))}
          </p>
          {actions.length > 0 && (
            <div className="dcf-actions">
              {actions.map((a, k) => {
                const inner = (
                  <>
                    {a.icon && <DoodleIcon kind={a.icon} />}
                    <span>{a.label}</span>
                  </>
                )
                const cls = "dcf-btn dcf-pop " + (a.variant === "outline" ? "is-outline" : "is-solid")
                const st = { "--d": tl.action(k) + "ms" } as React.CSSProperties
                return a.href ? (
                  <a key={a.label} className={cls} style={st} href={a.href} onClick={a.onClick}>
                    {inner}
                  </a>
                ) : (
                  <button key={a.label} type="button" className={cls} style={st} onClick={a.onClick}>
                    {inner}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div className="dcf-bar dcf-rise" style={{ "--d": "120ms" } as React.CSSProperties}>
        <p className="dcf-copy">{copyright}</p>
        {legal.length > 0 && (
          <ul className="dcf-inline">
            {legal.map((l) => (
              <li key={l.label}>
                <Link link={l} className="dcf-link" />
              </li>
            ))}
          </ul>
        )}
        {socials.length > 0 && (
          <ul className="dcf-inline dcf-socials">
            {socials.map((l) => (
              <li key={l.label}>
                <Link link={l} className="dcf-link" />
              </li>
            ))}
          </ul>
        )}
        {backToTop && (
          <button type="button" className="dcf-totop" onClick={toTop}>
            <span>Voltar ao topo</span>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M12 20 C11 14 12.5 9 12 4 M6 10 C8 8 10 6 12 4 C14 6 16 8 18.5 9.5" />
            </svg>
          </button>
        )}
      </div>
    </footer>
  )
}

const CSS =
  ".dcf{position:relative;isolation:isolate;overflow:hidden;overflow:clip;width:100%;box-sizing:border-box;display:flex;flex-direction:column;background:var(--dcf-bg);color:var(--dcf-ink);font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Inter,Roboto,sans-serif;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;--dcf-soft:color-mix(in oklab,var(--dcf-ink) 62%,var(--dcf-bg));--dcf-line:color-mix(in oklab,var(--dcf-ink) 14%,var(--dcf-bg));--dcf-pad:clamp(16px,4vw,56px)}" +
  ":where(.dcf) *,:where(.dcf) *::before,:where(.dcf) *::after{box-sizing:border-box}" +
  ":where(.dcf) a{color:inherit;text-decoration:none}" +
  ":where(.dcf) button{appearance:none;background:none;border:0;padding:0;margin:0;font:inherit;color:inherit;cursor:pointer}" +
  ":where(.dcf) h2,:where(.dcf) h3,:where(.dcf) p,:where(.dcf) ul{margin:0;padding:0}" +
  ":where(.dcf) ul{list-style:none}" +
  ".dcf svg{max-width:none;overflow:visible}" +
  ".dcf :focus-visible{outline:2px dashed var(--dcf-ink);outline-offset:4px;border-radius:6px}" +
  ".dcf-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}" +
  // top band
  ".dcf-top{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,2fr);grid-template-rows:auto 1fr;column-gap:clamp(24px,5vw,80px);row-gap:14px;padding:clamp(28px,4.5vw,56px) var(--dcf-pad) 0;max-width:1360px;width:100%;margin:0 auto;position:relative;z-index:3}" +
  ".dcf-brand{display:flex;align-items:center;gap:10px;grid-column:1;grid-row:1}" +
  ".dcf-logo{display:grid;place-items:center;width:40px;height:40px;border-radius:999px;border:2px solid var(--dcf-ink);background:var(--dcf-bg);transform:rotate(-6deg);transition:transform .35s cubic-bezier(.3,1.6,.5,1)}" +
  ".dcf-brand:hover .dcf-logo{transform:rotate(8deg) scale(1.06)}" +
  ".dcf-brandname{font-weight:800;font-size:19px;letter-spacing:-.02em}" +
  ".dcf-blurb{grid-column:1;grid-row:2;font-family:var(--dcf-serif);font-size:15px;line-height:1.55;color:var(--dcf-soft);max-width:34ch}" +
  ".dcf-cols{grid-column:2;grid-row:1/span 2;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:20px}" +
  ".dcf-coltitle{font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;margin-bottom:12px}" +
  ".dcf-col li{margin:0 0 7px}" +
  ".dcf-link{position:relative;display:inline-block;font-size:14px;font-weight:550;color:var(--dcf-soft);padding:2px 0;transition:color .2s}" +
  ".dcf-link:hover{color:var(--dcf-ink)}" +
  ".dcf-squiggle{position:absolute;left:-2px;right:-2px;bottom:-4px;width:calc(100% + 4px);height:7px;pointer-events:none}" +
  ".dcf-squiggle path{fill:none;stroke:var(--dcf-accent);stroke-width:2.2;stroke-linecap:round;stroke-dasharray:1;stroke-dashoffset:1;transition:stroke-dashoffset .35s cubic-bezier(.4,0,.2,1)}" +
  ".dcf-link:hover .dcf-squiggle path,.dcf-link:focus-visible .dcf-squiggle path{stroke-dashoffset:0}" +
  // world
  ".dcf-world{position:relative;flex:1;display:flex;flex-direction:column;justify-content:flex-end;padding:clamp(22px,4vw,48px) var(--dcf-pad) 0;max-width:1360px;width:100%;margin:0 auto}" +
  ".dcf-stage{position:relative;z-index:1}" +
  ".dcf-svg{display:block;width:100%;height:auto;user-select:none;-webkit-user-select:none}" +
  ".dcf-svg text{fill:var(--dcf-ink)}" +
  ".dcf-art{fill:var(--dcf-bg);stroke:var(--dcf-ink);stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}" +
  ".dcf-art .n{fill:none}.dcf-art .k{fill:var(--dcf-ink)}.dcf-art .a{fill:var(--dcf-accent)}.dcf-art .o{fill:#ff9f1c}.dcf-art .r{fill:#ff4d4d}" +
  ".dcf-art .thin{stroke-width:1.5}.dcf-art .thick{stroke-width:3.4}" +
  ".dcf-art .dcf-glint{fill:var(--dcf-bg);stroke:none}" +
  ".dcf-art .dcf-shadow{fill:var(--dcf-ink);stroke:none;opacity:.14}" +
  ".dcf-ground path{fill:none;stroke:var(--dcf-ink);stroke-width:2.4;stroke-linecap:round}" +
  ".dcf-ground .dcf-tufts{stroke-width:1.8}" +
  ".dcf-pebble{fill:var(--dcf-bg);stroke:var(--dcf-ink);stroke-width:1.6}" +
  ".dcf-dust{fill:none;stroke:var(--dcf-ink);stroke-width:3;stroke-linecap:round;opacity:0}" +
  ".dcf-hit{fill:transparent;stroke:none;cursor:pointer;outline:none}" +
  ".dcf-hit:focus-visible{stroke:var(--dcf-ink);stroke-width:2.5;stroke-dasharray:6 6}" +
  ".dcf-glyph{transform-box:fill-box;transform-origin:50% 100%}" +
  ".dcf[data-interactive='1'] .dcf-glyph:hover{animation:dcf-jiggle .6s cubic-bezier(.3,1.5,.5,1)}" +
  ".dcf-hopper{transform-box:fill-box;transform-origin:50% 100%}" +
  ".dcf-hopper.is-hop{animation:dcf-hop .62s cubic-bezier(.3,.7,.4,1)}" +
  ".dcf-arrive{transform-box:fill-box;transform-origin:50% 100%}" +
  // bubbles
  ".dcf-bubbles{position:absolute;inset:0;pointer-events:none;z-index:2}" +
  ".dcf-bubble{position:absolute;transform:translate(-50%,-100%) rotate(-2deg);transform-origin:50% 100%;background:var(--dcf-bg);color:var(--dcf-ink);border:2px solid var(--dcf-ink);border-radius:16px;padding:7px 12px;font-size:13px;font-weight:700;line-height:1.25;white-space:nowrap;box-shadow:3px 3px 0 var(--dcf-ink);animation:dcf-bubble .32s cubic-bezier(.3,1.6,.5,1) both;margin-top:-4px}" +
  ".dcf-bubble::after{content:'';position:absolute;left:50%;bottom:-9px;width:14px;height:14px;background:var(--dcf-bg);border-right:2px solid var(--dcf-ink);border-bottom:2px solid var(--dcf-ink);transform:translateX(-50%) rotate(45deg) skew(8deg,8deg)}" +
  ".dcf-bubble.is-left{transform:translate(-88%,-100%) rotate(2deg);transform-origin:88% 100%}" +
  ".dcf-bubble.is-left::after{left:88%}" +
  // doodles
  ".dcf-doodles{position:absolute;inset:0;pointer-events:none;z-index:2;overflow:hidden}" +
  ".dcf-doodle{position:absolute;left:0;top:0;pointer-events:auto;cursor:pointer;will-change:transform;touch-action:manipulation}" +
  ".dcf-doodle-in{display:block;width:100%;height:100%}" +
  ".dcf[data-interactive='0'] .dcf-doodle{pointer-events:none}" +
  ".dcf-doodle svg,.dcf-icon{display:block;stroke:var(--dcf-ink);stroke-width:1.9;stroke-linejoin:round;stroke-linecap:round}" +
  ".dcf-doodle svg{width:100%;height:100%;filter:drop-shadow(2px 2px 0 color-mix(in oklab,var(--dcf-ink) 18%,transparent))}" +
  ".dcf-paperfill{fill:var(--dcf-bg)}" +
  // cta
  ".dcf-cta{position:relative;z-index:3;display:flex;flex-direction:column;align-items:center;gap:20px;padding:clamp(20px,3vw,34px) 0 clamp(30px,4vw,48px);text-align:center}" +
  ".dcf-tagline{font-family:var(--dcf-serif);font-size:clamp(17px,1.9vw,22px);line-height:1.4;letter-spacing:-.005em;max-width:44ch;text-wrap:balance}" +
  ".dcf-word{display:inline-block;white-space:pre}" +
  ".dcf-actions{display:flex;flex-wrap:wrap;justify-content:center;gap:12px}" +
  ".dcf-btn{display:inline-flex;align-items:center;gap:8px;height:46px;padding:0 20px 0 16px;border-radius:999px;border:2px solid var(--dcf-ink);font-size:14.5px;font-weight:750;letter-spacing:-.01em;box-shadow:0 3px 0 var(--dcf-ink);transition:transform .18s cubic-bezier(.3,1.4,.5,1),box-shadow .18s cubic-bezier(.3,1.4,.5,1)}" +
  ".dcf-btn.is-outline{background:var(--dcf-bg);color:var(--dcf-ink)}" +
  ".dcf-btn.is-solid{background:var(--dcf-ink);color:var(--dcf-bg);box-shadow:0 3px 0 var(--dcf-accent)}" +
  ".dcf-btn.is-solid .dcf-icon{stroke:var(--dcf-bg)}" +
  ".dcf-btn:hover{transform:translateY(-2px) rotate(-1.2deg);box-shadow:0 5px 0 var(--dcf-ink)}" +
  ".dcf-btn.is-solid:hover{box-shadow:0 5px 0 var(--dcf-accent)}" +
  ".dcf-btn:active{transform:translateY(2px);box-shadow:0 1px 0 var(--dcf-ink);transition-duration:.06s}" +
  ".dcf-btn.is-solid:active{box-shadow:0 1px 0 var(--dcf-accent)}" +
  ".dcf-btn:hover .dcf-icon{animation:dcf-wiggle .5s ease-in-out}" +
  // bar
  ".dcf-bar{position:relative;z-index:3;display:flex;flex-wrap:wrap;align-items:center;gap:10px 26px;padding:18px var(--dcf-pad) 22px;max-width:1360px;width:100%;margin:0 auto;border-top:1.5px dashed var(--dcf-line);font-size:13px}" +
  ".dcf-copy{color:var(--dcf-soft);margin-right:auto}" +
  ".dcf-inline{display:flex;flex-wrap:wrap;gap:4px 18px}" +
  ".dcf-inline .dcf-link{font-size:13px}" +
  ".dcf-socials .dcf-link{color:var(--dcf-ink);font-weight:700}" +
  ".dcf-totop{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:700;padding:6px 12px;border-radius:999px;border:1.5px solid var(--dcf-ink);transition:transform .2s cubic-bezier(.3,1.5,.5,1)}" +
  ".dcf-totop svg{fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}" +
  ".dcf-totop:hover{transform:translateY(-2px)}" +
  ".dcf-totop:hover svg{animation:dcf-up .6s ease-in-out infinite}" +
  // storyboard: hidden until play, then each piece runs at its own --d
  ".dcf[data-play='0'] .dcf-letter,.dcf[data-play='0'] .dcf-arrive,.dcf[data-play='0'] .dcf-word,.dcf[data-play='0'] .dcf-pop,.dcf[data-play='0'] .dcf-rise,.dcf[data-play='0'] .dcf-fade,.dcf[data-play='0'] .dcf-doodle-in{opacity:0}" +
  ".dcf[data-play='0'] .dcf-draw{stroke-dasharray:1;stroke-dashoffset:1}" +
  ".dcf-letter{transform-box:fill-box;transform-origin:50% 100%}" +
  ".dcf[data-play='1'] .dcf-letter{animation:dcf-stamp .62s cubic-bezier(.2,.8,.25,1.15) var(--d) both}" +
  ".dcf[data-play='1'] .dcf-dust{animation:dcf-dust .5s ease-out calc(var(--d) + .22s) both}" +
  ".dcf[data-play='1'] .dcf-draw{stroke-dasharray:1;animation:dcf-draw 1.1s cubic-bezier(.6,0,.3,1) var(--d) both}" +
  ".dcf[data-play='1'] .dcf-fade{animation:dcf-fade .6s ease-out var(--d) both}" +
  ".dcf[data-play='1'] .dcf-arrive-front{animation:dcf-rise-up .75s cubic-bezier(.3,1.5,.5,1) var(--d) both}" +
  ".dcf[data-play='1'] .dcf-arrive-top{animation:dcf-plop .8s cubic-bezier(.3,.9,.4,1) var(--d) both}" +
  ".dcf[data-play='1'] .dcf-arrive-behind{animation:dcf-peek .9s cubic-bezier(.3,1.4,.5,1) var(--d) both}" +
  ".dcf[data-play='1'] .dcf-word{animation:dcf-word .6s cubic-bezier(.2,.8,.3,1) var(--d) both}" +
  ".dcf[data-play='1'] .dcf-pop{animation:dcf-popin .55s cubic-bezier(.3,1.6,.5,1) var(--d) both}" +
  ".dcf[data-play='1'] .dcf-rise{animation:dcf-fadeup .7s cubic-bezier(.2,.8,.3,1) var(--d) both}" +
  ".dcf[data-play='1'] .dcf-doodle-in{animation:dcf-fade .6s ease-out var(--d) both}" +
  "@keyframes dcf-stamp{0%{opacity:0;transform:translateY(-34%) scale(1.28) rotate(var(--r))}55%{opacity:1;transform:translateY(2%) scale(.95,1.05) rotate(0deg)}75%{transform:translateY(0) scale(1.04,.95)}100%{opacity:1;transform:none}}" +
  "@keyframes dcf-dust{0%{opacity:0;stroke-dasharray:0 40}30%{opacity:.9}100%{opacity:0;stroke-dasharray:14 40;stroke-dashoffset:-16}}" +
  "@keyframes dcf-draw{to{stroke-dashoffset:0}}" +
  "@keyframes dcf-fade{from{opacity:0}to{opacity:1}}" +
  "@keyframes dcf-rise-up{0%{opacity:0;transform:translateY(30%) scale(.7,.3)}45%{opacity:1;transform:translateY(-8%) scale(.92,1.12)}70%{transform:translateY(0) scale(1.08,.92)}100%{opacity:1;transform:none}}" +
  "@keyframes dcf-plop{0%{opacity:0;transform:translateY(-90%)}50%{opacity:1;transform:translateY(0) scale(1.1,.86)}68%{transform:translateY(-10%) scale(.96,1.04)}84%{transform:translateY(0) scale(1.03,.97)}100%{opacity:1;transform:none}}" +
  "@keyframes dcf-peek{0%{opacity:0;transform:translateY(55%)}60%{opacity:1;transform:translateY(-6%)}100%{opacity:1;transform:none}}" +
  "@keyframes dcf-word{from{opacity:0;transform:translateY(.6em) rotate(3deg)}to{opacity:1;transform:none}}" +
  "@keyframes dcf-popin{0%{opacity:0;transform:translateY(10px) scale(.6) rotate(-4deg)}100%{opacity:1;transform:none}}" +
  "@keyframes dcf-fadeup{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}" +
  "@keyframes dcf-jiggle{0%{transform:none}25%{transform:rotate(-4deg) scale(1.03,.97)}50%{transform:rotate(3deg) translateY(-3%)}75%{transform:rotate(-1.5deg)}100%{transform:none}}" +
  "@keyframes dcf-hop{0%{transform:none}18%{transform:scale(1.12,.84)}45%{transform:translateY(-28%) scale(.94,1.08)}72%{transform:translateY(0) scale(1.1,.88)}86%{transform:scale(.97,1.03)}100%{transform:none}}" +
  "@keyframes dcf-bubble{from{opacity:0;scale:.6}to{opacity:1;scale:1}}" +
  "@keyframes dcf-wiggle{0%,100%{transform:none}30%{transform:rotate(-14deg) scale(1.15)}60%{transform:rotate(10deg)}}" +
  "@keyframes dcf-up{0%,100%{transform:none}50%{transform:translateY(-3px)}}" +
  "@media (max-width:860px){.dcf-top{grid-template-columns:1fr;grid-template-rows:auto}.dcf-brand,.dcf-blurb,.dcf-cols{grid-column:1;grid-row:auto}.dcf-cols{grid-template-columns:repeat(2,minmax(0,1fr));margin-top:14px;row-gap:22px}.dcf-copy{width:100%;margin-right:0}}" +
  "@media (max-width:480px){.dcf-btn{height:42px;font-size:13.5px;padding:0 16px 0 13px}.dcf-bubble{font-size:12px;padding:6px 10px}.dcf-totop span{display:none}}" +
  "@media (prefers-reduced-motion:reduce){.dcf *,.dcf *::before,.dcf *::after{animation:none!important;transition:none!important}.dcf .dcf-letter,.dcf .dcf-arrive,.dcf .dcf-word,.dcf .dcf-pop,.dcf .dcf-rise,.dcf .dcf-fade,.dcf .dcf-doodle-in{opacity:1!important}.dcf .dcf-draw{stroke-dashoffset:0!important}.dcf .dcf-dust{opacity:0!important}}"
