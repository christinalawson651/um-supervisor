import { Injectable, computed, signal } from '@angular/core';
import { CM_CASE_POOL, CmCaseRec, CARE_MANAGERS, CM_STAGES } from '../data/cm-case-pool';
import { TODAY } from '../data/case-fields';

export interface CmManagerStat {
  name: string; discipline: string;
  active: number; highRisk: number; highAcuity: number; highCost: number; slaAtRisk: number; utilization: number;
}
export interface CmStageCard {
  name: string; count: number;
  buckets: { onTrack: number; dueSoon: number; overdue: number }; // percentages
}
export type SlaBand = 'onTrack' | 'dueSoon' | 'overdue';

// A fully-utilized care manager's caseload — utilization = active / capacity, same "% of capacity"
// framing as UM's nurse utilization, just with a CM-appropriate ceiling.
const CAPACITY_PER_CM = 40;

function daysUntil(iso: string): number { return Math.round((new Date(`${iso}T00:00:00`).getTime() - TODAY.getTime()) / 86400000); }

export function slaBandOf(c: CmCaseRec): SlaBand {
  if (c.tags.includes('slaAtRisk')) return 'overdue';
  return daysUntil(c.slaDueDate) <= 3 ? 'dueSoon' : 'onTrack';
}

export const CM_COLUMNS = ['Member ID', 'Member', 'Primary Dx', 'Program', 'Care Manager', 'Risk', 'Acuity', 'Annual Cost', 'Stage', 'SLA Due'];
export function cmToRow(c: CmCaseRec): (string | number)[] {
  return [c.memberId, c.member, c.dx, c.program, c.careManager, `${c.riskScore} · ${c.riskLevel}`, c.acuity, `$${c.cost.toLocaleString()}`, c.stage, c.slaDueDate];
}

@Injectable({ providedIn: 'root' })
export class CmData {
  /** The mutable caseload — Reassign/Balance mutate this directly, same "aggregate simulation"
   *  model UM uses (moves are real signal updates, not just toasts with no backing state change). */
  readonly cases = signal<CmCaseRec[]>(CM_CASE_POOL);

  readonly managerStats = computed<CmManagerStat[]>(() => {
    const cs = this.cases();
    return CARE_MANAGERS.map((cm) => {
      const mine = cs.filter((c) => c.careManager === cm.name);
      const active = mine.length;
      return {
        name: cm.name, discipline: cm.discipline, active,
        highRisk: mine.filter((c) => c.tags.includes('highRisk')).length,
        highAcuity: mine.filter((c) => c.tags.includes('highAcuity')).length,
        highCost: mine.filter((c) => c.tags.includes('highCost')).length,
        slaAtRisk: mine.filter((c) => c.tags.includes('slaAtRisk')).length,
        utilization: Math.min(100, Math.round((active / CAPACITY_PER_CM) * 100)),
      };
    });
  });

  readonly stages = computed<CmStageCard[]>(() => {
    const cs = this.cases();
    return CM_STAGES.map((stage) => {
      const mine = cs.filter((c) => c.stage === stage);
      const total = mine.length || 1;
      const bands = { onTrack: 0, dueSoon: 0, overdue: 0 };
      mine.forEach((c) => { bands[slaBandOf(c)]++; });
      return {
        name: stage, count: mine.length,
        buckets: { onTrack: Math.round((bands.onTrack / total) * 100), dueSoon: Math.round((bands.dueSoon / total) * 100), overdue: Math.round((bands.overdue / total) * 100) },
      };
    });
  });

  reassignCase(memberId: string, toCm: string) {
    this.cases.update((list) => list.map((c) => (c.memberId === memberId ? { ...c, careManager: toCm } : c)));
  }
  reassignStage(memberId: string, toStage: string) {
    this.cases.update((list) => list.map((c) => (c.memberId === memberId ? { ...c, stage: toStage } : c)));
  }

  /** One real move from the busiest care manager to the one with the most capacity — same
   *  "recommend the least-utilized target" logic as UM's Balance, just single-move so the caller
   *  can call it N times for an "N members rebalanced" toast. Returns null once balanced. */
  reassignBusiestCase(): { member: string; from: string; to: string } | null {
    const stats = this.managerStats();
    if (stats.length < 2) return null;
    const from = stats.reduce((a, b) => (b.utilization > a.utilization ? b : a));
    const to = stats.reduce((a, b) => (b.utilization < a.utilization ? b : a));
    if (from.name === to.name || from.utilization - to.utilization < 5) return null;
    const candidate = this.cases().find((c) => c.careManager === from.name);
    if (!candidate) return null;
    this.reassignCase(candidate.memberId, to.name);
    return { member: candidate.member, from: from.name, to: to.name };
  }
}
