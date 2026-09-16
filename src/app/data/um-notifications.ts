// UM notification (notice) compliance — a notice is its own regulated obligation with its own
// clock, not a byline on the determination that triggered it. That distinction is the whole reason
// this module exists:
//
//   * ONE determination produces SEVERAL notices. A denial notifies the member and the provider —
//     two recipients, two clocks, two ways to be late. Reporting "Late Notices: 4" across both is
//     unusable, because the member notice is the one with an appeal-rights consequence.
//   * An expedited adverse determination is commonly satisfied ORALLY first, with written notice
//     following within a few days. Those are two obligations on one decision, and a plan can meet
//     the first and miss the second. Nothing that measures decisions rather than notices can see
//     that at all.
//   * A notice can be sent on time and still fail — a bad address, a dead fax line. "Sent" and
//     "delivered" are different claims, and an auditor asks about the second.
//
// Deadlines below are directional and CONFIGURABLE per client, exactly like REG_THRESHOLDS in
// dashboard-data.ts. State Medicaid programmes vary considerably and contracts tighten these
// further; Compliance validates the exact values per tenant. What is not negotiable is the shape:
// deadline = f(line of business, urgency, notice type, form).
import { CASE_POOL, CaseRec } from './case-pool';
import { LOBS, lobOf, urgencyOf, daysAgo, TODAY } from './case-fields';

export type NoticeType =
  | 'Adverse determination'
  | 'Partial approval'
  | 'Approval'
  | 'Extension of timeframe'
  | 'Request for information'
  | 'Peer-to-peer offer'
  | 'Termination of service';

export type NoticeRecipient = 'Member' | 'Provider' | 'Authorized representative' | 'Facility';
export type NoticeForm = 'Oral' | 'Written';
export type NoticeMethod = 'Member portal' | 'Provider portal' | 'Fax' | 'Mail' | 'Secure email' | 'Telephone';
/** Delivered-but-late and never-sent are different failures with different remedies, so they are
 *  different statuses rather than one "non-compliant" bucket. */
export type NoticeStatus = 'Sent on time' | 'Sent late' | 'Not sent' | 'Undeliverable' | 'Pending';

export const NOTICE_TYPES: NoticeType[] = [
  'Adverse determination', 'Partial approval', 'Approval', 'Extension of timeframe',
  'Request for information', 'Peer-to-peer offer', 'Termination of service',
];
export const NOTICE_RECIPIENTS: NoticeRecipient[] = ['Member', 'Provider', 'Authorized representative', 'Facility'];
export const NOTICE_METHODS: NoticeMethod[] = ['Member portal', 'Provider portal', 'Fax', 'Mail', 'Secure email', 'Telephone'];
export const NOTICE_STATUSES: NoticeStatus[] = ['Sent on time', 'Sent late', 'Not sent', 'Undeliverable', 'Pending'];
export const NOTICE_FORMS: NoticeForm[] = ['Oral', 'Written'];

/** Hours from the triggering event to the deadline. `oralHours` is set only where an oral notice is
 *  a distinct obligation ahead of the written one — that is the case a decision-level report cannot
 *  represent. */
interface NoticeRule {
  standardHours: number;
  expeditedHours: number;
  oralHours?: number;
  citation: string;
}

