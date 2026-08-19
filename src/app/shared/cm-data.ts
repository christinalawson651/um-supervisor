import { Injectable, computed, signal } from '@angular/core';
import { CM_CASE_POOL, CmCaseRec, CARE_MANAGERS, CM_STAGES, CM_QUEUES, AssignmentMethod, GoalStatus, CarePlanTemplate, CARE_PLAN_TEMPLATES } from '../data/cm-case-pool';
import { TODAY } from '../data/case-fields';
import { CaseType, CASE_TYPES, ConsentType, CONSENT_TYPES, AssessmentType, ASSESSMENT_TYPES, consentAtRisk, tatAdherent, ReferralIntakeRec, CM_REFERRAL_INTAKE, INTAKE_COORDINATORS, ReferralSource, ReferralPendReason, ReferralReason, REFERRAL_REASONS, ReferralTatBand, referralTatBandOf, suggestedDisciplineFor } from '../data/cm-intake';
import { CM_WEEK_SCHEDULES, CM_ADHERENCE, CmWeekSchedule, CmAdherenceDay, AdherenceStatus } from '../data/cm-schedule';

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
function daysSince(iso: string): number { return -daysUntil(iso); }
function addDaysCm(base: Date, days: number): Date { const d = new Date(base); d.setDate(d.getDate() + days); return d; }
function mondayOfWeek(d: Date): Date { const day = d.getDay(); return addDaysCm(d, day === 0 ? -6 : 1 - day); }
function isoDateCm(d: Date): string { return d.toISOString().slice(0, 10); }

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

