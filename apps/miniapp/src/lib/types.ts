import type {
  DefectSeverity,
  InspectionMode,
  InspectionScope,
  InspectionStatus,
  JudgeResult,
  MediaKind,
  ReviewDecision,
  TemplateContent,
} from '@fabricqc/shared';
import type { InspectionEvaluation } from '@fabricqc/quality-engine';

export interface ServerPhoto {
  mediaId: string;
  kind: MediaKind;
  checkpointKey: string | null;
  defectClientId: string | null;
  url: string;
  thumbUrl: string | null;
}

export interface SnapshotStandard {
  versionId: string;
  name: string;
  version: number;
  isDevDefault: boolean;
  rules: unknown;
}

export interface InspectionDetail {
  id: string;
  inspectionNo: string;
  status: InspectionStatus;
  mode: InspectionMode;
  scope: InspectionScope;
  revision: number;
  draftVersion: number;
  roll: { id: string; rollNo: string; dyeLotNo: string | null; colorCode: string | null; nominalLengthM: number | null; fabric: { code: string; nameZh: string } };
  task: { id: string; taskNo: string; title: string };
  inspector: { name: string; employeeNo: string };
  spec: { widthCm?: number | null; cuttableWidthCm?: number | null; gsm?: number | null; nominalLengthM?: number | null; [k: string]: unknown };
  template: TemplateContent;
  standards: { fourPoint: SnapshotStandard; customer: SnapshotStandard | null };
  segments: { startM: number; endM: number }[];
  measurements: { itemKey: string; seq: number; value: number; unit: string }[];
  checklist: { key: string; status: 'OK' | 'NG' | 'NA'; note?: string | null }[];
  defects: { clientId: string; defectTypeCode: string; lengthCm: number; widthCm: number | null; positionM: number; widthPositionCm: number | null; severity: DefectSeverity; points: number | null; remark: string | null }[];
  photos: ServerPhoto[];
  remarks: string | null;
  result: InspectionEvaluation | null;
  overallResult: JudgeResult | null;
  submittedAt: string | null;
  reviews: { id: string; revision: number; decision: ReviewDecision; comment: string | null; isConcession: boolean; createdAt: string; reviewer: { name: string } }[];
  permissions: { canEdit: boolean; canReview: boolean };
}

export interface DefectTypeOption {
  code: string;
  nameZh: string;
  defaultSeverity: DefectSeverity;
  category: string | null;
}
