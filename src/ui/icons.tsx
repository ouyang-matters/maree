import type { Status } from "../data/types";
import { STATUS_LABEL } from "../domain/status";
import { t } from "../i18n";

/** Status glyphs: one consistent family of 14px circle marks. */
export function StatusIcon({ status, size = 14, title }: { status: Status; size?: number; title?: string }) {
  const c = `var(--st-${status})`;
  const label = title ?? t(STATUS_LABEL[status]);
  return (
    <svg className="st-icon" width={size} height={size} viewBox="0 0 16 16" aria-label={label} role="img">
      <title>{label}</title>
      {status === "not_started" && <circle cx="8" cy="8" r="5.6" fill="none" stroke={c} strokeWidth="1.5" strokeDasharray="2.2 2" />}
      {status === "in_progress" && (
        <>
          <circle cx="8" cy="8" r="5.6" fill="none" stroke={c} strokeWidth="1.5" />
          <path d="M8 2.4 A5.6 5.6 0 0 1 8 13.6 Z" fill={c} />
        </>
      )}
      {status === "completed" && (
        <>
          <circle cx="8" cy="8" r="6.3" fill={c} />
          <path d="M5.1 8.2 7.1 10.1 10.9 6" fill="none" stroke="var(--bg-elev)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {status === "needs_review" && (
        <>
          <circle cx="8" cy="8" r="5.6" fill="none" stroke={c} strokeWidth="1.5" />
          <path d="M8 4.9v3.6" stroke={c} strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="8" cy="10.9" r="0.95" fill={c} />
        </>
      )}
      {status === "mastered" && (
        <>
          <circle cx="8" cy="8" r="6.3" fill={c} />
          <path d="M8 4.3 9.05 6.6 11.5 6.85 9.65 8.5 10.2 10.95 8 9.7 5.8 10.95 6.35 8.5 4.5 6.85 6.95 6.6Z" fill="var(--bg-elev)" />
        </>
      )}
    </svg>
  );
}

export function DifficultyMeter({ value }: { value: number | null }) {
  return (
    <span className="diff" aria-label={value ? t("Difficulty {n} of 4", { n: value }) : t("No difficulty")}>
      {[1, 2, 3, 4].map((i) => (
        <i key={i} className={value && i <= value ? "on" : ""} />
      ))}
    </span>
  );
}

/** The Marée glyph: a crescent over three tide lines. */
export function BrandGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg className="brand-glyph" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1.5" y="1.5" width="29" height="29" rx="7" fill="#b03a6c" />
      <path d="M6.2 16c2.2-1.94 4.4-1.94 6.56 0s4.38 1.94 6.56 0 4.38-1.94 6.56 0" fill="none" stroke="#fff" strokeWidth="2.9" strokeLinecap="round" />
    </svg>
  );
}

export function WaveRule({ width = 64 }: { width?: number }) {
  return (
    <svg className="wave" width={width} height="10" viewBox="0 0 64 10" aria-hidden="true">
      <path d="M1 5c5-4 10-4 15 0s10 4 15 0 10-4 15 0 10 4 15 0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
