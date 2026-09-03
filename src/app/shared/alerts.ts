import { Injectable, computed, inject, signal } from '@angular/core';
import { Nav, ModuleId } from './nav';
import { CASE_POOL } from '../data/case-pool';
import { CM_CASE_POOL } from '../data/cm-case-pool';
import { TODAY } from '../data/case-fields';
import {
  AUDIT_EVENTS, SYSTEM_USERS, COMPLIANCE_REGISTER, ARCHIVE_SEGMENTS, RESTORE_REQUESTS,
  evaluateSod, attestationAgeDays, ATTESTATION_CYCLE_DAYS, archiveSummary,
} from '../data/audit-trail';
import { AI_DECISIONS, AI_TARGETS, aiSummary, calibration } from '../data/ai-oversight';

// Alerts are AWARENESS, not a work queue.
//
// Deliberately no assignment, no acknowledge, no resolve. A supervisor needs to know a thing is
// happening without it landing in their name — the moment an alert is assigned it becomes work
// somebody owns, and the feed turns into a second inbox competing with the real one.
//
// So an alert carries exactly one capability: it takes you to the surface that owns the problem.
// Everything actionable already lives there — reassign, balance, drill, export, dispose — and
// duplicating any of it onto the alert would create a second place to do the same thing.

export type AlertSeverity = 'critical' | 'warning' | 'info';

/** Where a signal is meant to go when it fires, and how quickly someone is expected to have looked.
 *
 *  Stated honestly: this is the ROUTING CONFIGURATION, not a delivery mechanism. The rules, owners
 *  and review windows below are real and auditable — "what alerts exist and who receives them" is a
 *  question every security reviewer asks, and until now the answer was nowhere. What does not exist
 *  is anything that leaves the platform: no mail, no page, no ticket. That remains REQ-13, and the
 *  register says so rather than this table implying otherwise. */
export interface NotificationRule {
  signal: string;
  severity: AlertSeverity;
  owner: string;
  reviewWindow: string;
  destination: string;
  delivery: 'In-app only';
}
export const NOTIFICATION_RULES: NotificationRule[] = [
  { signal: 'Confidence band outside calibration tolerance', severity: 'critical', owner: 'Clinical Content', reviewWindow: '5 business days', destination: 'Clinical content queue', delivery: 'In-app only' },
  { signal: 'Segregation-of-duty exception', severity: 'critical', owner: 'Compliance', reviewWindow: '1 business day', destination: 'Compliance queue', delivery: 'In-app only' },
  { signal: 'Account authenticating without MFA', severity: 'critical', owner: 'IT Operations', reviewWindow: '1 business day', destination: 'IT operations queue', delivery: 'In-app only' },
  { signal: 'Authorization past its regulatory deadline', severity: 'critical', owner: 'UM Leadership', reviewWindow: 'Same day', destination: 'UM supervisor queue', delivery: 'In-app only' },
  { signal: 'Member consent lapsed', severity: 'critical', owner: 'CM Leadership', reviewWindow: 'Same day', destination: 'CM supervisor queue', delivery: 'In-app only' },
  { signal: 'Break-the-glass access granted', severity: 'warning', owner: 'Compliance', reviewWindow: '5 business days', destination: 'Compliance queue', delivery: 'In-app only' },
  { signal: 'Decision agreement below target', severity: 'warning', owner: 'Clinical Content', reviewWindow: 'Monthly review', destination: 'Clinical content queue', delivery: 'In-app only' },
  { signal: 'Override rate above ceiling', severity: 'warning', owner: 'Clinical Content', reviewWindow: 'Monthly review', destination: 'Clinical content queue', delivery: 'In-app only' },
  { signal: 'Entitlement review overdue', severity: 'warning', owner: 'IT Operations', reviewWindow: '10 business days', destination: 'IT operations queue', delivery: 'In-app only' },
  { signal: 'Segment awaiting certified disposition', severity: 'warning', owner: 'Compliance', reviewWindow: 'Quarterly review', destination: 'Compliance queue', delivery: 'In-app only' },
  { signal: 'Restore request approaching retrieval SLA', severity: 'info', owner: 'Platform Engineering', reviewWindow: 'Within SLA', destination: 'Platform queue', delivery: 'In-app only' },
];

export interface Alert {
  id: string;
  severity: AlertSeverity;
  source: string;              // which module raised it
  title: string;
  detail: string;
  metric: string;              // the figure, shown alongside the title
  module: ModuleId;            // where clicking takes you
  tab: string;                 // and which tab within it
  targetLabel: string;         // stated on the alert, so the destination is never a surprise
}

const SEVERITY_ORDER: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
function daysUntil(iso: string): number { return Math.round((new Date(`${iso}T00:00:00`).getTime() - TODAY.getTime()) / 86400000); }

