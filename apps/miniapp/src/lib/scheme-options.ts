import type {StandardRules} from '@fabricqc/shared';
export type SchemeApplicability=NonNullable<StandardRules['applicability']>;
export type SchemeFilter={structure:''|SchemeApplicability['structure'][number];fiber:''|SchemeApplicability['fiber'][number]};
type Scope={structure:readonly SchemeApplicability['structure'][number][];fiber:readonly SchemeApplicability['fiber'][number][]};
export const STRUCTURE_NAMES={KNIT:'针织',WOVEN:'梭织'};
export const FIBER_NAMES={POLYESTER:'涤纶',NYLON:'锦纶'};
export function schemeScopeText(scope:Scope|null|undefined){return scope?`${scope.structure.map(x=>STRUCTURE_NAMES[x]).join(' / ')} · ${scope.fiber.map(x=>FIBER_NAMES[x]).join(' / ')}`:'适用范围未标注';}
export function filterSchemes<T extends {applicability?:Scope|null}>(items:readonly T[],filter:SchemeFilter){return {matched:items.filter(x=>x.applicability&&(!filter.structure||x.applicability.structure.includes(filter.structure))&&(!filter.fiber||x.applicability.fiber.includes(filter.fiber))),unclassified:items.filter(x=>!x.applicability)};}
