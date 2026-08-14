import { Injectable, computed, signal } from '@angular/core';
import { CM_CASE_POOL, CmCaseRec, CARE_MANAGERS, CM_STAGES, CM_QUEUES, AssignmentMethod } from '../data/cm-case-pool';
import { TODAY } from '../data/case-fields';
import { CaseType, CASE_TYPES, ConsentType, CONSENT_TYPES, AssessmentType, ASSESSMENT_TYPES, consentAtRisk, tatAdherent, ReferralIntakeRec, CM_REFERRAL_INTAKE, INTAKE_COORDINATORS } from '../data/cm-intake';

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

export const CM_COLUMNS = ['Member ID', 'Member', 'LOB', 'Primary Dx', 'Program', 'Care Manager', 'Risk', 'Acuity', 'Annual Cost', 'Stage', 'Queue', 'Assignment', 'SLA Due'];
export function cmToRow(c: CmCaseRec): (string | number)[] {
  return [c.memberId, c.member, c.lob, c.dx, c.program, c.careManager, `${c.riskScore} · ${c.riskLevel}`, c.acuity, `$${c.cost.toLocaleString()}`, c.stage, c.queue ?? '—', c.assignmentMethod, c.slaDueDate];
}

@Injectable({ providedIn: 'root' })
export class CmData {
  /** The mutable caseload — Reassign/Balance mutate this directly, same "aggregate simulation"
   *  model UM uses (moves are real signal updates, not just toasts with no backing state change). */
  readonly cases = signal<CmCaseRec[]>(CM_CASE_POOL);

  /** `scope` lets a caller pass a LOB/Lookback-narrowed case list (see CmDashboard.scopedCases())
   *  instead of the full live caseload — every breakdown below takes the same optional param so
   *  the shared top-bar filters can actually affect this module, not just the KPI strip. Omitting
   *  it (every existing call site) behaves exactly as before. */
  managerStats(scope?: CmCaseRec[]): CmManagerStat[] {
    const cs = scope ?? this.cases();
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
  }

  /** Team rollup — same role as UM Workforce's "By Team" grouping. */
  teamStats(scope?: CmCaseRec[]): CmTeamStat[] {
    const stats = this.managerStats(scope);
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
  }

  stages(scope?: CmCaseRec[]): CmStageCard[] {
    const cs = scope ?? this.cases();
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
  }

  /** Operational work queues — Workforce & Caseload's actual cards (replaces stage cards there). */
  queues(scope?: CmCaseRec[]): CmQueueCard[] {
    const cs = scope ?? this.cases();
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
  }

  /** Counts by how each case's current care manager came to own it — optionally scoped to one
   *  team and/or a LOB/Lookback-narrowed case list. Independent of the operational `queues`
   *  breakdown above (that's what's queued *right now*; this is *how the assignment happened*). */
  assignmentBreakdown(team?: string, scope?: CmCaseRec[]): { method: AssignmentMethod; count: number }[] {
    const teamOf = new Map(CARE_MANAGERS.map((cm) => [cm.name, cm.team]));
    const cs = (scope ?? this.cases()).filter((c) => !team || teamOf.get(c.careManager) === team);
    const methods: AssignmentMethod[] = ['Queue Draw', 'Direct — Smart', 'Direct — Manual'];
    return methods.map((method) => ({ method, count: cs.filter((c) => c.assignmentMethod === method).length }));
  }

  /** Counts by the intake wizard's own "Case Type" field — optionally scoped to one team and/or a LOB/Lookback-narrowed case list. */
  caseTypeBreakdown(team?: string, scope?: CmCaseRec[]): { type: CaseType; count: number }[] {
    const teamOf = new Map(CARE_MANAGERS.map((cm) => [cm.name, cm.team]));
    const cs = (scope ?? this.cases()).filter((c) => !team || teamOf.get(c.careManager) === team);
    return CASE_TYPES.map((type) => ({ type, count: cs.filter((c) => c.caseType === type).length }));
  }

  /** Consent on file by type, with how many of each are due for renewal soon/overdue. */
  consentBreakdown(scope?: CmCaseRec[]) {
    const cs = scope ?? this.cases();
    return CONSENT_TYPES.map((type) => {
      const mine = cs.filter((c) => c.consentType === type);
      return { type, count: mine.length, atRisk: mine.filter(consentAtRisk).length };
    });
  }

