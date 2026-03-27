import type { PlannedTargetRecord, TargetSelection } from '../domain/release-asset.js';

export interface TargetPlan {
  selectedTargets: TargetSelection[];
  records: PlannedTargetRecord[];
}
