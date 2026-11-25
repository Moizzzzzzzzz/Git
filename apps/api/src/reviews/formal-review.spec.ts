import { formalReviewEligibility } from './formal-review';

it('allows only specifically authorised frozen reasons and blocks overriding other failures', () => {
  const check = (code: string, status: string) => ({ code, status, message: code });
  expect(formalReviewEligibility({ fourPoint: { checks: [check('SEVERITY', 'INCONCLUSIVE'), check('MAX_NORMALIZED_POINTS', 'FAIL')] } })).toMatchObject({ required: true, allowed: true });
  expect(formalReviewEligibility({ fourPoint: { checks: [check('SEVERITY', 'INCONCLUSIVE'), check('MEASUREMENT:effective_width', 'FAIL')] } })).toMatchObject({ required: true, allowed: false });
  expect(formalReviewEligibility({ fourPoint: { checks: [check('MEASUREMENT:effective_width', 'FAIL')] } })).toMatchObject({ required: false, allowed: false });
  expect(formalReviewEligibility({ fourPoint: { checks: [check('MAX_NORMALIZED_POINTS', 'INCONCLUSIVE')] } })).toMatchObject({ required: false, allowed: false });
  expect(formalReviewEligibility({ fourPoint: { checks: [check('CHECKLIST:color_match', 'INCONCLUSIVE')] } }).reasons).toEqual([{ code: 'CHECKLIST:color_match', message: 'CHECKLIST:color_match' }]);
  for (const code of ['CHECKLIST:knit_surface', 'CHECKLIST:woven_surface', 'CHECKLIST:edge_quality']) expect(formalReviewEligibility({ fourPoint: { checks: [check(code, 'INCONCLUSIVE')] } }).allowed).toBe(true);
});