const RULES: Record<string, Partial<Record<NoticeType, NoticeRule>>> = {
  'Medicaid': {
    'Adverse determination':   { standardHours: 14 * 24, expeditedHours: 72, oralHours: 24, citation: '42 CFR §438.404' },
    'Partial approval':        { standardHours: 14 * 24, expeditedHours: 72, oralHours: 24, citation: '42 CFR §438.404' },
    'Approval':                { standardHours: 14 * 24, expeditedHours: 72, citation: '42 CFR §438.210' },
    'Extension of timeframe':  { standardHours: 14 * 24, expeditedHours: 72, citation: '42 CFR §438.404(c)' },
    'Request for information': { standardHours: 48, expeditedHours: 24, citation: 'Plan policy' },
    'Peer-to-peer offer':      { standardHours: 24, expeditedHours: 24, citation: 'Plan policy' },
    'Termination of service':  { standardHours: 48, expeditedHours: 48, citation: '42 CFR §438.404(c)(1)' },
  },
  'Medicare Advantage': {
    'Adverse determination':   { standardHours: 14 * 24, expeditedHours: 72, oralHours: 24, citation: '42 CFR §422.568' },
    'Partial approval':        { standardHours: 14 * 24, expeditedHours: 72, oralHours: 24, citation: '42 CFR §422.568' },
    'Approval':                { standardHours: 14 * 24, expeditedHours: 72, citation: '42 CFR §422.568' },
    'Extension of timeframe':  { standardHours: 14 * 24, expeditedHours: 72, citation: '42 CFR §422.568(b)' },
    'Request for information': { standardHours: 48, expeditedHours: 24, citation: 'Plan policy' },
    'Peer-to-peer offer':      { standardHours: 24, expeditedHours: 24, citation: 'Plan policy' },
    'Termination of service':  { standardHours: 48, expeditedHours: 48, citation: '42 CFR §422.624 (NOMNC)' },
  },
  'Commercial PPO': {
    'Adverse determination':   { standardHours: 15 * 24, expeditedHours: 72, oralHours: 24, citation: 'ERISA §2560.503-1' },
    'Partial approval':        { standardHours: 15 * 24, expeditedHours: 72, oralHours: 24, citation: 'ERISA §2560.503-1' },
    'Approval':                { standardHours: 15 * 24, expeditedHours: 72, citation: 'ERISA §2560.503-1' },
    'Extension of timeframe':  { standardHours: 15 * 24, expeditedHours: 72, citation: 'ERISA §2560.503-1(f)' },
    'Request for information': { standardHours: 48, expeditedHours: 24, citation: 'Plan policy' },
    'Peer-to-peer offer':      { standardHours: 24, expeditedHours: 24, citation: 'Plan policy' },
    'Termination of service':  { standardHours: 48, expeditedHours: 48, citation: 'Plan policy' },
  },
  'ACA Exchange': {
    'Adverse determination':   { standardHours: 15 * 24, expeditedHours: 72, oralHours: 24, citation: 'ACA §2719' },
    'Partial approval':        { standardHours: 15 * 24, expeditedHours: 72, oralHours: 24, citation: 'ACA §2719' },
    'Approval':                { standardHours: 15 * 24, expeditedHours: 72, citation: 'ACA §2719' },
    'Extension of timeframe':  { standardHours: 15 * 24, expeditedHours: 72, citation: 'ACA §2719' },
    'Request for information': { standardHours: 48, expeditedHours: 24, citation: 'Plan policy' },
    'Peer-to-peer offer':      { standardHours: 24, expeditedHours: 24, citation: 'Plan policy' },
    'Termination of service':  { standardHours: 48, expeditedHours: 48, citation: 'Plan policy' },
  },
};

export function noticeRuleFor(lob: string, type: NoticeType): NoticeRule {
  return RULES[lob]?.[type] ?? { standardHours: 14 * 24, expeditedHours: 72, citation: 'Plan policy' };
}

/** Per-attribute string hash. Deliberately NOT `Number(authId.slice(-2)) % n` — that pattern
 *  correlates every derived attribute to the same two digits, so method, delay and failure reason
 *  all move together and the data stops looking like anything. The salt decorrelates them. */
