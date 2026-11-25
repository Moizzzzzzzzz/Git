import { DEV_DEFAULT_FOUR_POINT_RULES } from '@fabricqc/shared';
import { QualityService } from './quality.service';

it('new frozen customer source uses customer rules only while legacy preserves combined decisions', () => {
  const customer = { ...DEV_DEFAULT_FOUR_POINT_RULES, formalProfile: 'YONGSHENG_2026', thresholds: { maxNormalizedPoints: 100 } };
  const factory = { ...DEV_DEFAULT_FOUR_POINT_RULES, formalProfile: 'YONGSHENG_2026', thresholds: { maxNormalizedPoints: 0 } };
  const snapshot = { fourPoint: { versionId: 'f', name: 'factory', version: 1, isDevDefault: false, rules: factory }, customer: { versionId: 'c', name: 'customer', version: 1, isDevDefault: false, rules: customer } };
  const data = { scope: 'FULL' as const, segments: [{ startM: 0, endM: 91.44 }], defects: [{ clientId: 'd', defectTypeCode: 'SLUB', lengthCm: 30, positionM: 0, severity: 'MINOR' as const }], measurements: [], checklist: [], templateChecklist: [] };
  const spec = { fabricCode: '', fabricName: '', rollNo: '', widthCm: 152.4 };
  const service = new QualityService();
  const formal = service.evaluate({ ...snapshot, ruleSource: 'CUSTOMER' }, spec, data);
  expect(formal.fourPoint.name).toContain('customer'); expect(formal.overall.result).toBe('PASS'); expect(formal.customer).toBeNull();
  const legacy = service.evaluate(snapshot, spec, data);
  expect(legacy.fourPoint.name).toContain('factory'); expect(legacy.overall.result).toBe('FAIL'); expect(legacy.customer).not.toBeNull();
});