@Injectable({ providedIn: 'root' })
export class Alerts {
  private nav = inject(Nav);
  readonly open = signal(false);
  toggle() { this.open.update((o) => !o); }
  close() { this.open.set(false); }

  /** Every alert is derived from the same data the destination screen reads, so the count in the
   *  rail and the number on the tab you land on are always the same number. */
  readonly all = computed<Alert[]>(() => {
    const out: Alert[] = [];
    const push = (a: Alert) => { if (a.metric !== '0') out.push(a); };

    // ---------------- UM ----------------
    const breached = CASE_POOL.filter((c) => c.tags.includes('breached')).length;
    const atRisk = CASE_POOL.filter((c) => c.tags.includes('atRisk')).length;
    const unassigned = CASE_POOL.filter((c) => c.phase === 'pending' && c.nurse === '—').length;
    push({ id: 'um-breached', severity: 'critical', source: 'UM', title: 'Authorizations past their regulatory deadline',
      detail: 'Decisions already outside the statutory window for their line of business.', metric: String(breached),
      module: 'um', tab: 'tat', targetLabel: 'UM → TAT Compliance' });
    push({ id: 'um-atrisk', severity: 'warning', source: 'UM', title: 'Authorizations at risk of breaching',
      detail: 'Approaching the decision deadline and not yet determined.', metric: String(atRisk),
      module: 'um', tab: 'tat', targetLabel: 'UM → TAT Compliance' });
    push({ id: 'um-unassigned', severity: 'warning', source: 'UM', title: 'Unassigned authorizations in queue',
      detail: 'Sitting unclaimed with no reviewer against them.', metric: String(unassigned),
      module: 'um', tab: 'workforce', targetLabel: 'UM → Workforce & Queue Management' });

    // ---------------- CM ----------------
    const consentExpired = CM_CASE_POOL.filter((c) => daysUntil(c.consentExpiresDate) < 0).length;
    const reviewOverdue = CM_CASE_POOL.filter((c) => c.carePlanStatus === 'Open' && daysUntil(c.carePlanReviewDate) < 0).length;
    const slaAtRisk = CM_CASE_POOL.filter((c) => c.tags.includes('slaAtRisk')).length;
    push({ id: 'cm-consent', severity: 'critical', source: 'CM', title: 'Member consent lapsed',
      detail: 'Care management continuing against an expired consent on file.', metric: String(consentExpired),
      module: 'cm', tab: 'audit', targetLabel: 'CM → Audit & Compliance' });
    push({ id: 'cm-review', severity: 'warning', source: 'CM', title: 'Care plan reviews overdue',
      detail: 'Open plans past their reassessment date.', metric: String(reviewOverdue),
      module: 'cm', tab: 'careplan', targetLabel: 'CM → Care Plan & Outcomes' });
    push({ id: 'cm-sla', severity: 'warning', source: 'CM', title: 'Care-management cases past their SLA milestone',
      detail: 'Next milestone date already passed.', metric: String(slaAtRisk),
      module: 'cm', tab: 'workforce', targetLabel: 'CM → Workforce & Caseload' });

    // ---------------- AI governance ----------------
    const ai = aiSummary(AI_DECISIONS);
    const offBands = calibration(AI_DECISIONS).filter((c) => c.adequate && Math.abs(c.deviation) > AI_TARGETS.maxCalibrationDeviationPts);
    const over = offBands.filter((c) => c.deviation < 0);
    if (over.length) {
      push({ id: 'ai-calibration', severity: 'critical', source: 'Audit & Traceability', title: 'Confidence band is over-confident',
        detail: `${over.map((c) => c.band).join(', ')} agrees with the clinician less often than its score claims. Scores in that range cannot be leaned on until this closes.`,
        metric: `${over[0].deviation} pts`, module: 'audit', tab: 'ai', targetLabel: 'Audit & Traceability → AI Oversight' });
    }
    if (ai.decisionAgreementPct < AI_TARGETS.decisionAgreementPct) {
      push({ id: 'ai-agreement', severity: 'warning', source: 'Audit & Traceability', title: 'Decision agreement below target',
        detail: `Model recommendation matched the final determination on ${ai.decisionAgreementPct}% of determinations against a ${AI_TARGETS.decisionAgreementPct}% target.`,
        metric: `${ai.decisionAgreementPct}%`, module: 'audit', tab: 'ai', targetLabel: 'Audit & Traceability → AI Oversight' });
    }
    if (ai.overrideRatePct > AI_TARGETS.maxOverrideRatePct) {
      push({ id: 'ai-override', severity: 'warning', source: 'Audit & Traceability', title: 'Override rate above ceiling',
        detail: `Clinicians overrode ${ai.overrideRatePct}% of reviewed determinations against a ${AI_TARGETS.maxOverrideRatePct}% ceiling.`,
        metric: `${ai.overrideRatePct}%`, module: 'audit', tab: 'ai', targetLabel: 'Audit & Traceability → AI Oversight' });
    }
    push({ id: 'ai-model-attr', severity: 'warning', source: 'Audit & Traceability', title: 'Model-attributable overrides',
      detail: 'Overrides coded to a model defect rather than a legitimate clinical divergence — these belong with the criteria owner.',
      metric: String(ai.modelAttributable), module: 'audit', tab: 'ai', targetLabel: 'Audit & Traceability → AI Oversight' });

    // ---------------- access governance ----------------
    const sodExceptions = evaluateSod(AUDIT_EVENTS).reduce((n, r) => n + r.conflicts.length, 0);
    const noMfa = SYSTEM_USERS.filter((u) => !u.mfaEnrolled).length;
    const attestOverdue = SYSTEM_USERS.filter((u) => attestationAgeDays(u) > ATTESTATION_CYCLE_DAYS).length;
    push({ id: 'gov-sod', severity: 'critical', source: 'Audit & Traceability', title: 'Segregation-of-duty exceptions',
      detail: 'Two duties that must stay separate have landed on one person, evidenced in the trail.',
      metric: String(sodExceptions), module: 'audit', tab: 'governance', targetLabel: 'Audit & Traceability → Governance & Access' });
    push({ id: 'gov-mfa', severity: 'critical', source: 'Audit & Traceability', title: 'Accounts authenticating with a password only',
      detail: 'No second factor, including on accounts with standing PHI access.',
      metric: String(noMfa), module: 'audit', tab: 'governance', targetLabel: 'Audit & Traceability → Governance & Access' });
    push({ id: 'gov-attest', severity: 'warning', source: 'Audit & Traceability', title: 'Entitlement reviews overdue',
      detail: `Past the ${ATTESTATION_CYCLE_DAYS}-day attestation cycle and still holding full access.`,
      metric: String(attestOverdue), module: 'audit', tab: 'governance', targetLabel: 'Audit & Traceability → Governance & Access' });

    // ---------------- user activity ----------------
    const btg = AUDIT_EVENTS.filter((e) => e.action.startsWith('Break-the-glass')).length;
    push({ id: 'act-btg', severity: 'warning', source: 'Audit & Traceability', title: 'Break-the-glass access granted',
      detail: 'Emergent access outside the user\'s assigned scope. Each one is a reviewable PHI disclosure.',
      metric: String(btg), module: 'audit', tab: 'activity', targetLabel: 'Audit & Traceability → User Activity' });

    // ---------------- retention ----------------
    const arch = archiveSummary();
    const restoresOpen = RESTORE_REQUESTS.filter((r) => r.status === 'In Progress').length;
    push({ id: 'ret-purge', severity: 'warning', source: 'Audit & Traceability', title: 'Segments past retention awaiting disposition',
      detail: 'Past their retention date, not under hold, and not yet certified as destroyed.',
      metric: String(arch.purgeEligible), module: 'audit', tab: 'retention', targetLabel: 'Audit & Traceability → Retention & Archive' });
    push({ id: 'ret-restore', severity: 'info', source: 'Audit & Traceability', title: 'Open restore requests',
      detail: 'Retrieval from cold storage still in progress against the retrieval SLA.',
      metric: String(restoresOpen), module: 'audit', tab: 'retention', targetLabel: 'Audit & Traceability → Retention & Archive' });
    push({ id: 'ret-hold', severity: 'info', source: 'Audit & Traceability', title: 'Segments under legal hold',
      detail: 'Disposition suspended regardless of retention date.',
      metric: String(arch.onHold), module: 'audit', tab: 'retention', targetLabel: 'Audit & Traceability → Retention & Archive' });

    // ---------------- compliance register ----------------
    const p1Open = COMPLIANCE_REGISTER.filter((r) => r.priority === 'P1' && r.status !== 'Met').length;
    push({ id: 'reg-p1', severity: 'warning', source: 'Audit & Traceability', title: 'P1 compliance requirements still open',
      detail: 'Tracked requirements at the highest priority that are not yet met.',
      metric: String(p1Open), module: 'audit', tab: 'compliance', targetLabel: 'Audit & Traceability → Compliance & Gaps' });

    return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.source.localeCompare(b.source));
  });

  readonly count = computed(() => this.all().length);
  readonly criticalCount = computed(() => this.all().filter((a) => a.severity === 'critical').length);
  readonly bySource = computed(() => {
    const sources = [...new Set(this.all().map((a) => a.source))];
    return sources.map((source) => ({ source, alerts: this.all().filter((a) => a.source === source) }));
  });

  /** The one thing an alert does: put you where the problem is. */
  goTo(a: Alert) {
    this.nav.goTo(a.module, a.tab);
    this.close();
  }
}
