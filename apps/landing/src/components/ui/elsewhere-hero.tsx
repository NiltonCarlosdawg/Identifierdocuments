import { useEffect, useState, type CSSProperties } from "react";

/**
 * Elsewhere — a full-viewport hero block adapted for DocID.
 * One background photograph cross-fades between a day and a night grade,
 * the headline rises in on mount, and a bottom-left toggle flips the grade.
 * No video files are bundled: the stock photo is self-hosted (public/hero.jpg),
 * and both grades are pure CSS filters on the same image.
 */

export interface ElsewhereLink {
  label: string;
  href: string;
}

export interface ElsewhereHeroProps {
  /** Self-hosted photograph; used for both grades. */
  image: string;
  eyebrow?: string;
  headline: string;
  subline?: string;
  primaryCta: ElsewhereLink;
  secondaryCta?: ElsewhereLink;
  /** Tiny line under the buttons: version, size, anything short. */
  caption?: string;
  objectPosition?: string;
  className?: string;
}

const SANS = "Archivo, Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const COL_TEXT = "#eef1f6";

export default function ElsewhereHero({
  image,
  eyebrow,
  headline,
  subline,
  primaryCta,
  secondaryCta,
  caption,
  objectPosition = "50% 40%",
  className,
}: ElsewhereHeroProps) {
  const [isNight, setIsNight] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq.matches) {
      setShown(true);
      return;
    }
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Each line of the headline area rises in, a beat after the one before.
  const rise = (i: number): CSSProperties => ({
    opacity: shown ? 1 : 0,
    transform: shown ? "none" : "translateY(14px)",
    transition: `opacity 1s ease ${0.15 + i * 0.12}s, transform 1s cubic-bezier(.2,.7,.2,1) ${0.15 + i * 0.12}s`,
  });

  return (
    <section
      id="topo"
      className={className}
      aria-label="DocID"
      style={{
        position: "relative",
        height: "100dvh",
        minHeight: 560,
        width: "100%",
        overflow: "hidden",
        background: "#0a0d08",
        fontFamily: SANS,
        color: COL_TEXT,
      }}
    >
      <style>{css}</style>

      {/* BACKGROUND — day grade over night grade, cross-faded */}
      <img
        src={image}
        alt=""
        aria-hidden="true"
        className="ew-bg"
        style={{ objectPosition, opacity: isNight ? 0 : 1, filter: "brightness(.58) saturate(1.02)" }}
      />
      <img
        src={image}
        alt=""
        aria-hidden="true"
        className="ew-bg"
        style={{ objectPosition, opacity: isNight ? 1 : 0, filter: "brightness(.3) saturate(.78) contrast(1.03)" }}
      />

      {/* CINEMATIC OVERLAY */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: isNight
            ? "radial-gradient(ellipse 92% 66% at 50% 36%, rgba(6,9,18,0.62), transparent 78%), linear-gradient(180deg, rgba(6,9,18,0.66), rgba(6,9,18,0.46) 42%, rgba(6,9,18,0.38) 66%, rgba(6,9,18,0.72))"
            : "radial-gradient(ellipse 92% 66% at 50% 36%, rgba(6,10,16,0.6), transparent 78%), linear-gradient(180deg, rgba(6,10,16,0.6), rgba(6,10,16,0.38) 42%, rgba(6,10,16,0.32) 66%, rgba(6,10,16,0.66))",
          transition: "background 1.2s ease",
          pointerEvents: "none",
        }}
      />

      {/* HEADLINE */}
      <div className="ew-copy">
        {eyebrow && (
          <p className="ew-eyebrow" style={rise(0)}>
            {eyebrow}
          </p>
        )}
        <h1 className="ew-title" style={rise(1)}>
          {headline}
        </h1>
        {subline && (
          <p className="ew-sub" style={rise(2)}>
            {subline}
          </p>
        )}
        <div className="ew-ctas" style={rise(3)}>
          <a href={primaryCta.href} className="ew-pill ew-primary">
            {primaryCta.label}
          </a>
          {secondaryCta && (
            <a href={secondaryCta.href} className="ew-glass ew-pill">
              {secondaryCta.label}
            </a>
          )}
        </div>
        {caption && <p className="ew-caption" style={rise(4)}>{caption}</p>}
      </div>

      {/* DAY / NIGHT */}
      <button
        type="button"
        onClick={() => setIsNight((value) => !value)}
        aria-pressed={isNight}
        aria-label={isNight ? "Mudar para o dia" : "Mudar para a noite"}
        style={iconButtonStyle}
        className="ew-daynight"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          {isNight ? (
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" stroke={COL_TEXT} strokeWidth="1.6" strokeLinejoin="round" />
          ) : (
            <>
              <circle cx="12" cy="12" r="4.5" stroke={COL_TEXT} strokeWidth="1.6" />
              <path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8 6 18M18 6l1.8-1.8" stroke={COL_TEXT} strokeWidth="1.6" strokeLinecap="round" />
            </>
          )}
        </svg>
      </button>
    </section>
  );
}

