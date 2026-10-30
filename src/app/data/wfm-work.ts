// Line items and due dates for WFM work, modelled on TruCare 26.x (Legacy to 26.x UM configuration
// translation): the line is the unit of work — it has its own status, holder and step due date, and a
// reviewer can downgrade an expedited line to standard, which gives that line its own clock. Urgency
// and the decision due date (the SLA) belong to the authorization; the authorization's SLA is its
// earliest open line. Deterministic per authId so the demo shows the same work on every load.
import { CaseRec } from './case-pool';
import { lobOf, urgencyOf } from './case-fields';

export type LineType = 'Inpatient Line' | 'Procedure Code Line' | 'RX Line';
export type LineStatus = 'Pending review' | 'Pending information' | 'Approved' | 'Not meeting criteria';
export type Urgency = 'Expedited' | 'Standard';
export interface WorkLine {
  no: number; type: LineType; service: string; status: LineStatus;
  urgency: Urgency; downgraded: boolean;
  /** Decision due date for this line (ms). */ slaDue: number;
  /** Due date for the current step on this line (ms). */ stepDue: number;
}
export const LINE_OPEN = (l: WorkLine) => l.status === 'Pending review' || l.status === 'Pending information';
/** A line that needs a specialty pool rather than the queue's role (um-02 addendum 01 §13.2):
 *  drug lines go to the pharmacist pool. Assigning the authorization leaves these lines in their
 *  pool's queue (or with a holder who works that pool) instead of handing them to the assignee. */
export const poolOf = (l: WorkLine): 'Pharmacist' | null => (l.type === 'RX Line' ? 'Pharmacist' : null);

export const H = 3600e3;
/** "Now" for every due-date calculation, fixed at load so countdowns agree across the page. */
export const NOW = Date.now();

/** Decision windows. Expedited: 72 hours. Standard: 7 days for Medicaid (CMS interoperability and
 *  prior authorization rule, from 2026) and 15 days for Marketplace. Pulse Admin should own these. */
export const SLA_WINDOW_H = { Expedited: 72, Medicaid: 7 * 24, Marketplace: 15 * 24 } as const;
export const windowH = (authId: string, u: Urgency) =>
  u === 'Expedited' ? SLA_WINDOW_H.Expedited : lobOf(authId) === 'ACA Exchange' ? SLA_WINDOW_H.Marketplace : SLA_WINDOW_H.Medicaid;

/** Reasons offered when a supervisor moves a step due date (26.x "Adjust Step Due Date"). */
export const STEP_DUE_REASONS = [
  'Clinical records expected - review would be premature', 'Reviewer capacity - reprioritized by supervisor',
  'Provider / P2P availability', 'Other (note required)',
];

function hash(n: number, salt: string, mod: number): number {
  let x = 2166136261;
  const s = `${salt}:${n}`;
  for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); }
  return (x >>> 0) % mod;
}
const PROC_LINES = ['Physical Therapy', 'Diagnostic Imaging', 'Specialist Consultation', 'Durable Medical Equipment'];
const RX_LINES = ['Specialty Injectable', 'Oral Oncology Medication'];

/** When the request was received (ms), placed so the SLA position matches the case's TAT tag. */
export function receivedOf(c: CaseRec): number {
  const n = Number(c.authId.replace(/\D/g, '')) || 0, w = windowH(c.authId, urgencyOf(c));
  if (c.tags.includes('breached')) return NOW - (w + 1 + hash(n, 'late', 20)) * H;          // SLA already passed
  if (c.tags.includes('atRisk')) return NOW - (w - 4 - hash(n, 'risk', 18)) * H;            // SLA within a day
  return NOW - Math.round(w * (0.1 + hash(n, 'rcv', 45) / 100)) * H;                        // comfortably inside
}

/** Step due for the case's current step: a share of the decision window by stage. At-risk work has
 *  already missed its step due while the SLA still holds. */
function stepDueOf(c: CaseRec, received: number, sla: number): number {
  const n = Number(c.authId.replace(/\D/g, '')) || 0;
  if (c.tags.includes('atRisk')) return NOW - (1 + hash(n, 'step', 6)) * H;
  const share = c.status === 'Intake' ? 0.25 : c.status === 'MD Review' || c.status === 'Pending P2P' ? 0.8 : 0.6;
  return Math.min(sla, received + (sla - received) * share);
}

