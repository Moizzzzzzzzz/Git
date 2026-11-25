export function vcansFabricFallback(line: { productCode: string | null; productName: string | null; specification: string | null; color: string | null } | null) {
  return { fabricCode: line?.productCode ?? '', fabricName: line?.productName ?? '', specification: line?.specification ?? null, color: line?.color ?? null };
}
export function vcansSelectionAllowsInspection(kinds: readonly string[] | null): boolean {
  return kinds === null || kinds.some((kind) => kind === 'ORIGINAL' || kind === 'ADDITIONAL');
}