const iconButtonStyle: CSSProperties = {
  position: "absolute",
  left: "clamp(14px, 3vw, 28px)",
  bottom: "clamp(14px, 3vh, 28px)",
  width: "clamp(38px, 6vw, 44px)",
  height: "clamp(38px, 6vw, 44px)",
  borderRadius: "50%",
  border: "1px solid rgba(238,241,246,0.22)",
  background: "rgba(238,241,246,0.1)",
  backdropFilter: "blur(14px) saturate(150%)",
  WebkitBackdropFilter: "blur(14px) saturate(150%)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  padding: 0,
  color: COL_TEXT,
  zIndex: 2,
};

/* Scoped to class names starting with "ew-". */
const css = `
.ew-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transition:opacity 1.2s ease,filter 1.2s ease;z-index:0}
.ew-copy{position:absolute;left:0;right:0;top:clamp(76px,13vh,150px);z-index:2;display:flex;flex-direction:column;align-items:center;text-align:center;padding:0 20px}
.ew-eyebrow{display:inline-block;margin:0 auto 14px;background:rgba(6,10,16,.52);border:1px solid rgba(238,241,246,.12);border-radius:999px;padding:5px 12px;font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,monospace;font-size:clamp(10px,1.2vw,12px);letter-spacing:.16em;text-transform:uppercase;color:rgba(238,241,246,.72);text-shadow:0 1px 14px rgba(0,0,0,.4)}
.ew-title{margin:0;max-width:22ch;font-weight:600;font-size:clamp(2rem,5.6vw,4.4rem);line-height:1.02;letter-spacing:-.035em;color:#eef1f6;text-shadow:0 2px 32px rgba(0,0,0,.42);text-wrap:balance}
.ew-sub{margin:clamp(14px,2.2vh,22px) 0 0;max-width:48ch;font-size:clamp(15px,1.45vw,18px);line-height:1.55;font-weight:500;color:rgba(238,241,246,.94);text-shadow:0 1px 16px rgba(0,0,0,.45);text-wrap:pretty}
.ew-ctas{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;margin-top:clamp(20px,3.2vh,30px)}
.ew-pill{display:inline-flex;align-items:center;gap:8px;height:46px;padding:0 22px;border-radius:999px;font:inherit;font-size:15px;font-weight:500;text-decoration:none;cursor:pointer;transition:transform .25s ease,background .3s ease,border-color .3s ease}
.ew-pill:active{transform:scale(.97)}
.ew-primary{background:#eef1f6;color:#0b0d12;border:1px solid #eef1f6}
.ew-primary:hover{background:#ffffff}
.ew-glass{color:#eef1f6;border:1px solid rgba(238,241,246,.3);background:rgba(238,241,246,.16);backdrop-filter:blur(14px) saturate(150%);-webkit-backdrop-filter:blur(14px) saturate(150%)}
.ew-glass:hover{background:rgba(238,241,246,.18);border-color:rgba(238,241,246,.36)}
.ew-caption{margin:18px 0 0;display:inline-block;background:rgba(6,10,16,.58);border:1px solid rgba(238,241,246,.14);border-radius:999px;padding:5px 12px;font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,monospace;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:rgba(238,241,246,.66);text-shadow:0 1px 12px rgba(0,0,0,.4)}
.ew-daynight:hover{background:rgba(238,241,246,.18);border-color:rgba(238,241,246,.36)}
.ew-daynight:focus-visible,.ew-pill:focus-visible{outline:2px solid #eef1f6;outline-offset:3px}
@media (prefers-reduced-motion:reduce){.ew-bg{transition:none}.ew-pill{transition:none}}
`;