  /** Assessments by type, with TAT adherence (completed within the 5-day target). */
  assessmentBreakdown(scope?: CmCaseRec[]) {
    const cs = scope ?? this.cases();
    return ASSESSMENT_TYPES.map((type) => {
      const mine = cs.filter((c) => c.assessmentType === type);
      return { type, count: mine.length, adherent: mine.filter(tatAdherent).length };
    });
  }

  /** Outreach contact-attempt success rate and how many members have an "unable to reach" letter on file. */
  outreachStats(scope?: CmCaseRec[]) {
    const cs = scope ?? this.cases();
    const total = cs.length || 1;
    const successful = cs.filter((c) => c.outreachSuccessful).length;
    const avgAttempts = cs.reduce((s, c) => s + c.outreachAttempts, 0) / total;
    const utrCount = cs.filter((c) => c.utrLetterSent).length;
    return { successRate: Math.round((successful / total) * 100), avgAttempts: Math.round(avgAttempts * 10) / 10, utrCount };
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

  /** Non-mutating preview of N greedy busiest->least-utilized moves — mirrors UM Balance's own
   *  simulate() so the strategy-picker's "N members" and breakdown preview match what
   *  reassignBusiestCase() actually does when called N times afterward. */
  simulateBalance(n: number, scope?: Set<string>): { from: string; to: string }[] {
    const sim = this.managerStats().filter((m) => !scope || scope.has(m.name)).map((m) => ({ name: m.name, utilization: m.utilization }));
    const plan: { from: string; to: string }[] = [];
    for (let i = 0; i < n && sim.length > 1; i++) {
      const from = [...sim].sort((a, b) => b.utilization - a.utilization)[0];
      const to = [...sim].sort((a, b) => a.utilization - b.utilization)[0];
      if (from.name === to.name) break;
      plan.push({ from: from.name, to: to.name });
      const fromRef = sim.find((s) => s.name === from.name)!;
      const toRef = sim.find((s) => s.name === to.name)!;
      fromRef.utilization = Math.max(0, fromRef.utilization - 4);
      toRef.utilization = Math.min(100, toRef.utilization + 4);
    }
    return plan;
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

  // ---- referral intake funnel — only Pending referrals (future work, not yet triaged) are ever
  // reassigned/balanced; Accepted/CM Declined/Member Declined are read-only past decisions. ----
  readonly referrals = signal<ReferralIntakeRec[]>(CM_REFERRAL_INTAKE);

  /** Assigning a pending referral to a care manager IS the triage decision — moves it to Accepted.
   *  pendReason is cleared since it's only meaningful while still Pending. */
  reassignReferral(id: string, toCm: string) {
    this.referrals.update((list) => list.map((r) => (r.id === id ? { ...r, careManager: toCm, status: 'Accepted' as const, pendReason: null } : r)));
  }

  /** Handing a referral to an Intake Coordinator for completeness work is NOT the clinical
   *  decision — status/careManager are untouched, so it's only meaningful while still Pending. */
  assignIntakeCoordinator(id: string, coordinator: string) {
    this.referrals.update((list) => list.map((r) => (r.id === id ? { ...r, intakeCoordinator: coordinator } : r)));
  }

  /** Least-loaded-first roster for the Intake Coordinator assign panel — "active" = how many
   *  still-Pending referrals are currently on that coordinator's plate. Capacity is nominal (15)
   *  since coordinators only ever hold intake volume, never a full CM-sized caseload. */
  private readonly IC_CAPACITY = 15;
  intakeCoordinatorStats(): { name: string; active: number; utilization: number }[] {
    return INTAKE_COORDINATORS.map((name) => {
      const active = this.referrals().filter((r) => r.intakeCoordinator === name && r.status === 'Pending').length;
      return { name, active, utilization: Math.min(100, Math.round((active / this.IC_CAPACITY) * 100)) };
    });
  }

  /** Who can be assigned to work a still-Pending referral — Intake Coordinators primarily, but
   *  some clients have a Care Manager do their own intake, so CMs are offered too. Coordinators
   *  come first in the list since they're the common case. */
  referralAssigneeStats(): { name: string; active: number; utilization: number }[] {
    return [...this.intakeCoordinatorStats(), ...this.managerStats().map((m) => ({ name: m.name, active: m.active, utilization: m.utilization }))];
  }
}
