import type { NextStep, Opportunity, Role, RouteType, Stage } from '../domain/types';
import type { EstimateResult } from '../domain/economics';

export interface ListItem {
  id: string;
  title: string;
  companyId: string;
  stage: Stage;
  ownerUserId: string;
  presalePmUserId: string | null;
  nextStep: NextStep;
  route: RouteType | null;
  blockers: number;
  pendingChanges: number;
  ownerDecisions: string[];
  pause: Opportunity['pause'];
  closure: Opportunity['closure'];
  related: Opportunity['related'];
  updatedAt: string;
  version: number;
  isDemo: boolean;
}

export type RestrictedEstimate = { restricted: true; priceKop: number | null; complete: boolean; issues: { message: string }[] };

export type View = Opportunity & {
  computed: { estimates: Record<string, EstimateResult | RestrictedEstimate> };
  viewRole: Role;
  restricted: string[];
  companyName: string | null;
  ownerDecisions: string[];
  createdId?: string | null;
};

export const isFull = (e: EstimateResult | RestrictedEstimate): e is EstimateResult => !('restricted' in e);