// Care Plan & Outcomes drill-downs care about plan-specific fields (opened/review dates, goal
// coverage, participation) that CM_COLUMNS doesn't carry — a dedicated column set, same treatment
// as QUEUE_COLUMNS in cm-dashboard.ts. columns[0] is still 'Member ID' so Explorer's isCmList()
// (and therefore Reassign/Balance) picks it up exactly like any other CM case list.
export const CARE_PLAN_COLUMNS = ['Member ID', 'Member', 'LOB', 'Care Manager', 'Plan Status', 'Template', 'Opened', 'Review Due', 'Goals', 'No Intervention', 'Participation', 'SMART Language'];
export function carePlanRow(c: CmCaseRec): (string | number)[] {
  const noIntervention = c.goals.filter((g) => g.interventionStatus === 'None').length;
  return [c.memberId, c.member, c.lob, c.careManager, c.carePlanStatus, c.carePlanTemplate, c.carePlanOpenedDate, c.carePlanReviewDate, c.goals.length, noIntervention, c.memberParticipation ? 'Yes' : 'No', c.smartLanguageCompliant ? 'Yes' : 'No'];
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

  // ---- Care Plan & Outcomes — a care plan is fields directly on CmCaseRec (one plan per case),
  // not a separate historical entity, matching this file's consent/assessment/outreach treatment.
  // Every metric below scopes off currently-Open plans except closure/duration/reopen, which need
  // Closed plans (and the full population) too. ----

  carePlansOpen(scope?: CmCaseRec[]): CmCaseRec[] {
    return (scope ?? this.cases()).filter((c) => c.carePlanStatus === 'Open');
  }
  carePlansDueForReview(windowDays: number, scope?: CmCaseRec[]): CmCaseRec[] {
    return this.carePlansOpen(scope).filter((c) => { const d = daysUntil(c.carePlanReviewDate); return d >= 0 && d <= windowDays; });
  }
  carePlansOverdue(scope?: CmCaseRec[]): CmCaseRec[] {
    return this.carePlansOpen(scope).filter((c) => daysUntil(c.carePlanReviewDate) < 0);
  }
  carePlansWithoutGoals(scope?: CmCaseRec[]): CmCaseRec[] {
    return this.carePlansOpen(scope).filter((c) => c.goals.length === 0);
  }
  carePlansWithoutInterventions(scope?: CmCaseRec[]): CmCaseRec[] {
    return this.carePlansOpen(scope).filter((c) => c.goals.some((g) => g.interventionStatus === 'None'));
  }

  /** Every goal across open care plans, banded by status. */
  goalProgress(scope?: CmCaseRec[]): { status: GoalStatus; count: number }[] {
    const goals = this.carePlansOpen(scope).flatMap((c) => c.goals);
    const statuses: GoalStatus[] = ['Not Started', 'In Progress', 'At Risk', 'Achieved'];
    return statuses.map((status) => ({ status, count: goals.filter((g) => g.status === status).length }));
  }
  /** Cases with at least one goal at the given status — the drill-down behind goalProgress(). */
  casesWithGoalStatus(status: GoalStatus, scope?: CmCaseRec[]): CmCaseRec[] {
    return this.carePlansOpen(scope).filter((c) => c.goals.some((g) => g.status === status));
  }

  /** Completed interventions ÷ interventions due (goals where an intervention was ever assigned, i.e. not 'None'). */
  interventionCompletionRate(scope?: CmCaseRec[]): { completed: number; due: number; rate: number } {
    const goals = this.carePlansOpen(scope).flatMap((c) => c.goals);
    const due = goals.filter((g) => g.interventionStatus !== 'None').length;
    const completed = goals.filter((g) => g.interventionStatus === 'Completed').length;
    return { completed, due, rate: due ? Math.round((completed / due) * 100) : 0 };
  }
  /** Cases with an intervention still Active (assigned, not yet completed) — the shortfall behind interventionCompletionRate(). */
  casesWithActiveIntervention(scope?: CmCaseRec[]): CmCaseRec[] {
    return this.carePlansOpen(scope).filter((c) => c.goals.some((g) => g.interventionStatus === 'Active'));
  }

  /** Plans closed within the given trailing window, against the full open+closed population. */
  carePlanClosureRate(windowDays: number, scope?: CmCaseRec[]): { closed: CmCaseRec[]; total: number; rate: number } {
    const cs = scope ?? this.cases();
    const closed = cs.filter((c) => c.carePlanStatus === 'Closed' && c.carePlanClosedDate && daysSince(c.carePlanClosedDate) <= windowDays);
    return { closed, total: cs.length || 1, rate: Math.round((closed.length / (cs.length || 1)) * 100) };
  }
  /** Average days from opened to closed, over plans that have actually closed. */
  averageCarePlanDuration(scope?: CmCaseRec[]): number {
    const closed = (scope ?? this.cases()).filter((c) => c.carePlanStatus === 'Closed' && c.carePlanClosedDate);
    if (!closed.length) return 0;
    const totalDays = closed.reduce((s, c) => s + (daysSince(c.carePlanOpenedDate) - daysSince(c.carePlanClosedDate!)), 0);
    return Math.round(totalDays / closed.length);
  }
  /** Plans with documented member agreement/participation, against the full caseload. */
  memberParticipationRate(scope?: CmCaseRec[]): { withParticipation: CmCaseRec[]; total: number; rate: number } {
    const cs = scope ?? this.cases();
    const withParticipation = cs.filter((c) => c.memberParticipation);
    return { withParticipation, total: cs.length || 1, rate: Math.round((withParticipation.length / (cs.length || 1)) * 100) };
  }
  /** Plans reopened at least once after a prior closure. */
  reopenedCarePlans(scope?: CmCaseRec[]): { reopened: CmCaseRec[]; total: number; rate: number } {
    const cs = scope ?? this.cases();
    const reopened = cs.filter((c) => c.carePlanReopened);
    return { reopened, total: cs.length || 1, rate: Math.round((reopened.length / (cs.length || 1)) * 100) };
  }

  /** Which authored template each plan was built from. */
  carePlanTemplateBreakdown(scope?: CmCaseRec[]): { template: CarePlanTemplate; count: number }[] {
    const cs = scope ?? this.cases();
    return CARE_PLAN_TEMPLATES.map((template) => ({ template, count: cs.filter((c) => c.carePlanTemplate === template).length }));
  }
  /** Plans built from the given template — the drill-down behind carePlanTemplateBreakdown(). */
  casesWithTemplate(template: CarePlanTemplate, scope?: CmCaseRec[]): CmCaseRec[] {
    return (scope ?? this.cases()).filter((c) => c.carePlanTemplate === template);
  }

  /** Plans whose goal/intervention language meets SMART criteria, against the full caseload. */
  smartLanguageRate(scope?: CmCaseRec[]): { compliant: number; total: number; rate: number } {
    const cs = scope ?? this.cases();
    const compliant = cs.filter((c) => c.smartLanguageCompliant).length;
    return { compliant, total: cs.length || 1, rate: Math.round((compliant / (cs.length || 1)) * 100) };
  }
  /** Plans NOT yet documented in SMART language — the actionable coaching gap. */
  casesNotSmartCompliant(scope?: CmCaseRec[]): CmCaseRec[] {
    return (scope ?? this.cases()).filter((c) => !c.smartLanguageCompliant);
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

  /** Pending referral workload per Intake Coordinator (+ "Unclaimed" for ones nobody's picked up
   *  yet) — same "workload per worker" shape as managerStats(), just for the intake layer.
   *  Optionally narrowed to one intake channel/modality. These are NOT Care Manager assignments —
   *  a referral here has no bearing on which CM it'll eventually go to once accepted. */
  intakeCoordinatorWorkload(source?: ReferralSource, scope?: ReferralIntakeRec[]): { name: string; count: number }[] {
    const refs = (scope ?? this.referrals()).filter((r) => r.status === 'Pending' && (!source || r.source === source));
    const rows = INTAKE_COORDINATORS.map((name) => ({ name, count: refs.filter((r) => r.intakeCoordinator === name).length }));
    rows.push({ name: 'Unclaimed', count: refs.filter((r) => r.intakeCoordinator === null).length });
    return rows;
  }

  /** Accepted referrals by the Care Manager they were routed to — "how many were accepted, and to whom." */
  acceptedByCareManager(scope?: ReferralIntakeRec[]): { name: string; count: number }[] {
    const refs = (scope ?? this.referrals()).filter((r) => r.status === 'Accepted');
    return CARE_MANAGERS.map((cm) => ({ name: cm.name, count: refs.filter((r) => r.careManager === cm.name).length }));
  }

  /** Pending referrals by operational blocker — "how many have an issue holding them up." */
  pendReasonBreakdown(scope?: ReferralIntakeRec[]): { reason: ReferralPendReason; count: number }[] {
    const refs = (scope ?? this.referrals()).filter((r) => r.status === 'Pending');
    const reasons: ReferralPendReason[] = ['Pending Intake', 'Missing Information', 'Missing Eligibility'];
    return reasons.map((reason) => ({ reason, count: refs.filter((r) => r.pendReason === reason).length }));
  }

  /** Pending referrals banded by intake TAT — "where things stand against the clock." */
  referralTatBreakdown(scope?: ReferralIntakeRec[]): { band: ReferralTatBand; count: number }[] {
    const refs = (scope ?? this.referrals()).filter((r) => r.status === 'Pending');
    const bands: ReferralTatBand[] = ['onTrack', 'dueSoon', 'overdue'];
    return bands.map((band) => ({ band, count: refs.filter((r) => referralTatBandOf(r) === band).length }));
  }

  /** Referrals by clinical/programmatic reason — independent of status, reflects the full funnel. */
  referralReasonBreakdown(scope?: ReferralIntakeRec[]): { reason: ReferralReason; count: number }[] {
    const refs = scope ?? this.referrals();
    return REFERRAL_REASONS.map((reason) => ({ reason, count: refs.filter((r) => r.reason === reason).length }));
  }

  /** Non-mutating preview of N greedy busiest->least-loaded Intake Coordinator moves — same shape
   *  as simulateBalance() for Care Managers, just counting Pending referrals instead of utilization
   *  %. Only moves between named coordinators — "Unclaimed" is never a rebalance source or target
   *  (that's what Assign Referral is for). */
  simulateIntakeBalance(n: number): { from: string; to: string }[] {
    const sim = this.intakeCoordinatorStats().map((s) => ({ name: s.name, count: s.active }));
    const plan: { from: string; to: string }[] = [];
    for (let i = 0; i < n && sim.length > 1; i++) {
      const from = [...sim].sort((a, b) => b.count - a.count)[0];
      const to = [...sim].sort((a, b) => a.count - b.count)[0];
      if (from.name === to.name || from.count - to.count < 2) break;
      plan.push({ from: from.name, to: to.name });
      const fromRef = sim.find((s) => s.name === from.name)!;
      const toRef = sim.find((s) => s.name === to.name)!;
      fromRef.count--; toRef.count++;
    }
    return plan;
  }

  /** One real move of the oldest Pending referral from the busiest Intake Coordinator to the
   *  least-loaded one — same "recommend the least-loaded target" logic as reassignBusiestCase(),
   *  single-move so the caller can call it N times. Returns null once balanced. */
  reassignBusiestReferral(): { member: string; from: string; to: string } | null {
    const stats = this.intakeCoordinatorStats();
    if (stats.length < 2) return null;
    const from = stats.reduce((a, b) => (b.active > a.active ? b : a));
    const to = stats.reduce((a, b) => (b.active < a.active ? b : a));
    if (from.name === to.name || from.active - to.active < 2) return null;
    const candidate = this.referrals().filter((r) => r.intakeCoordinator === from.name && r.status === 'Pending').sort((a, b) => a.received.localeCompare(b.received))[0];
    if (!candidate) return null;
    this.assignIntakeCoordinator(candidate.id, to.name);
    return { member: candidate.member, from: from.name, to: to.name };
  }

  /** Best-fit care manager for a still-Pending referral by proficiency (discipline match on its
   *  clinical reason, see REASON_DISCIPLINE_MAP in cm-intake.ts) then by capacity (least-utilized
   *  among matches) — a real matching rule behind AssignmentMethod's 'Direct — Smart' value,
   *  instead of that just being a retrospective label. Falls back to the least-utilized CM overall
   *  (matched: false) if no CM in the target discipline has room. This is a SUGGESTION only — the
   *  one-at-a-time referral review/accept flow (see CaseExplorer.openReferralDetail) is what
   *  actually moves a referral to Accepted; there is deliberately no bulk auto-accept here. */
  proficiencyMatch(r: ReferralIntakeRec): { cm: string; discipline: string; matched: boolean } {
    const wantDiscipline = suggestedDisciplineFor(r.reason);
    const stats = this.managerStats();
    const inDiscipline = stats.filter((m) => m.discipline === wantDiscipline);
    const pick = (list: CmManagerStat[]) => list.reduce((a, b) => (b.utilization < a.utilization ? b : a));
    if (inDiscipline.length) return { cm: pick(inDiscipline).name, discipline: wantDiscipline, matched: true };
    return { cm: pick(stats).name, discipline: wantDiscipline, matched: false };
  }

  // ---- Scheduling & Adherence — a fixed weekly shift pattern per care manager, plus simulated
  // clock-in/out against it. Both are precomputed once at module load (see cm-schedule.ts) since
  // they're read-only reference data for this demo, not something Reassign/Balance mutate. ----
  weekSchedules(): CmWeekSchedule[] { return CM_WEEK_SCHEDULES; }
  adherenceRecords(): CmAdherenceDay[] { return CM_ADHERENCE; }
  /** Per-CM on-time rate against their own scheduled shifts this week. */
  adherenceStats(): { cm: string; discipline: string; onTime: number; total: number; rate: number }[] {
    const byCm = new Map<string, CmAdherenceDay[]>();
    CM_ADHERENCE.forEach((a) => { if (!byCm.has(a.cm)) byCm.set(a.cm, []); byCm.get(a.cm)!.push(a); });
    return CARE_MANAGERS.map((cm) => {
      const recs = byCm.get(cm.name) ?? [];
      const onTime = recs.filter((r) => r.status === 'On Time').length;
      return { cm: cm.name, discipline: cm.discipline, onTime, total: recs.length, rate: recs.length ? Math.round((onTime / recs.length) * 100) : 100 };
    });
  }
  teamAdherenceRate(): number {
    const total = CM_ADHERENCE.length || 1;
    const onTime = CM_ADHERENCE.filter((a) => a.status === 'On Time').length;
    return Math.round((onTime / total) * 100);
  }
  /** Every scheduled shift this week that didn't go exactly as planned — the actionable worklist
   *  behind the team adherence rate. */
  adherenceExceptions(): CmAdherenceDay[] { return CM_ADHERENCE.filter((a) => a.status !== 'On Time'); }
  adherenceStatusBreakdown(): { status: AdherenceStatus; count: number }[] {
    const statuses: AdherenceStatus[] = ['On Time', 'Late Start', 'Early Leave', 'Overtime', 'Absence'];
    return statuses.map((status) => ({ status, count: CM_ADHERENCE.filter((a) => a.status === status).length }));
  }

  // ---- Demand analysis / forecasting — weekly referral volume bucketed straight from each
  // referral's own `received` date (real data, not fabricated), plus a simple trailing-average
  // projection for next week and a comparison against the team's nominal intake capacity. ----
  /** Referral counts by the Monday-starting week they were received, oldest first. The most
   *  recent bucket is this week-to-date (partial, since TODAY sits mid-week) — included in the
   *  trend line for visibility, but excluded from the forecast basis below. */
  weeklyReferralVolume(weeksBack = 8): { label: string; start: string; count: number }[] {
    const thisMonday = mondayOfWeek(TODAY);
    const buckets = Array.from({ length: weeksBack }, (_, i) => {
      const start = addDaysCm(thisMonday, -(weeksBack - 1 - i) * 7);
      return { start, end: addDaysCm(start, 6), count: 0 };
    });
    this.referrals().forEach((r) => {
      const d = new Date(`${r.received}T00:00:00`);
      const b = buckets.find((bk) => d >= bk.start && d <= bk.end);
      if (b) b.count++;
    });
    return buckets.map((b) => ({ label: `${b.start.getMonth() + 1}/${b.start.getDate()}`, start: isoDateCm(b.start), count: b.count }));
  }
  /** Trailing 4-complete-week average as the next-week projection — simple on purpose (this is a
   *  staffing-planning heuristic for a supervisor, not a statistical forecasting model). */
  demandForecast(): { history: { label: string; start: string; count: number }[]; projected: number; teamCapacity: number; overCapacity: boolean } {
    const weeks = this.weeklyReferralVolume(9);
    const complete = weeks.slice(0, -1);
    const recentBasis = complete.slice(-4).map((w) => w.count);
    const projected = recentBasis.length ? Math.round(recentBasis.reduce((s, v) => s + v, 0) / recentBasis.length) : 0;
    const teamCapacity = INTAKE_COORDINATORS.length * this.IC_CAPACITY;
    return { history: weeks, projected, teamCapacity, overCapacity: projected > teamCapacity };
  }
}
