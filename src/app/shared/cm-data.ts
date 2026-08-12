import { Injectable, computed, signal } from '@angular/core';
import { CM_CASE_POOL, CmCaseRec, CARE_MANAGERS, CM_STAGES, CM_QUEUES, AssignmentMethod } from '../data/cm-case-pool';
import { TODAY } from '../data/case-fields';

export interface CmManagerStat {
  name: string; discipline: string; team: string;
  active: number; highRisk: number; highAcuity: number; highCost: number; slaAtRisk: number; utilization: number;
}
export interface CmTeamStat {
  name: string; managers: CmManagerStat[];
  active: number; highRisk: number; highAcuity: number; highCost: number; slaAtRisk: number; utilization: number;
}
export interface CmStageCard {
  name: string; count: number;
  buckets: { onTrack: number; dueSoon: number; overdue: number }; // percentages
}
export type SlaBand = 'onTrack' | 'dueSoon' | 'overdue';

export interface CmQueueCard {
  name: string; count: number;
  buckets: { fresh: number; day2: number; over48: number; breach: number }; // percentages
}
export type QueueBand = 'fresh' | 'day2' | 'over48' | 'breach';

// A fully-utilized care manager's caseload — utilization = active / capacity, same "% of capacity"
// framing as UM's nurse utilization, just with a CM-appropriate ceiling.
const CAPACITY_PER_CM = 40;

function daysUntil(iso: string): number { return Math.round((new Date(`${iso}T00:00:00`).getTime() - TODAY.getTime()) / 86400000); }

/** Lifecycle-stage SLA banding — infra for the Intake & Assessment SLA / Care Plan & Outcomes
 *  tabs when they get this same treatment; Workforce & Caseload uses queueBandOf instead. */
export function slaBandOf(c: CmCaseRec): SlaBand {
  if (c.tags.includes('slaAtRisk')) return 'overdue';
  return daysUntil(c.slaDueDate) <= 3 ? 'dueSoon' : 'onTrack';
}

/** Workforce queue age banding — same fresh/day2/over48/breach shape as UM's ageH/bandOf. */
export function queueBandOf(c: CmCaseRec): QueueBand {
  if (c.queueBreached) return 'breach';
  return c.queueAgeH < 24 ? 'fresh' : c.queueAgeH < 48 ? 'day2' : 'over48';
}

export const CM_COLUMNS = ['Member ID', 'Member', 'Primary Dx', 'Program', 'Care Manager', 'Risk', 'Acuity', 'Annual Cost', 'Stage', 'Queue', 'Assignment', 'SLA Due'];
export function cmToRow(c: CmCaseRec): (string | number)[] {
  return [c.memberId, c.member, c.dx, c.program, c.careManager, `${c.riskScore} · ${c.riskLevel}`, c.acuity, `$${c.cost.toLocaleString()}`, c.stage, c.queue ?? '—', c.assignmentMethod, c.slaDueDate];
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
        name: cm.name, discipline: cm.discipline, team: cm.team, active,
        highRisk: mine.filter((c) => c.tags.includes('highRisk')).length,
        highAcuity: mine.filter((c) => c.tags.includes('highAcuity')).length,
        highCost: mine.filter((c) => c.tags.includes('highCost')).length,
        slaAtRisk: mine.filter((c) => c.tags.includes('slaAtRisk')).length,
        utilization: Math.min(100, Math.round((active / CAPACITY_PER_CM) * 100)),
      };
    });
  });

  /** Team rollup — same role as UM Workforce's "By Team" grouping. */
  readonly teamStats = computed<CmTeamStat[]>(() => {
    const stats = this.managerStats();
    const groups = new Map<string, CmManagerStat[]>();
    for (const m of stats) { if (!groups.has(m.team)) groups.set(m.team, []); groups.get(m.team)!.push(m); }
    return [...groups.entries()].map(([name, managers]) => {
      const sum = (f: (m: CmManagerStat) => number) => managers.reduce((s, m) => s + f(m), 0);
      return {
        name, managers,
        active: sum((m) => m.active), highRisk: sum((m) => m.highRisk), highAcuity: sum((m) => m.highAcuity),
        highCost: sum((m) => m.highCost), slaAtRisk: sum((m) => m.slaAtRisk),
        utilization: Math.round(sum((m) => m.utilization) / managers.length),
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

  /** Operational work queues — Workforce & Caseload's actual cards (replaces stage cards there). */
  readonly queues = computed<CmQueueCard[]>(() => {
    const cs = this.cases();
    return CM_QUEUES.map((queue) => {
      const mine = cs.filter((c) => c.queue === queue);
      const total = mine.length || 1;
      const bands = { fresh: 0, day2: 0, over48: 0, breach: 0 };
      mine.forEach((c) => { bands[queueBandOf(c)]++; });
      return {
        name: queue, count: mine.length,
        buckets: {
          fresh: Math.round((bands.fresh / total) * 100), day2: Math.round((bands.day2 / total) * 100),
          over48: Math.round((bands.over48 / total) * 100), breach: Math.round((bands.breach / total) * 100),
        },
      };
    });
  });

  /** Counts by how each case's current care manager came to own it — optionally scoped to one
   *  team. Independent of the operational `queues` breakdown above (that's what's queued *right
   *  now*; this is *how the assignment originally happened*). */
  assignmentBreakdown(team?: string): { method: AssignmentMethod; count: number }[] {
    const teamOf = new Map(CARE_MANAGERS.map((cm) => [cm.name, cm.team]));
    const cs = this.cases().filter((c) => !team || teamOf.get(c.careManager) === team);
    const methods: AssignmentMethod[] = ['Queue Draw', 'Direct — Smart', 'Direct — Manual'];
    return methods.map((method) => ({ method, count: cs.filter((c) => c.assignmentMethod === method).length }));
  }

  reassignCase(memberId: string, toCm: string) {
    this.cases.update((list) => list.map((c) => (c.memberId === memberId ? { ...c, careManager: toCm } : c)));
  }
  reassignStage(memberId: string, toStage: string) {
    this.cases.update((list) => list.map((c) => (c.memberId === memberId ? { ...c, stage: toStage } : c)));
  }
  reassignQueue(memberId: string, toQueue: string) {
    this.cases.update((list) => list.map((c) => (c.memberId === memberId ? { ...c, queue: toQueue, queueAgeH: 0, queueBreached: false } : c)));
  }

  /** One real move from the busiest care manager to the one with the most capacity — same
   *  "recommend the least-utilized target" logic as UM's Balance, just single-move so the caller
   *  can call it N times for an "N members rebalanced" toast. Pass `scope` to restrict candidates
   *  to one team (mirrors UM's Balance.run(scopeNote, nurseScope?)). Returns null once balanced. */
  reassignBusiestCase(scope?: Set<string>): { member: string; from: string; to: string } | null {
    const stats = this.managerStats().filter((m) => !scope || scope.has(m.name));
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
