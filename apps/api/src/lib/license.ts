export type LicenseStatus = "trial" | "active" | "expired" | "suspended";
export type LicenseState = "trial" | "active" | "grace" | "read_only" | "suspended";

const GRACE_DAYS = 7;

export function licenseState(
  license: { status: LicenseStatus; validUntil: Date | null },
  now: Date,
  graceDays = GRACE_DAYS,
): LicenseState {
  if (license.status === "suspended") return "suspended";
  if (license.validUntil == null) return license.status === "trial" ? "trial" : "active";
  if (license.validUntil >= now) return license.status === "trial" ? "trial" : "active";
  const graceEnd = license.validUntil.getTime() + graceDays * 86_400_000;
  return now.getTime() <= graceEnd ? "grace" : "read_only";
}

export function formatLicenseNumber(year: number, seed: string): string {
  const clean = seed.toUpperCase().replace(/[^A-Z0-9]/g, "").padEnd(12, "0").slice(0, 12);
  return `DOCID-${year}-${clean.slice(0, 4)}-${clean.slice(4, 8)}-${clean.slice(8, 12)}`;
}
