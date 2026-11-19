/**
 * Flags high-risk or sensitive file paths in an agent's branch diff so the
 * streamer sees a clear warning before merging.
 */

export type DiffRiskCategory = "secrets" | "ci" | "dependencies" | "auth";

export interface DiffRiskWarning {
  file: string;
  category: DiffRiskCategory;
  reason: string;
}

const RISK_RULES: Array<{
  category: DiffRiskCategory;
  match: (path: string) => boolean;
  reason: string;
}> = [
  {
    category: "secrets",
    match: (p) => /(^|\/)\.env(\.|$)/i.test(p) || /\.(pem|key|p12|pfx)$/i.test(p) || /(^|\/)secrets\.json$/i.test(p),
    reason: "Environment, key, or secret file modified",
  },
  {
    category: "ci",
    match: (p) =>
      p.startsWith(".github/workflows/") ||
      /(^|\/)(Dockerfile|docker-compose(\.[^/]+)?\.ya?ml)$/i.test(p),
    reason: "CI workflow or container definition modified",
  },
  {
    category: "dependencies",
    match: (p) => /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/i.test(p),
    reason: "Package manifest or lockfile modified",
  },
  {
    category: "auth",
    match: (p) => /(^|\/)(auth|security|permissions)\.(ts|tsx|js|mjs|cjs)$/i.test(p),
    reason: "Authentication or security module modified",
  },
];

/** Inspect changed file paths and return risk warnings in stable order. */
export function assessDiffRisk(changedFiles: readonly string[]): DiffRiskWarning[] {
  const warnings: DiffRiskWarning[] = [];
  for (const raw of changedFiles) {
    const file = raw.trim().replace(/\\/g, "/");
    if (!file) continue;
    for (const rule of RISK_RULES) {
      if (rule.match(file)) {
        warnings.push({ file, category: rule.category, reason: rule.reason });
        break;
      }
    }
  }
  return warnings;
}
