// Time-sortable identifiers: <prefix>_<8 chars base32 time><10 chars random>.

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

function randomChars(n: number): string {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b & 31];
  return out;
}

let last = 0;

/** Strictly increasing within a session, so ids double as a creation-order tiebreaker. */
export function newId(prefix: string): string {
  const t = Math.max(Date.now(), last + 1);
  last = t;
  let time = "";
  let v = t;
  for (let i = 0; i < 9; i++) {
    time = ALPHABET[v % 32] + time;
    v = Math.floor(v / 32);
  }
  return `${prefix}_${time}${randomChars(9)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Local calendar date as YYYY-MM-DD (review dates are calendar days, not instants). */
export function todayLocal(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
