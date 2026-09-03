// Audit & Traceability — the system-of-record evidence layer, as opposed to the clinical quality
// audit that lives on each module's own "Audit & Compliance" tab.
//
// Those two get confused constantly, so to be explicit: the module tabs answer "did the nurse
// apply the criteria correctly?" This file answers "can you prove who did what, when, from where,
// and that the record hasn't been altered since?" — HIPAA §164.312(b) audit controls,
// §164.308(a)(1)(ii)(D) information-system activity review, CMS program-audit universes, and the
// delegation-oversight evidence a plan asks a delegated UM/CM vendor to produce.
//
// Everything below is generated deterministically off the existing UM/CM case pools, the same
// RNG-free pattern as the rest of this app: the same case always produces the same event chain, so
// a demo can be walked through twice and land on the same rows.
import { CASE_POOL, CaseRec, NURSES } from './case-pool';
import { CM_CASE_POOL, CARE_MANAGERS } from './cm-case-pool';
import { TODAY, MD_REVIEWERS, lobOf } from './case-fields';

// ---------------------------------------------------------------------------------------------
// Users — the actor roster every event attributes to. Roles here are ACCESS roles (what the system
// lets you do), deliberately distinct from Nav's ROLES (which dashboard you're looking at).
// ---------------------------------------------------------------------------------------------
export type AccessRole =
  | 'UM Nurse Reviewer' | 'Medical Director' | 'UM Supervisor' | 'Care Manager' | 'CM Supervisor'
  | 'Appeals Reviewer' | 'Intake Coordinator' | 'Compliance Analyst' | 'System Administrator' | 'Interface Service Account';

export interface SystemUser {
  userId: string;
  name: string;
  role: AccessRole;
  department: string;
  status: 'Active' | 'Disabled' | 'Locked';
  licensedStates: string[];      // empty for non-clinical roles
  mfaEnrolled: boolean;
  lastAccessReview: string;       // ISO date — when this account's entitlements were last attested
  lastLogin: string;              // ISO date
}

function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(base: Date, days: number): Date { const d = new Date(base); d.setDate(d.getDate() + days); return d; }
function capToday(d: Date): Date { return d.getTime() > TODAY.getTime() ? TODAY : d; }
function pctOf(n: number, d: number): number { return d ? Math.round((n / d) * 100) : 0; }

function userIdOf(name: string, i: number): string {
  const initials = name.replace(/,.*$/, '').split(' ').map((p) => p[0]).join('').toLowerCase();
  return `${initials}${(1000 + i * 7).toString().slice(-4)}`;
}

function buildUsers(): SystemUser[] {
  const out: SystemUser[] = [];
  let i = 0;
  const push = (name: string, role: AccessRole, department: string, states: string[]) => {
    const n = i;
    out.push({
      userId: userIdOf(name, n), name, role, department, status: 'Active', licensedStates: states,
      // MFA gaps are deliberately a small minority — this is one of the governance findings the
      // Access Controls tab surfaces rather than a blanket failure.
      mfaEnrolled: n % 9 !== 4,
      // Entitlement attestation runs on a quarterly cycle; a few accounts have drifted past it.
      lastAccessReview: isoDate(addDays(TODAY, -(30 + (n * 23) % 150))),
      lastLogin: isoDate(capToday(addDays(TODAY, -(n % 6)))),
    });
    i++;
  };
  NURSES.forEach((n) => push(n, 'UM Nurse Reviewer', 'Utilization Management', ['TX', 'FL']));
  MD_REVIEWERS.forEach((n) => push(n, 'Medical Director', 'Utilization Management', ['TX', 'FL', 'GA']));
  CARE_MANAGERS.forEach((cm) => push(cm.name, 'Care Manager', 'Care Management', ['TX']));
  push('Christina Lawson', 'UM Supervisor', 'Utilization Management', []);
  push('Renee Alvarez', 'CM Supervisor', 'Care Management', []);
  push('Daniel Okafor', 'Appeals Reviewer', 'Appeals & Grievances', ['TX']);
  push('Tanya Brooks', 'Intake Coordinator', 'Intake', []);
  push('Priya Shah, RN (QI)', 'Compliance Analyst', 'Quality & Compliance', []);
  push('svc_trucare_hl7', 'Interface Service Account', 'IT Integration', []);
  push('Alan Reyes', 'System Administrator', 'IT Operations', []);
  return out;
}
export const SYSTEM_USERS: SystemUser[] = buildUsers();
export const USER_BY_NAME = new Map(SYSTEM_USERS.map((u) => [u.name, u]));

// ---------------------------------------------------------------------------------------------
// Audit events
// ---------------------------------------------------------------------------------------------
export type AuditCategory =
  | 'Access' | 'Clinical Decision' | 'Case Management' | 'Correspondence'
  | 'Administrative' | 'Configuration' | 'Security' | 'Data Export';
export type AuditChannel = 'Web UI' | 'API' | 'Batch Interface' | 'Fax / OCR Intake' | 'System Rule';
export type AuditEntityType = 'Authorization' | 'CM Case' | 'Member' | 'Appeal' | 'Report' | 'User Account' | 'Configuration';
export type AuditOutcome = 'Success' | 'Denied' | 'Failed';

