export function scoreUnitFromSnapshot(snapshot: unknown): string | null {
  const value = (snapshot as { fourPoint?: { scoring?: { areaUnit?: unknown } } } | null)?.fourPoint?.scoring?.areaUnit;
  return value === 'PER_100_LINEAR_YD' ? '分/100线码' : value === 'PER_100_SQ_YD' ? '分/100平方码' : value === 'PER_100_SQ_M' ? '分/100平方米' : null;
}
