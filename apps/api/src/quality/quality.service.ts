import { Injectable } from '@nestjs/common';
import {
  evaluateInspection,
  type EngineSpec,
  type EngineStandard,
  type EvaluationInput,
  type InspectionEvaluation,
} from '@fabricqc/quality-engine';
import { standardRulesSchema, type InspectionScope } from '@fabricqc/shared';

/** 检验开始时保存的标准快照结构 */
export interface StandardSnapshot {
  fourPoint: { versionId: string; name: string; version: number; isDevDefault: boolean; rules: unknown };
  customer: { versionId: string; name: string; version: number; isDevDefault: boolean; rules: unknown } | null;
}

export interface SpecSnapshot extends EngineSpec {
  fabricCode: string;
  fabricName: string;
  rollNo: string;
  [k: string]: unknown;
}

export interface EvaluationData {
  scope: InspectionScope;
  segments: { startM: number; endM: number }[];
  defects: EvaluationInput['defects'];
  measurements: EvaluationInput['measurements'];
}

/**
 * 质量规则服务：把快照数据转换为引擎输入并调用纯函数引擎。
 * 所有判定都基于检验开始时的快照，标准后续修改不影响已有检验。
 */
@Injectable()
export class QualityService {
  private toStandard(s: StandardSnapshot['fourPoint']): EngineStandard {
    return { versionId: s.versionId, name: `${s.name} v${s.version}`, rules: standardRulesSchema.parse(s.rules) };
  }

  evaluate(snapshot: StandardSnapshot, spec: SpecSnapshot, data: EvaluationData): InspectionEvaluation {
    return evaluateInspection({
      scope: data.scope,
      segments: data.segments,
      defects: data.defects,
      measurements: data.measurements,
      spec: {
        widthCm: spec.widthCm ?? null,
        cuttableWidthCm: spec.cuttableWidthCm ?? null,
        gsm: spec.gsm ?? null,
        nominalLengthM: spec.nominalLengthM ?? null,
      },
      fourPoint: this.toStandard(snapshot.fourPoint),
      customer: snapshot.customer ? this.toStandard(snapshot.customer) : null,
    });
  }

  requireDefectPhoto(snapshot: StandardSnapshot): boolean {
    const parts = [snapshot.fourPoint, ...(snapshot.customer ? [snapshot.customer] : [])];
    return parts.some((p) => standardRulesSchema.parse(p.rules).requireDefectPhoto);
  }
}