export interface AuditEvent {
  eventId: string;
  timestamp: string;               // ISO datetime, minute precision
  actor: string;
  actorId: string;
  actorRole: AccessRole;
  category: AuditCategory;
  action: string;
  entityType: AuditEntityType;
  entityId: string;
  memberId: string | null;
  lob: string | null;
  field: string | null;            // what changed, when this event was a change
  before: string | null;
  after: string | null;
  channel: AuditChannel;
  sourceIp: string;
  sessionId: string;
  correlationId: string;           // ties every event on one case together across channels
  reasonCode: string | null;
  phi: boolean;                    // did this event expose protected health information
  outcome: AuditOutcome;
  recordHash: string;              // tamper-evident chain — each event hashes over the previous one
  prevHash: string;
}

/** A small, stable, non-cryptographic digest. Real chain-of-custody uses SHA-256 on the server;
 *  this stands in so the demo can SHOW the chain (and show a verification pass) without pretending
 *  to be the real thing. Any change to an event's content changes its hash and every hash after it,
 *  which is the property the tamper-evidence claim actually rests on. */
function digest(input: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    h1 = ((h1 ^ input.charCodeAt(i)) * 0x01000193) >>> 0;
    h2 = ((h2 + input.charCodeAt(i) * (i + 7)) * 0x85ebca6b) >>> 0;
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).slice(0, 16);
}

function stamp(base: Date, dayOffset: number, minuteOfDay: number): string {
  const d = capToday(addDays(base, dayOffset));
  const hh = Math.floor(minuteOfDay / 60) % 24;
  const mm = minuteOfDay % 60;
  return `${isoDate(d)}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
/** Business hours are 07:00–19:00 local; anything outside is an off-hours access, which is one of
 *  the anomaly signals the User Activity tab reports on. */
export function isOffHours(timestamp: string): boolean {
  const hh = Number(timestamp.slice(11, 13));
  return hh < 7 || hh >= 19;
}
export function eventDate(timestamp: string): string { return timestamp.slice(0, 10); }

const IP_POOL = ['10.42.7.', '10.42.8.', '10.42.9.', '172.19.4.'];
function ipFor(u: SystemUser, n: number): string {
  // Service accounts come from the fixed integration subnet; a small number of user sessions come
  // from outside the corporate range, which the activity tab flags rather than blocks.
  if (u.role === 'Interface Service Account') return '172.19.4.11';
  return n % 23 === 0 ? `203.0.113.${20 + (n % 40)}` : `${IP_POOL[n % 3]}${10 + (n % 200)}`;
}
export function isExternalIp(ip: string): boolean { return ip.startsWith('203.0.113.'); }

interface Draft extends Omit<AuditEvent, 'eventId' | 'recordHash' | 'prevHash'> {}

function umEventsFor(c: CaseRec, i: number): Draft[] {
  const nurse = USER_BY_NAME.get(c.nurse);
  const intake = USER_BY_NAME.get('Tanya Brooks')!;
  const submitted = new Date(`${c.submitted}T00:00:00`);
  const lob = lobOf(c.authId);
  const corr = `COR-${c.authId}`;
  const session = `S-${digest(c.authId).slice(0, 8)}`;
  const memberId = `M${digest(c.member).slice(0, 8).toUpperCase()}`;
  const base = (over: Partial<Draft>): Draft => ({
    timestamp: '', actor: intake.name, actorId: intake.userId, actorRole: intake.role,
    category: 'Case Management', action: '', entityType: 'Authorization', entityId: c.authId,
    memberId, lob, field: null, before: null, after: null,
    channel: 'Web UI', sourceIp: ipFor(intake, i), sessionId: session, correlationId: corr,
    reasonCode: null, phi: true, outcome: 'Success', ...over,
  });
  const out: Draft[] = [];

  // Intake — how the request physically arrived is itself auditable, and it's the first link in
  // the chain a plan asks about when a provider disputes a receipt date.
  const arrival: AuditChannel = c.tags.includes('auto') ? 'API' : i % 3 === 0 ? 'Fax / OCR Intake' : 'Web UI';
  out.push(base({
    timestamp: stamp(submitted, 0, 480 + (i % 300)), action: 'Authorization request received',
    channel: arrival, after: 'Submitted', field: 'Status',
    actor: arrival === 'API' ? 'svc_trucare_hl7' : intake.name,
    actorId: arrival === 'API' ? USER_BY_NAME.get('svc_trucare_hl7')!.userId : intake.userId,
    actorRole: arrival === 'API' ? 'Interface Service Account' : intake.role,
    sourceIp: arrival === 'API' ? '172.19.4.11' : ipFor(intake, i),
  }));
  out.push(base({
    timestamp: stamp(submitted, 0, 495 + (i % 300)), category: 'Access', action: 'Member eligibility verified',
    entityType: 'Member', entityId: memberId, field: null,
  }));

  if (c.tags.includes('auto')) {
    // Auto-approvals still have to be traceable to the rule version that fired — this is the
    // single most-asked question about any automated determination.
    out.push(base({
      timestamp: stamp(submitted, 0, 500 + (i % 300)), category: 'Clinical Decision',
      action: 'Auto-approval rule applied', channel: 'System Rule',
      actor: 'svc_trucare_hl7', actorId: USER_BY_NAME.get('svc_trucare_hl7')!.userId, actorRole: 'Interface Service Account',
      sourceIp: '172.19.4.11', field: 'Decision', before: 'Pending', after: 'Approved',
      reasonCode: `RULE-AUTOAPPROVE-v${3 + (i % 2)}.1`,
    }));
  } else if (nurse) {
    const nb = (over: Partial<Draft>): Draft => base({ actor: nurse.name, actorId: nurse.userId, actorRole: nurse.role, sourceIp: ipFor(nurse, i), ...over });
    out.push(nb({ timestamp: stamp(submitted, 1, 540 + (i % 240)), category: 'Access', action: 'Case opened for review' }));
    out.push(nb({
      timestamp: stamp(submitted, 1, 560 + (i % 240)), category: 'Clinical Decision',
      action: 'Clinical criteria applied', field: 'Guideline', after: `${c.procedure} — criteria set v${2 + (i % 3)}.0`,
      reasonCode: 'CRIT-APPLIED',
    }));
    if (c.tags.includes('rfi')) {
      out.push(nb({
        timestamp: stamp(submitted, 2, 600 + (i % 200)), category: 'Correspondence',
        action: 'Request for information sent to provider', field: 'Status', before: 'In Clinical Review', after: 'Pended — RFI',
        reasonCode: 'RFI-CLINICAL',
      }));
    }
    if (c.tags.includes('mdReview') || c.tags.includes('p2p')) {
      const md = USER_BY_NAME.get(MD_REVIEWERS[Number(c.authId.slice(-2)) % MD_REVIEWERS.length]);
      out.push(nb({ timestamp: stamp(submitted, 2, 620 + (i % 180)), category: 'Case Management', action: 'Case routed to Medical Director', field: 'Assigned To', before: c.nurse, after: md?.name ?? 'Medical Director' }));
      if (md) {
        out.push(base({
          timestamp: stamp(submitted, 3, 630 + (i % 180)), actor: md.name, actorId: md.userId, actorRole: md.role,
          sourceIp: ipFor(md, i), category: 'Clinical Decision', action: 'Medical Director review completed',
          reasonCode: 'MD-REVIEW',
        }));
      }
    }
    if (c.phase === 'decided') {
      // An adverse determination (denial or partial) is a clinician-only action — a nurse reviewer
      // can approve within criteria but cannot deny, so the determination event is attributed to
      // the Medical Director who signed it off, not to the nurse who worked the case. Getting this
      // attribution right is the whole point of SOD-3 on the Governance tab.
      const adverse = c.decision === 'Denied' || c.decision === 'Partial';
      const signer = adverse
        ? USER_BY_NAME.get(MD_REVIEWERS[Number(c.authId.slice(-2)) % MD_REVIEWERS.length]) ?? nurse
        : nurse;
      out.push(nb({
        timestamp: stamp(submitted, 3 + (i % 4), 640 + (i % 160)), category: 'Clinical Decision',
        action: 'Determination recorded', field: 'Decision', before: 'Pending', after: c.decision,
        actor: signer.name, actorId: signer.userId, actorRole: signer.role, sourceIp: ipFor(signer, i),
        reasonCode: c.decision === 'Approved' ? 'DET-MEETS-CRITERIA' : c.decision === 'Denied' ? 'DET-NOT-MEDICALLY-NECESSARY' : 'DET-PARTIAL-LOS',
      }));
      out.push(nb({
        timestamp: stamp(submitted, 3 + (i % 4), 660 + (i % 160)), category: 'Correspondence',
        action: 'Determination letter generated', field: 'Letter', after: `${c.decision} notice — template v${1 + (i % 3)}.2`,
      }));
      out.push(base({
        timestamp: stamp(submitted, 4 + (i % 4), 700 + (i % 120)), category: 'Correspondence',
        action: 'Determination letter transmitted to member', channel: 'Batch Interface',
        actor: 'svc_trucare_hl7', actorId: USER_BY_NAME.get('svc_trucare_hl7')!.userId, actorRole: 'Interface Service Account',
        sourceIp: '172.19.4.11', field: 'Notice Status', after: 'Sent',
      }));
    }
  }
  return out;
}

function cmEventsFor(i: number): Draft[] {
  const c = CM_CASE_POOL[i];
  const cm = USER_BY_NAME.get(c.careManager);
  if (!cm) return [];
  const received = new Date(`${c.received}T00:00:00`);
  const corr = `COR-${c.memberId}`;
  const session = `S-${digest(c.memberId).slice(0, 8)}`;
  const b = (over: Partial<Draft>): Draft => ({
    timestamp: '', actor: cm.name, actorId: cm.userId, actorRole: cm.role,
    category: 'Case Management', action: '', entityType: 'CM Case', entityId: c.memberId,
    memberId: c.memberId, lob: c.lob, field: null, before: null, after: null,
    channel: 'Web UI', sourceIp: ipFor(cm, i), sessionId: session, correlationId: corr,
    reasonCode: null, phi: true, outcome: 'Success', ...over,
  });
  const out: Draft[] = [
    b({ timestamp: stamp(received, 0, 510 + (i % 260)), action: 'Referral accepted into care management', field: 'Stage', after: 'Newly Accepted' }),
    b({ timestamp: stamp(received, 1, 530 + (i % 260)), action: 'Member consent recorded', field: 'Consent', after: `${c.consentType} — expires ${c.consentExpiresDate}`, reasonCode: 'CONSENT-ON-FILE' }),
    b({ timestamp: stamp(received, 2 + (i % 5), 545 + (i % 240)), action: 'Assessment completed', field: 'Assessment', after: `${c.assessmentType} (${c.assessmentTatDays}d)` }),
    b({ timestamp: stamp(new Date(`${c.carePlanOpenedDate}T00:00:00`), 0, 555 + (i % 240)), action: 'Care plan opened', field: 'Care Plan', after: c.carePlanTemplate }),
  ];
  if (!c.outreachSuccessful) {
    out.push(b({ timestamp: stamp(received, 4 + (i % 6), 1140 + (i % 60)), category: 'Correspondence', action: 'Outreach attempt — no contact', field: 'Outreach', after: `${c.outreachAttempts} attempt(s)`, reasonCode: 'UTR' }));
  }
  if (c.carePlanStatus === 'Closed' && c.carePlanClosedDate) {
    out.push(b({ timestamp: stamp(new Date(`${c.carePlanClosedDate}T00:00:00`), 0, 600 + (i % 200)), action: 'Care plan closed', field: 'Care Plan Status', before: 'Open', after: 'Closed', reasonCode: 'GOALS-MET' }));
  }
  return out;
}

/** Security, configuration and export events don't hang off a clinical case — they're the ones a
 *  security or SOC 2 reviewer opens first, so they're generated on their own cadence. */
function operationalEvents(): Draft[] {
  const out: Draft[] = [];
  const admin = USER_BY_NAME.get('Alan Reyes')!;
  const compliance = USER_BY_NAME.get('Priya Shah, RN (QI)')!;
  const supervisor = USER_BY_NAME.get('Christina Lawson')!;
  const users = SYSTEM_USERS.filter((u) => u.role !== 'Interface Service Account');

  // Sign-in / sign-out and failed attempts across the roster.
  users.forEach((u, ui) => {
    for (let d = 0; d < 45; d++) {
      const n = ui * 31 + d * 7;
      if (n % 4 === 3) continue; // not everyone signs in every day
      const day = addDays(TODAY, -d);
      if (day.getDay() === 0 || day.getDay() === 6) { if (n % 11 !== 0) continue; } // weekends are the exception
      const login = 420 + (n % 200);
      out.push({
        timestamp: stamp(day, 0, login), actor: u.name, actorId: u.userId, actorRole: u.role,
        category: 'Access', action: 'Sign-in', entityType: 'User Account', entityId: u.userId,
        memberId: null, lob: null, field: null, before: null, after: null,
        channel: 'Web UI', sourceIp: ipFor(u, n), sessionId: `S-${digest(u.userId + d).slice(0, 8)}`,
        correlationId: `AUTH-${u.userId}-${d}`, reasonCode: u.mfaEnrolled ? 'MFA-OK' : 'PASSWORD-ONLY',
        phi: false, outcome: 'Success',
      });
      if (n % 17 === 0) {
        out.push({
          timestamp: stamp(day, 0, login - 3), actor: u.name, actorId: u.userId, actorRole: u.role,
          category: 'Security', action: 'Failed sign-in attempt', entityType: 'User Account', entityId: u.userId,
          memberId: null, lob: null, field: null, before: null, after: null,
          channel: 'Web UI', sourceIp: ipFor(u, n), sessionId: `S-${digest(u.userId + d).slice(0, 8)}`,
          correlationId: `AUTH-${u.userId}-${d}`, reasonCode: 'BAD-CREDENTIALS', phi: false, outcome: 'Failed',
        });
      }
      // Minimum-necessary check: an attempt to open a record outside the user's assigned scope.
      // Most are correctly denied by role-based access control; a handful proceed under an
      // explicit break-the-glass justification, which is exactly what has to be reviewable.
      if (n % 29 === 0 && (u.role === 'UM Nurse Reviewer' || u.role === 'Care Manager')) {
        const btg = n % 58 === 0;
        out.push({
          timestamp: stamp(day, 0, login + 60), actor: u.name, actorId: u.userId, actorRole: u.role,
          category: 'Security', action: btg ? 'Break-the-glass access granted' : 'Access to unassigned member record denied',
          entityType: 'Member', entityId: `M${digest(u.userId + d).slice(0, 8).toUpperCase()}`,
          memberId: `M${digest(u.userId + d).slice(0, 8).toUpperCase()}`, lob: null,
          field: null, before: null, after: null,
          channel: 'Web UI', sourceIp: ipFor(u, n), sessionId: `S-${digest(u.userId + d).slice(0, 8)}`,
          correlationId: `SEC-${u.userId}-${d}`, reasonCode: btg ? 'BTG-EMERGENT-CARE' : 'RBAC-OUT-OF-SCOPE',
          phi: btg, outcome: btg ? 'Success' : 'Denied',
        });
      }
    }
  });

  // Data exports — every extract of member-level data is itself a PHI disclosure event.
  const exporters = [supervisor, compliance, USER_BY_NAME.get('Renee Alvarez')!];
  for (let k = 0; k < 40; k++) {
    const u = exporters[k % exporters.length];
    const day = addDays(TODAY, -(k * 2 + (k % 3)));
    const rows = 40 + (k * 137) % 4200;
    out.push({
      timestamp: stamp(day, 0, 540 + (k * 17) % 400), actor: u.name, actorId: u.userId, actorRole: u.role,
      category: 'Data Export', action: 'Report exported', entityType: 'Report',
      entityId: ['um-tat-compliance', 'cm-caseload', 'appeals-aging', 'um-denials', 'irr-sample'][k % 5],
      memberId: null, lob: null, field: 'Rows', before: null, after: String(rows),
      channel: 'Web UI', sourceIp: ipFor(u, k), sessionId: `S-${digest(u.userId + k).slice(0, 8)}`,
      correlationId: `EXP-${1000 + k}`, reasonCode: k % 7 === 0 ? 'REG-AUDIT-REQUEST' : 'OPERATIONAL-REVIEW',
      phi: k % 3 !== 0, outcome: 'Success',
    });
  }

  // Configuration changes — criteria sets, auto-approval rules, letter templates, role
  // entitlements. A change here silently rewrites how every subsequent case is decided, so it's
  // the highest-value thing in the log and the first thing a delegation audit asks to see.
  const configs: { entity: string; field: string; before: string; after: string; reason: string }[] = [
    { entity: 'CFG-AUTOAPPROVE', field: 'Auto-approval threshold', before: 'confidence ≥ 0.93', after: 'confidence ≥ 0.95', reason: 'CHG-2026-0412' },
    { entity: 'CFG-CRITERIA-ORTHO', field: 'Criteria set version', before: 'Ortho v2.0', after: 'Ortho v3.0', reason: 'CHG-2026-0431' },
    { entity: 'CFG-LETTER-DENIAL', field: 'Denial notice template', before: 'v1.1', after: 'v1.2', reason: 'CHG-2026-0447' },
    { entity: 'CFG-TAT-MEDICAID', field: 'Medicaid standard TAT', before: '14 days', after: '14 days (expedited 72h)', reason: 'CHG-2026-0455' },
    { entity: 'CFG-ROLE-NURSE', field: 'UM Nurse Reviewer entitlements', before: 'approve, pend', after: 'approve, pend, partial-approve', reason: 'CHG-2026-0468' },
    { entity: 'CFG-RETENTION', field: 'Audit log retention', before: '6 years', after: '10 years', reason: 'CHG-2026-0472' },
  ];
  configs.forEach((cfg, k) => {
    out.push({
      timestamp: stamp(addDays(TODAY, -(9 + k * 11)), 0, 600 + k * 23), actor: admin.name, actorId: admin.userId, actorRole: admin.role,
      category: 'Configuration', action: 'Configuration change published', entityType: 'Configuration', entityId: cfg.entity,
      memberId: null, lob: null, field: cfg.field, before: cfg.before, after: cfg.after,
      channel: 'Web UI', sourceIp: ipFor(admin, k), sessionId: `S-${digest(admin.userId + k).slice(0, 8)}`,
      correlationId: cfg.reason, reasonCode: cfg.reason, phi: false, outcome: 'Success',
    });
    // Two-person control: the publish above is preceded by an approval from someone other than the
    // person making the change. Where that approval is missing, the Governance tab flags it.
    if (k % 3 !== 2) {
      out.push({
        timestamp: stamp(addDays(TODAY, -(9 + k * 11)), 0, 580 + k * 23), actor: supervisor.name, actorId: supervisor.userId, actorRole: supervisor.role,
        category: 'Configuration', action: 'Configuration change approved', entityType: 'Configuration', entityId: cfg.entity,
        memberId: null, lob: null, field: cfg.field, before: null, after: 'Approved',
        channel: 'Web UI', sourceIp: ipFor(supervisor, k), sessionId: `S-${digest(supervisor.userId + k).slice(0, 8)}`,
        correlationId: cfg.reason, reasonCode: 'CHANGE-APPROVAL', phi: false, outcome: 'Success',
      });
    }
  });

  // Account administration.
  ['Enabled', 'Disabled', 'Role changed', 'Password reset'].forEach((a, k) => {
    const target = SYSTEM_USERS[(k * 5 + 2) % SYSTEM_USERS.length];
    out.push({
      timestamp: stamp(addDays(TODAY, -(4 + k * 9)), 0, 570 + k * 31), actor: admin.name, actorId: admin.userId, actorRole: admin.role,
      category: 'Administrative', action: `User account — ${a}`, entityType: 'User Account', entityId: target.userId,
      memberId: null, lob: null, field: 'Account', before: null, after: `${target.name} · ${a}`,
      channel: 'Web UI', sourceIp: ipFor(admin, k), sessionId: `S-${digest(admin.userId + 'adm' + k).slice(0, 8)}`,
      correlationId: `ADM-${2000 + k}`, reasonCode: 'ACCESS-ADMIN', phi: false, outcome: 'Success',
    });
  });

  return out;
}

function buildEvents(): AuditEvent[] {
  const drafts: Draft[] = [
    ...CASE_POOL.flatMap((c, i) => umEventsFor(c, i)),
    ...CM_CASE_POOL.map((_, i) => cmEventsFor(i)).flat(),
    ...operationalEvents(),
  ].sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.entityId.localeCompare(b.entityId));

  // The hash chain is built in timestamp order — that ordering is what makes an inserted or
  // altered event detectable, so it can't be rebuilt per-entity.
  let prevHash = '0000000000000000';
  return drafts.map((d, i): AuditEvent => {
    const eventId = `AE-${String(i + 1).padStart(6, '0')}`;
    const payload = [eventId, d.timestamp, d.actorId, d.action, d.entityType, d.entityId, d.field, d.before, d.after, d.outcome, prevHash].join('|');
    const recordHash = digest(payload);
    const ev: AuditEvent = { ...d, eventId, prevHash, recordHash };
    prevHash = recordHash;
    return ev;
  });
}

export const AUDIT_EVENTS: AuditEvent[] = buildEvents();

/** Re-walks the chain and reports the first break, if any. Backs the "Verify chain" action —
 *  the point of the demo is that this is a check anyone can run, not a claim on a slide. */
export function verifyChain(events: AuditEvent[] = AUDIT_EVENTS): { verified: number; brokenAt: string | null } {
  let prevHash = '0000000000000000';
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const payload = [e.eventId, e.timestamp, e.actorId, e.action, e.entityType, e.entityId, e.field, e.before, e.after, e.outcome, prevHash].join('|');
    if (digest(payload) !== e.recordHash) return { verified: i, brokenAt: e.eventId };
    prevHash = e.recordHash;
  }
  return { verified: events.length, brokenAt: null };
}

// ---------------------------------------------------------------------------------------------
// Governance — entitlements, segregation of duties, access attestation
// ---------------------------------------------------------------------------------------------
export const PERMISSIONS = [
  'View member PHI', 'Approve authorization', 'Deny authorization', 'Override AI recommendation',
  'Reopen closed case', 'Reassign work', 'Export member-level data', 'Publish configuration change', 'Administer user accounts',
] as const;
export type Permission = typeof PERMISSIONS[number];

/** Role → permission grid. 'Yes' / 'No' / a constraint string. Constraints matter more than the
 *  yes/no: "Yes — own caseload only" is a materially different control than an unconditional yes,
 *  and it's the distinction an auditor writes up. */
export const PERMISSION_MATRIX: Record<AccessRole, Partial<Record<Permission, string>>> = {
  'UM Nurse Reviewer': { 'View member PHI': 'Yes — assigned caseload', 'Approve authorization': 'Yes — within criteria', 'Deny authorization': 'No — MD only', 'Override AI recommendation': 'Yes — reason required', 'Reopen closed case': 'No', 'Reassign work': 'No', 'Export member-level data': 'No', 'Publish configuration change': 'No', 'Administer user accounts': 'No' },
  'Medical Director': { 'View member PHI': 'Yes', 'Approve authorization': 'Yes', 'Deny authorization': 'Yes', 'Override AI recommendation': 'Yes — reason required', 'Reopen closed case': 'Yes', 'Reassign work': 'No', 'Export member-level data': 'No', 'Publish configuration change': 'No', 'Administer user accounts': 'No' },
  'UM Supervisor': { 'View member PHI': 'Yes — team caseload', 'Approve authorization': 'No', 'Deny authorization': 'No', 'Override AI recommendation': 'No', 'Reopen closed case': 'Yes', 'Reassign work': 'Yes', 'Export member-level data': 'Yes — logged', 'Publish configuration change': 'Approve only', 'Administer user accounts': 'No' },
  'Care Manager': { 'View member PHI': 'Yes — assigned caseload', 'Approve authorization': 'No', 'Deny authorization': 'No', 'Override AI recommendation': 'No', 'Reopen closed case': 'Yes — own cases', 'Reassign work': 'No', 'Export member-level data': 'No', 'Publish configuration change': 'No', 'Administer user accounts': 'No' },
  'CM Supervisor': { 'View member PHI': 'Yes — team caseload', 'Approve authorization': 'No', 'Deny authorization': 'No', 'Override AI recommendation': 'No', 'Reopen closed case': 'Yes', 'Reassign work': 'Yes', 'Export member-level data': 'Yes — logged', 'Publish configuration change': 'No', 'Administer user accounts': 'No' },
  'Appeals Reviewer': { 'View member PHI': 'Yes — appeal scope', 'Approve authorization': 'Yes — appeal outcome', 'Deny authorization': 'Yes — appeal outcome', 'Override AI recommendation': 'Yes — reason required', 'Reopen closed case': 'Yes', 'Reassign work': 'No', 'Export member-level data': 'No', 'Publish configuration change': 'No', 'Administer user accounts': 'No' },
  'Intake Coordinator': { 'View member PHI': 'Yes — demographic & eligibility only', 'Approve authorization': 'No', 'Deny authorization': 'No', 'Override AI recommendation': 'No', 'Reopen closed case': 'No', 'Reassign work': 'Yes — unassigned queue', 'Export member-level data': 'No', 'Publish configuration change': 'No', 'Administer user accounts': 'No' },
  'Compliance Analyst': { 'View member PHI': 'Yes — audit scope, read-only', 'Approve authorization': 'No', 'Deny authorization': 'No', 'Override AI recommendation': 'No', 'Reopen closed case': 'No', 'Reassign work': 'No', 'Export member-level data': 'Yes — logged', 'Publish configuration change': 'No', 'Administer user accounts': 'No' },
  'System Administrator': { 'View member PHI': 'No — masked', 'Approve authorization': 'No', 'Deny authorization': 'No', 'Override AI recommendation': 'No', 'Reopen closed case': 'No', 'Reassign work': 'No', 'Export member-level data': 'No', 'Publish configuration change': 'Yes — with approval', 'Administer user accounts': 'Yes' },
  'Interface Service Account': { 'View member PHI': 'Yes — transport only', 'Approve authorization': 'Yes — rule-driven', 'Deny authorization': 'No', 'Override AI recommendation': 'No', 'Reopen closed case': 'No', 'Reassign work': 'No', 'Export member-level data': 'No', 'Publish configuration change': 'No', 'Administer user accounts': 'No' },
};

export interface SodRule { id: string; name: string; detail: string; citation: string; }
export const SOD_RULES: SodRule[] = [
  { id: 'SOD-1', name: 'Appeal reviewed by the original decision-maker', detail: 'The person who made the adverse determination must not decide its appeal.', citation: '42 CFR §438.406(b)(2) · §422.590' },
  { id: 'SOD-2', name: 'Configuration change published without independent approval', detail: 'The person publishing a rule, criteria set, or letter template change must not be its only approver.', citation: 'SOC 2 CC8.1 · NCQA UM 2' },
  { id: 'SOD-3', name: 'Denial issued by a non-clinician', detail: 'A medical-necessity denial must be made by a qualified clinician, not administrative staff.', citation: '42 CFR §438.210(b)(3) · NCQA UM 4' },
  { id: 'SOD-4', name: 'Administrator with standing PHI access', detail: 'System administration and clinical PHI access should not sit on the same account.', citation: 'HIPAA §164.308(a)(4) — minimum necessary' },
];

// ---------------------------------------------------------------------------------------------
// Compliance requirement register — the source for the "gaps / priority / next steps" conversation
// ---------------------------------------------------------------------------------------------
export type ControlStatus = 'Met' | 'Partial' | 'Gap';
export type Priority = 'P1' | 'P2' | 'P3';
export interface ComplianceRequirement {
  id: string;
  domain: 'Audit Trail' | 'User Activity' | 'Access Governance' | 'Reporting & Extracts' | 'Retention & Integrity';
  requirement: string;
  citation: string;
  control: string;            // what the platform does today
  evidence: string;           // where a reviewer sees it in this app
  status: ControlStatus;
  priority: Priority;
  gap: string | null;
  nextStep: string | null;
  owner: string;
}

export const COMPLIANCE_REGISTER: ComplianceRequirement[] = [
  { id: 'REQ-01', domain: 'Audit Trail', requirement: 'Record and examine activity in systems containing ePHI', citation: 'HIPAA §164.312(b)', control: 'Every create/read/update on an auth, CM case, member, or appeal writes an immutable event with actor, role, timestamp, channel, source IP and correlation ID.', evidence: 'Audit Trail tab — filter by entity or actor', status: 'Met', priority: 'P1', gap: null, nextStep: null, owner: 'Platform Engineering' },
  { id: 'REQ-02', domain: 'Retention & Integrity', requirement: 'Audit records are tamper-evident and retained for the required period', citation: 'HIPAA §164.316(b)(2) · CMS 10-year', control: 'Events are hash-chained in timestamp order; retention is configured at 10 years and the change itself is logged.', evidence: 'Audit Trail — Verify chain', status: 'Met', priority: 'P1', gap: null, nextStep: null, owner: 'Platform Engineering' },
  { id: 'REQ-03', domain: 'User Activity', requirement: 'Regular review of information-system activity', citation: 'HIPAA §164.308(a)(1)(ii)(D)', control: 'Per-user activity rollups with off-hours, external-IP, failed sign-in, unassigned-record and bulk-export signals.', evidence: 'User Activity tab', status: 'Partial', priority: 'P1', gap: 'Review is available on demand but there is no scheduled attestation that a named reviewer looked at it, and no sign-off record.', nextStep: 'Add a monthly activity-review task with reviewer sign-off captured as its own audit event.', owner: 'Compliance' },
  { id: 'REQ-04', domain: 'User Activity', requirement: 'Break-the-glass access is justified and reviewed', citation: 'HIPAA §164.308(a)(4) — minimum necessary', control: 'Out-of-scope record access is denied by default; emergent access requires a reason code and is logged as PHI disclosure.', evidence: 'User Activity — Break-the-glass', status: 'Partial', priority: 'P1', gap: 'Reason codes are captured but free-text justification is not required, and nothing forces a follow-up review within a set window.', nextStep: 'Require narrative justification at the point of access and auto-route each event to Compliance for 5-day review.', owner: 'Compliance' },
  { id: 'REQ-05', domain: 'Access Governance', requirement: 'Role-based access enforces minimum necessary', citation: 'HIPAA §164.308(a)(3)-(4) · NCQA UM 2', control: 'Nine access roles with per-permission constraints; PHI is scoped to assigned caseload for reviewer roles and masked for administrators.', evidence: 'Governance & Access — permission matrix', status: 'Met', priority: 'P2', gap: null, nextStep: null, owner: 'IT Operations' },
  { id: 'REQ-06', domain: 'Access Governance', requirement: 'Periodic entitlement review and attestation', citation: 'SOC 2 CC6.2 · HIPAA §164.308(a)(3)(ii)(B)', control: 'Each account carries a last-attested date surfaced against a 90-day cycle.', evidence: 'Governance & Access — attestation status', status: 'Partial', priority: 'P1', gap: 'Attestation is tracked but not enforced — an account past its cycle keeps full access.', nextStep: 'Escalate at 90 days and auto-suspend entitlements at 120 unless re-attested.', owner: 'IT Operations' },
  { id: 'REQ-07', domain: 'Access Governance', requirement: 'Segregation of duties between decision and appeal', citation: '42 CFR §438.406(b)(2) · §422.590', control: 'The appeal assignment check compares the appeal reviewer against the original determination actor recorded in the audit trail.', evidence: 'Governance & Access — SOD conflicts', status: 'Met', priority: 'P1', gap: null, nextStep: null, owner: 'UM Operations' },
  { id: 'REQ-08', domain: 'Access Governance', requirement: 'Multi-factor authentication on all accounts with PHI access', citation: 'HIPAA Security Rule (proposed) · SOC 2 CC6.1', control: 'MFA enrollment is tracked per account and recorded on each sign-in event.', evidence: 'Governance & Access — MFA coverage', status: 'Gap', priority: 'P1', gap: 'A minority of accounts still authenticate with password only, including at least one with standing PHI access.', nextStep: 'Enforce MFA at the identity provider and disable password-only sign-in for every clinical role.', owner: 'IT Operations' },
  { id: 'REQ-09', domain: 'Audit Trail', requirement: 'Automated determinations are traceable to the rule version that produced them', citation: 'NCQA UM 2 · CMS delegation oversight', control: 'Auto-approval events carry the firing rule and version as the reason code, and rule changes are themselves logged with before/after.', evidence: 'Audit Trail — filter Configuration', status: 'Met', priority: 'P1', gap: null, nextStep: null, owner: 'Clinical Content' },
  { id: 'REQ-10', domain: 'Reporting & Extracts', requirement: 'Produce program-audit universes on request within the required window', citation: 'CMS Program Audit — ODAG / CDAG', control: 'Reports module generates filtered, dated extracts with provenance; audit-trail extracts are exportable per entity or actor.', evidence: 'Reports module · Audit Trail export', status: 'Partial', priority: 'P2', gap: 'Extracts are not yet shaped to the CMS ODAG/CDAG record layouts, so a universe request still needs manual reformatting.', nextStep: 'Add ODAG/CDAG universe templates with field-level mapping and a record-count reconciliation page.', owner: 'Reporting' },
  { id: 'REQ-11', domain: 'Reporting & Extracts', requirement: 'Delegated-entity oversight reporting to the plan', citation: 'CMS 42 CFR §422.504(i) · NCQA DEL', control: 'Module-level compliance tabs (UM/CM IRR, regulatory TAT, file audit) export as evidence packets.', evidence: 'UM & CM Audit & Compliance tabs', status: 'Partial', priority: 'P2', gap: 'Evidence is exportable per widget; there is no single dated oversight packet assembling every required artifact.', nextStep: 'Add a one-click "Delegation Oversight Packet" that bundles the standard artifact set with a cover page and generation hash.', owner: 'Compliance' },
  { id: 'REQ-12', domain: 'Retention & Integrity', requirement: 'Audit data is exportable to the plan\'s own SIEM / long-term store', citation: 'SOC 2 CC7.2 · plan security requirements', control: 'Audit events export as CSV on demand.', evidence: 'Audit Trail — Export', status: 'Gap', priority: 'P2', gap: 'No streaming or scheduled feed — a plan wanting continuous ingestion into its own SIEM has to pull manually.', nextStep: 'Expose an append-only audit event API and a nightly signed batch feed.', owner: 'Platform Engineering' },
  { id: 'REQ-13', domain: 'User Activity', requirement: 'Alerting on anomalous access patterns', citation: 'SOC 2 CC7.2 · HIPAA §164.308(a)(6)', control: 'Anomaly signals are computed and displayed.', evidence: 'User Activity — flagged users', status: 'Gap', priority: 'P2', gap: 'Signals are visible in the dashboard only — nothing notifies anyone when a threshold is crossed.', nextStep: 'Define thresholds per signal and route breaches to Compliance as a work item, not just a tile.', owner: 'Compliance' },
  { id: 'REQ-14', domain: 'Audit Trail', requirement: 'Member-facing disclosure accounting', citation: 'HIPAA §164.528', control: 'PHI disclosure events (letters, exports, break-the-glass) are individually flagged in the trail.', evidence: 'Audit Trail — PHI filter', status: 'Partial', priority: 'P3', gap: 'The underlying events exist, but there is no per-member accounting-of-disclosures report a member request could be answered with.', nextStep: 'Add a member-scoped disclosure report covering the trailing 6 years.', owner: 'Compliance' },
];

export function registerCounts(rows: ComplianceRequirement[] = COMPLIANCE_REGISTER) {
  const met = rows.filter((r) => r.status === 'Met').length;
  const partial = rows.filter((r) => r.status === 'Partial').length;
  const gap = rows.filter((r) => r.status === 'Gap').length;
  return { met, partial, gap, total: rows.length, coverage: pctOf(met, rows.length) };
}
