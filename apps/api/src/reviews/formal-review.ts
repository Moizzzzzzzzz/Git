type FrozenCheck = { code?: string; status?: string; message?: string };
type FrozenResult = { fourPoint?: { checks?: FrozenCheck[] }; customer?: { checks?: FrozenCheck[] } | null } | null;
const REVIEWABLE = new Set(['SEVERITY', 'MAX_NORMALIZED_POINTS', 'CHECKLIST:color_match', 'CHECKLIST:knit_surface', 'CHECKLIST:woven_surface', 'CHECKLIST:edge_quality']);
const isReviewable = (c: FrozenCheck) => Boolean(c.code && REVIEWABLE.has(c.code) && (c.code === 'MAX_NORMALIZED_POINTS' ? c.status === 'FAIL' : c.status === 'INCONCLUSIVE'));
/** Only frozen system checks, never client input, define the scope of an override. */
export function formalReviewEligibility(result: FrozenResult) {
  const all = [...(result?.fourPoint?.checks ?? []), ...(result?.customer?.checks ?? [])];
  const valid = all.every(c => typeof c.code === 'string' && c.code.length > 0 && ['PASS', 'FAIL', 'INCONCLUSIVE'].includes(c.status ?? ''));
  const checks = all.filter(c => c.status === 'FAIL' || c.status === 'INCONCLUSIVE');
  const reasons = checks.filter(isReviewable).map(c => ({ code: c.code!, message: c.message ?? '' }));
  return { required: reasons.length > 0, allowed: valid && reasons.length > 0 && checks.every(isReviewable), reasons };
}