const cache = new Map<string, WorkLine[]>();
/** An authorization's line items: 1–4 lines, the first is the requested service. */
export function linesOf(c: CaseRec): WorkLine[] {
  const hit = cache.get(c.authId);
  if (hit) return hit;
  const n = Number(c.authId.replace(/\D/g, '')) || 0;
  const count = 1 + hash(n, 'lines', c.serviceType === 'Inpatient' ? 4 : 3);
  const received = receivedOf(c), urg = urgencyOf(c);
  const lines: WorkLine[] = [];
  for (let i = 1; i <= count; i++) {
    const type: LineType = i === 1 ? (c.serviceType === 'Inpatient' ? 'Inpatient Line' : 'Procedure Code Line')
      : hash(n, `t${i}`, 3) === 0 ? 'RX Line' : 'Procedure Code Line';
    const service = i === 1 ? c.procedure : type === 'RX Line' ? RX_LINES[hash(n, `rx${i}`, RX_LINES.length)] : PROC_LINES[hash(n, `p${i}`, PROC_LINES.length)];
    // a reviewer may have moved a later expedited line to the standard clock
    const downgraded = urg === 'Expedited' && i > 1 && hash(n, `dg${i}`, 3) === 0;
    const u: Urgency = downgraded ? 'Standard' : urg;
    const slaDue = received + windowH(c.authId, u) * H;
    // later lines are sometimes already decided while the first is still open
    const status: LineStatus = i > 1 && hash(n, `s${i}`, 4) === 0 ? 'Approved'
      : c.tags.includes('rfi') && i === 1 ? 'Pending information' : 'Pending review';
    lines.push({ no: i, type, service, status, urgency: u, downgraded, slaDue, stepDue: stepDueOf(c, received, slaDue) });
  }
  cache.set(c.authId, lines);
  return lines;
}

// ---- Terms, as in the UM spec addenda (um-01 §3, um-02 §5, um-05 §6):
// TAT       = the regulatory (decision) due. On an authorization it is the narrowest running line
//             clock: the earliest due among its open lines (tolled and terminal lines left out).
// Step due  = the working due of the line's current step (adjustable, with a reason).
// At risk   = TAT within UM_AT_RISK_HOURS.
export const UM_AT_RISK_HOURS = 72;
export const UM_TAT_HMS_HOURS = 72;

/** TAT cell text (um-05 §6): "Xd Yh" from 72 h out, "51h 22m 10s" inside that, "⚠ Overdue Xd Yh Zm" past due. */
export function tatText(at: number, now: number): string {
  const d = at - now;
  if (d < 0) {
    const m = Math.floor(-d / 60e3), days = Math.floor(m / 1440), hrs = Math.floor((m % 1440) / 60);
    return `⚠ Overdue ${days ? days + 'd ' : ''}${hrs}h ${m % 60}m`;
  }
  const h = d / H;
  if (h >= UM_TAT_HMS_HOURS) return `${Math.floor(h / 24)}d ${Math.floor(h % 24)}h`;
  const s = Math.floor(d / 1000);
  return `${h <= UM_AT_RISK_HOURS ? '⚠ ' : ''}${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s`;
}
/** red: overdue or under 24 h · amber: at risk (≤ 72 h) · ok otherwise. */
export function tatTone(at: number, now: number): 'red' | 'amber' | 'ok' {
  const h = (at - now) / H;
  return h < 24 ? 'red' : h <= UM_AT_RISK_HOURS ? 'amber' : 'ok';
}

/** "in 3h", "in 2d 4h", "5h overdue". */
export function dueLabel(at: number): string {
  const d = at - NOW, a = Math.abs(d), h = Math.round(a / H);
  const t = h < 24 ? `${h}h` : `${Math.floor(h / 24)}d${h % 24 ? ` ${h % 24}h` : ''}`;
  return d < 0 ? `${t} overdue` : `in ${t}`;
}
export function dueTone(at: number): 'red' | 'amber' | 'green' {
  const h = (at - NOW) / H;
  return h < 0 ? 'red' : h < 24 ? 'amber' : 'green';
}
export const fmtDue = (at: number) => new Date(at).toLocaleString('en-US', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });
