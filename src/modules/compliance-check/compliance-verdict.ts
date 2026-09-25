import { ComplianceCheckType, ComplianceResult } from '@prisma/client';

/**
 * BR-42 "all-or-nothing": a package passes compliance only when every check
 * type below has PASS as its latest decided result. Any FAIL fails the package;
 * a missing or undecided type keeps it PENDING.
 */
export const REQUIRED_COMPLIANCE_CHECKS: ComplianceCheckType[] = Object.values(ComplianceCheckType);

// Evaluated by the system from the labels attached to the package, never by hand.
export const AUTO_CHECKED: ComplianceCheckType[] = [ComplianceCheckType.AI_LABEL_PRESENCE];

export interface ComplianceCheckLike {
  checkType: ComplianceCheckType;
  result: ComplianceResult;
  checkedAt: Date | null;
}

export function latestByType<T extends ComplianceCheckLike>(checks: T[]): Map<ComplianceCheckType, T> {
  const latest = new Map<ComplianceCheckType, T>();
  for (const check of checks) {
    const current = latest.get(check.checkType);
    const newer = !current || (check.checkedAt?.getTime() ?? 0) >= (current.checkedAt?.getTime() ?? 0);
    if (newer) latest.set(check.checkType, check);
  }
  return latest;
}

export function complianceVerdict(checks: ComplianceCheckLike[]): ComplianceResult {
  const latest = latestByType(checks);
  const results = REQUIRED_COMPLIANCE_CHECKS.map((type) => latest.get(type)?.result ?? ComplianceResult.PENDING);
  if (results.includes(ComplianceResult.FAIL)) return ComplianceResult.FAIL;
  if (results.includes(ComplianceResult.PENDING)) return ComplianceResult.PENDING;
  return ComplianceResult.PASS;
}
