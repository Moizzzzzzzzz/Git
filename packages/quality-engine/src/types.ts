import type {
  AreaUnit,
  DefectSeverity,
  InspectionScope,
  JudgeResult,
  StandardRules,
} from '@fabricqc/shared';

export interface EngineDefect {
  clientId: string;
  defectTypeCode: string;
  lengthCm: number;
  widthCm?: number | null;
  positionM: number;
  severity: DefectSeverity;
}

export interface EngineMeasurement {
  itemKey: string;
  seq: number;
  value: number;
}

/** 检验开始时快照的面料 / 布卷规格 */
export interface EngineSpec {
  widthCm?: number | null;
  cuttableWidthCm?: number | null;
  gsm?: number | null;
  nominalLengthM?: number | null;
}

export interface EngineStandard {
  versionId: string;
  name: string;
  rules: StandardRules;
}

export interface EvaluationInput {
  scope: InspectionScope;
  segments: { startM: number; endM: number }[];
  defects: EngineDefect[];
  measurements: EngineMeasurement[];
  spec: EngineSpec;
  fourPoint: EngineStandard;
  customer?: EngineStandard | null;
}

export type CheckStatus = 'PASS' | 'FAIL' | 'INCONCLUSIVE';

export interface RuleCheck {
  code: string;
  label: string;
  status: CheckStatus;
  actual?: string | number | null;
  limit?: string | number | null;
  message: string;
}

export interface DefectScore {
  clientId: string;
  defectTypeCode: string;
  /** 未封顶前该疵点计分 */
  points: number;
  /** 计分依据说明 */
  rule: string;
}

export interface ScoringResult {
  areaUnit: AreaUnit;
  linearUnitM: number;
  defectScores: DefectScore[];
  rawPoints: number;
  /** 按线性单位封顶后的总分 */
  totalPoints: number;
  capReduction: number;
  normalizedPoints: number | null;
}

export interface StandardEvaluation {
  versionId: string;
  name: string;
  result: JudgeResult;
  scoring: ScoringResult;
  checks: RuleCheck[];
}

export type WidthBasis = 'MEASURED_EFFECTIVE' | 'SPEC_CUTTABLE' | 'SPEC_WIDTH' | 'NONE';

export interface InspectionEvaluation {
  engineVersion: string;
  scope: InspectionScope;
  inspectedLengthM: number;
  widthUsedCm: number | null;
  widthBasis: WidthBasis;
  inspectedAreaM2: number | null;
  defectCount: number;
  fourPoint: StandardEvaluation;
  customer: StandardEvaluation | null;
  overall: { result: JudgeResult; reasons: string[] };
  warnings: string[];
}
