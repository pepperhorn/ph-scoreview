import assert from 'node:assert/strict';

/** Explicit opt-in for a loaded local host; the shared multiplier defaults to 1 everywhere. */
export const budgetScale = Number(process.env.VALIDATION_BUDGET_SCALE ?? 1);
if (!Number.isFinite(budgetScale) || budgetScale <= 0) {
  throw new Error('VALIDATION_BUDGET_SCALE must be a finite positive number');
}

export function assertTiming(condition, message) {
  const hint = process.env.CI ? '' : ` Loaded host? Re-run with VALIDATION_BUDGET_SCALE greater than ${budgetScale} (current ${budgetScale}); CI budgets remain the baseline.`;
  assert.ok(condition, message + hint);
}
