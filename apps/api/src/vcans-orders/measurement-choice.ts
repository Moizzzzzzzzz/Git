interface Measurement { value: string | null; at: Date | null }
/** Orders recorded values by entry/submission time, not by unrecorded physical measurement time. */
export function chooseMeasuredLength(manual: Measurement, inspection: Measurement) {
  if (manual.value === null && inspection.value === null) return { value: null, source: null, at: null };
  const useInspection = inspection.value !== null && (manual.value === null || (inspection.at !== null && (manual.at === null || inspection.at > manual.at)));
  return useInspection ? { value: inspection.value, source: 'INSPECTION_SUBMISSION' as const, at: inspection.at } : { value: manual.value, source: 'MANUAL_ENTRY' as const, at: manual.at };
}