function h(seed: string, salt: string): number {
  let x = 2166136261;
  const s = `${salt}:${seed}`;
  for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); }
  return (x >>> 0);
}
const pick = <T,>(arr: T[], seed: string, salt: string): T => arr[h(seed, salt) % arr.length];

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addHours(base: Date, hours: number): Date { return new Date(base.getTime() + hours * 3600000); }
function stamp(d: Date): string { return `${isoOf(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }

export interface UmNotice {
  noticeId: string;
  authId: string;
  member: string;
  lob: string;
  urgency: 'Expedited' | 'Standard';
  type: NoticeType;
  recipient: NoticeRecipient;
  form: NoticeForm;
  method: NoticeMethod;
  /** The determination or event that starts this notice's clock. */
  triggeredAt: string;
  dueAt: string;
  sentAt: string | null;
  status: NoticeStatus;
  /** Elapsed hours from trigger to send. Null when nothing was sent. */
  hoursToSend: number | null;
  /** 0 unless late. Ranking by this is how a supervisor finds the ones that actually matter. */
  hoursLate: number;
  failureReason: string | null;
  citation: string;
}

const METHOD_FOR: Record<NoticeRecipient, NoticeMethod[]> = {
  'Member': ['Member portal', 'Mail', 'Telephone'],
  'Authorized representative': ['Mail', 'Secure email', 'Telephone'],
  'Provider': ['Provider portal', 'Fax', 'Secure email'],
  'Facility': ['Fax', 'Provider portal'],
};
const FAILURE_REASONS = ['Address not on file', 'Fax transmission failed', 'Portal delivery bounced', 'Returned undeliverable'];

/** Which notices one authorization owes. Driven by the decision and the case's own tags, so the
 *  notice set is a consequence of what happened to the case rather than a separate invention. */
function obligationsFor(c: CaseRec): { type: NoticeType; recipient: NoticeRecipient; form: NoticeForm }[] {
  const out: { type: NoticeType; recipient: NoticeRecipient; form: NoticeForm }[] = [];
  const expedited = c.tags.includes('expedited');

  if (c.decision === 'Denied' || c.decision === 'Partial') {
    const type: NoticeType = c.decision === 'Denied' ? 'Adverse determination' : 'Partial approval';
    // Expedited adverse determinations are satisfied orally first, written following. Two
    // obligations on one decision — a plan can meet the first and miss the second.
    if (expedited) out.push({ type, recipient: 'Member', form: 'Oral' });
    out.push({ type, recipient: 'Member', form: 'Written' });
    out.push({ type, recipient: 'Provider', form: 'Written' });
    // An authorized representative only receives notice where one is on file.
    if (h(c.authId, 'ar') % 9 === 0) out.push({ type, recipient: 'Authorized representative', form: 'Written' });
  } else if (c.decision === 'Approved') {
    out.push({ type: 'Approval', recipient: 'Provider', form: 'Written' });
    if (h(c.authId, 'memberapproval') % 3 !== 0) out.push({ type: 'Approval', recipient: 'Member', form: 'Written' });
  }

  if (c.tags.includes('rfi') || c.tags.includes('incompleteDoc')) out.push({ type: 'Request for information', recipient: 'Provider', form: 'Written' });
  if (c.tags.includes('paused')) out.push({ type: 'Extension of timeframe', recipient: 'Member', form: 'Written' });
  // A peer-to-peer offer is made by telephone, so it is an oral obligation by nature.
  if (c.status === 'Pending P2P' || c.tags.includes('mdReview')) out.push({ type: 'Peer-to-peer offer', recipient: 'Provider', form: 'Oral' });
  if (c.tags.includes('concurrent') && c.decision !== 'Approved') out.push({ type: 'Termination of service', recipient: 'Facility', form: 'Written' });

  return out;
}

function buildNotices(): UmNotice[] {
  const out: UmNotice[] = [];
  for (const c of CASE_POOL) {
    const lob = lobOf(c.authId);
    const urgency = urgencyOf(c);
    const expedited = urgency === 'Expedited';
    obligationsFor(c).forEach((ob, idx) => {
      const seed = `${c.authId}|${ob.type}|${ob.recipient}|${ob.form}`;
      const rule = noticeRuleFor(lob, ob.type);
      const dueHours = ob.form === 'Oral' && rule.oralHours !== undefined
        ? rule.oralHours
        : (expedited ? rule.expeditedHours : rule.standardHours);

      // The clock starts at the determination, which sits a little after submission.
      const triggered = addHours(new Date(`${c.submitted}T09:00:00`), (h(seed, 'trig') % 40) + 4);
      const due = addHours(triggered, dueHours);

      // Most notices go out well inside the window. The tail is what the report is for.
      const roll = h(seed, 'roll') % 1000;
      let status: NoticeStatus;
      let sent: Date | null;
      if (roll < 18) {               // never sent
        status = due < TODAY ? 'Not sent' : 'Pending';
        sent = null;
      } else if (roll < 40) {        // sent, then failed to land
        status = 'Undeliverable';
        sent = addHours(triggered, Math.round(dueHours * (0.2 + (h(seed, 'early') % 60) / 100)));
      } else if (roll < 112) {       // late
        status = 'Sent late';
        sent = addHours(due, 1 + (h(seed, 'late') % 96));
      } else {
        status = 'Sent on time';
        sent = addHours(triggered, Math.max(1, Math.round(dueHours * (0.08 + (h(seed, 'ontime') % 70) / 100))));
      }
      if (sent && sent > TODAY) sent = addHours(TODAY, -(h(seed, 'clip') % 20) - 1);

      const hoursToSend = sent ? Math.max(0, Math.round((sent.getTime() - triggered.getTime()) / 3600000)) : null;
      const hoursLate = status === 'Sent late' && sent ? Math.max(1, Math.round((sent.getTime() - due.getTime()) / 3600000))
        : status === 'Not sent' ? Math.max(1, Math.round((TODAY.getTime() - due.getTime()) / 3600000))
        : 0;

      out.push({
        noticeId: `NT-${c.authId}-${idx + 1}`,
        authId: c.authId,
        member: c.member,
        lob,
        urgency,
        type: ob.type,
        recipient: ob.recipient,
        form: ob.form,
        method: ob.form === 'Oral' ? 'Telephone' : pick(METHOD_FOR[ob.recipient].filter((m) => m !== 'Telephone'), seed, 'method'),
        triggeredAt: stamp(triggered),
        dueAt: stamp(due),
        sentAt: sent ? stamp(sent) : null,
        status,
        hoursToSend,
        hoursLate,
        failureReason: status === 'Undeliverable' ? pick(FAILURE_REASONS, seed, 'fail') : null,
        citation: rule.citation,
      });
    });
  }
  return out;
}

export const UM_NOTICES: UmNotice[] = buildNotices();

/** A notice counts as compliant when it reached its recipient within the window. Undeliverable is
 *  deliberately NOT compliant however promptly it was sent — an undelivered notice has not given
 *  anyone their appeal rights, which is the point of the obligation. */
export function isCompliant(n: UmNotice): boolean { return n.status === 'Sent on time'; }
/** Pending notices are not yet failures and are excluded from rate denominators — counting them as
 *  misses would make every recent period look worse than it is. */
export function isResolved(n: UmNotice): boolean { return n.status !== 'Pending'; }

export interface NoticeFilters {
  lob?: string | string[];
  withinDays?: number;
  type?: string;
  recipient?: string;
  method?: string;
  status?: string;
  urgency?: string;
  form?: string;
  memberSearch?: string;
}

const matchesLob = (n: UmNotice, lob?: string | string[]) =>
  !lob || lob === 'all' || (Array.isArray(lob) ? (lob.length === 0 || lob.includes(n.lob)) : n.lob === lob);
const any = (v: string | undefined) => !v || v === 'All';

export function noticeScope(f: NoticeFilters): UmNotice[] {
  const search = f.memberSearch?.trim().toLowerCase();
  return UM_NOTICES.filter((n) =>
    matchesLob(n, f.lob)
    && (f.withinDays === undefined || daysAgo(n.triggeredAt.slice(0, 10)) <= f.withinDays)
    && (any(f.type) || n.type === f.type)
    && (any(f.recipient) || n.recipient === f.recipient)
    && (any(f.method) || n.method === f.method)
    && (any(f.status) || n.status === f.status)
    && (any(f.urgency) || n.urgency === f.urgency)
    && (any(f.form) || n.form === f.form)
    && (!search || n.member.toLowerCase().includes(search) || n.authId.toLowerCase().includes(search)));
}

export interface NoticeRollup {
  key: string;
  total: number;
  onTime: number;
  late: number;
  notSent: number;
  undeliverable: number;
  pending: number;
  compliancePct: number;
  avgHoursToSend: number;
  worstHoursLate: number;
}

export function rollup(rows: UmNotice[], keyOf: (n: UmNotice) => string, order?: string[]): NoticeRollup[] {
  const keys = order ?? [...new Set(rows.map(keyOf))].sort();
  return keys.map((key) => {
    const grp = rows.filter((n) => keyOf(n) === key);
    const resolved = grp.filter(isResolved);
    const onTime = grp.filter((n) => n.status === 'Sent on time').length;
    const sentRows = grp.filter((n) => n.hoursToSend !== null);
    return {
      key,
      total: grp.length,
      onTime,
      late: grp.filter((n) => n.status === 'Sent late').length,
      notSent: grp.filter((n) => n.status === 'Not sent').length,
      undeliverable: grp.filter((n) => n.status === 'Undeliverable').length,
      pending: grp.filter((n) => n.status === 'Pending').length,
      compliancePct: resolved.length ? Math.round((onTime / resolved.length) * 100) : 0,
      avgHoursToSend: sentRows.length ? Math.round(sentRows.reduce((s, n) => s + (n.hoursToSend ?? 0), 0) / sentRows.length) : 0,
      worstHoursLate: grp.reduce((m, n) => Math.max(m, n.hoursLate), 0),
    };
  }).filter((r) => r.total > 0);
}

export const rollupRow = (r: NoticeRollup): (string | number)[] =>
  [r.key, r.total, r.onTime, r.late, r.notSent, r.undeliverable, `${r.compliancePct}%`, r.avgHoursToSend, r.worstHoursLate || '—'];
export const ROLLUP_COLUMNS = ['Total', 'On Time', 'Late', 'Not Sent', 'Undeliverable', 'Compliance %', 'Avg Hrs to Send', 'Worst Hrs Late'];

export const NOTICE_COLUMNS = ['Notice ID', 'Auth ID', 'Member', 'LOB', 'Urgency', 'Type', 'Recipient', 'Form', 'Method', 'Triggered', 'Due', 'Sent', 'Status', 'Hrs Late', 'Failure Reason', 'Citation'];
export const noticeRow = (n: UmNotice): (string | number)[] => [
  n.noticeId, n.authId, n.member, n.lob, n.urgency, n.type, n.recipient, n.form, n.method,
  n.triggeredAt, n.dueAt, n.sentAt ?? '—', n.status, n.hoursLate || '—', n.failureReason ?? '—', n.citation,
];

/** Headline figures for the summary block, and for the TAT report's notification section — which
 *  previously carried modulo-derived placeholders and a hardcoded average. */
export function noticeSummary(rows: UmNotice[]) {
  const resolved = rows.filter(isResolved);
  const member = rows.filter((n) => n.recipient === 'Member' || n.recipient === 'Authorized representative');
  const provider = rows.filter((n) => n.recipient === 'Provider' || n.recipient === 'Facility');
  const rate = (g: UmNotice[]) => {
    const r = g.filter(isResolved);
    return r.length ? Math.round((g.filter(isCompliant).length / r.length) * 100) : 0;
  };
  const sent = rows.filter((n) => n.hoursToSend !== null);
  return {
    total: rows.length,
    memberPct: rate(member),
    providerPct: rate(provider),
    overallPct: resolved.length ? Math.round((rows.filter(isCompliant).length / resolved.length) * 100) : 0,
    avgHoursToSend: sent.length ? Math.round(sent.reduce((s, n) => s + (n.hoursToSend ?? 0), 0) / sent.length) : 0,
    late: rows.filter((n) => n.status === 'Sent late').length,
    notSent: rows.filter((n) => n.status === 'Not sent').length,
    undeliverable: rows.filter((n) => n.status === 'Undeliverable').length,
    pending: rows.filter((n) => n.status === 'Pending').length,
  };
}

export const NOTICE_LOBS = LOBS;
