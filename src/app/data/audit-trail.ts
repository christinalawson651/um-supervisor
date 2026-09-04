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
import { AI_DECISIONS } from './ai-oversight';

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

/** The model's recommendation for an authorization, keyed for the event generator below. The trail
 *  and the AI Oversight tab read the same records, so a determination's audit history can never
 *  say something different from the oversight metrics. */
const AI_BY_AUTH = new Map(AI_DECISIONS.map((r) => [r.authId, r]));

// ---------------------------------------------------------------------------------------------
// Policy resolution — market, state and line of business
// ---------------------------------------------------------------------------------------------
// "How do you ensure the correct criteria, policy version, market, state and line-of-business rules
// were applied to this case?" is a question about the SELECTION, not the criteria. Two plans in two
// states can sit under the same line of business and be governed by different policy, and a trail
// that records which criteria were applied without recording why THOSE criteria answers only half
// of it.
//
// So policy resolution is modelled as its own auditable step: the inputs that determined the
// selection, the policy version it resolved to, and the basis. State and market are deterministic
// per member, the same way every other attribute in this demo is.

export const STATES_BY_LOB: Record<string, string[]> = {
  'Medicaid': ['TX', 'FL', 'GA'],
  'Medicare Advantage': ['TX', 'FL', 'AZ'],
  'Commercial PPO': ['TX', 'IL'],
  'ACA Exchange': ['FL', 'GA'],
};
const MARKET_BY_STATE: Record<string, string> = {
  TX: 'TX — Central', FL: 'FL — South', GA: 'GA — Metro Atlanta', AZ: 'AZ — Maricopa', IL: 'IL — Chicagoland',
};

export function stateOf(authId: string, lob: string): string {
  const pool = STATES_BY_LOB[lob] ?? ['TX'];
  // Not `n % pool.length`: the line of business is itself `n % 4`, so within one LOB every case
  // shares a residue and a two-state pool collapsed to a single state — every Commercial PPO case
  // landed in Texas and none in Illinois. Hashing breaks the shared modulus.
  return pool[parseInt(digest(authId + '|state').slice(0, 4), 16) % pool.length];
}
export function marketOf(state: string): string { return MARKET_BY_STATE[state] ?? state; }

export interface PolicyRule {
  lob: string; state: string; policyVersion: string; basis: string; citation: string;
  /** True where a state rule displaces the national policy. Carried as a flag rather than inferred
   *  from the wording of `basis` — "no state override" contains the word override, and a chip that
   *  reads the prose gets that backwards. */
  stateRule: boolean;
}
/** Which policy governs a case. State overrides exist where a state Medicaid programme or DOI rule
 *  is stricter than the national line-of-business policy — that is the case an auditor probes,
 *  because applying the national policy in a state that has its own is a real finding. */
export const POLICY_RULES: PolicyRule[] = [
  { lob: 'Medicaid', state: 'TX', policyVersion: 'MCD-TX v3.1', basis: 'State Medicaid programme rules override the national policy', citation: 'TX HHSC UM policy · 42 CFR §438.210' , stateRule: true },
  { lob: 'Medicaid', state: 'FL', policyVersion: 'MCD-FL v2.8', basis: 'State Medicaid programme rules override the national policy', citation: 'FL AHCA UM policy · 42 CFR §438.210' , stateRule: true },
  { lob: 'Medicaid', state: 'GA', policyVersion: 'MCD-GA v2.4', basis: 'State Medicaid programme rules override the national policy', citation: 'GA DCH UM policy · 42 CFR §438.210' , stateRule: true },
  { lob: 'Medicare Advantage', state: 'TX', policyVersion: 'MA-NAT v5.0', basis: 'National Medicare Advantage policy — no state override', citation: '42 CFR §422.101 · NCD/LCD' , stateRule: false },
  { lob: 'Medicare Advantage', state: 'FL', policyVersion: 'MA-NAT v5.0', basis: 'National Medicare Advantage policy — no state override', citation: '42 CFR §422.101 · NCD/LCD' , stateRule: false },
  { lob: 'Medicare Advantage', state: 'AZ', policyVersion: 'MA-NAT v5.0', basis: 'National Medicare Advantage policy — no state override', citation: '42 CFR §422.101 · NCD/LCD' , stateRule: false },
  { lob: 'Commercial PPO', state: 'TX', policyVersion: 'COM-TX v1.9', basis: 'State insurance-department mandate applies over the group policy', citation: 'TX DOI mandate · ERISA §2560.503-1' , stateRule: true },
  { lob: 'Commercial PPO', state: 'IL', policyVersion: 'COM-NAT v4.2', basis: 'Group policy — no state mandate engaged', citation: 'ERISA §2560.503-1' , stateRule: false },
  { lob: 'ACA Exchange', state: 'FL', policyVersion: 'ACA-EHB-FL v2.2', basis: 'State essential health benefits benchmark plan', citation: '45 CFR §156.110 · ACA §2719' , stateRule: true },
  { lob: 'ACA Exchange', state: 'GA', policyVersion: 'ACA-EHB-GA v2.0', basis: 'State essential health benefits benchmark plan', citation: '45 CFR §156.110 · ACA §2719' , stateRule: true },
];
export function resolvePolicy(lob: string, state: string): PolicyRule {
  return POLICY_RULES.find((r) => r.lob === lob && r.state === state)
    ?? { lob, state, policyVersion: 'UNRESOLVED', basis: 'No policy matched this line of business and state', citation: '—', stateRule: false };
}

// ---------------------------------------------------------------------------------------------
// Audit events
// ---------------------------------------------------------------------------------------------
export type AuditCategory =
  | 'Access' | 'Clinical Decision' | 'Case Management' | 'Correspondence'
  | 'Administrative' | 'Configuration' | 'Security' | 'Data Export';
export type AuditChannel = 'Web UI' | 'API' | 'Batch Interface' | 'Fax / OCR Intake' | 'System Rule';
export type AuditEntityType = 'Authorization' | 'CM Case' | 'Member' | 'Appeal' | 'Report' | 'User Account' | 'Configuration';

/** What was done to a configuration object, as distinct from what the platform did with the event.
 *  "Configuration change published" is the platform's action; 'Created' / 'Updated' / 'Deleted' is
 *  the change itself. An auditor reconstructing why a determination came out the way it did needs
 *  both: a threshold that was DELETED and one that was UPDATED to a laxer value read identically
 *  in a before/after column, and they are not the same finding. */
export type ConfigChangeAction = 'Created' | 'Updated' | 'Deleted' | 'Activated' | 'Deactivated';
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
  /** Configuration events only. Null everywhere else — a PHI view or a determination has no
   *  create/update/delete semantics. Hashed with the rest of the record, so it cannot be edited
   *  after the fact without breaking the chain. */
  changeAction?: ConfigChangeAction | null;
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
  // The source document and what was pulled out of it. Without this the trail can show which
  // criteria were applied but not what they were applied TO — and "trace the determination from the
  // source document through the extracted data" is the first thing an auditor asks to walk.
  const pages = 4 + (i % 9);
  const fields = 18 + (i % 7);
  const extractSeed = parseInt(digest(c.authId + 'extract').slice(0, 2), 16) % 100;
  const lowConfidenceFields = extractSeed < 12 ? 1 + (i % 2) : 0;
  const extractConfidence = (0.88 + ((100 - extractSeed) % 12) / 100).toFixed(2);
  out.push(base({
    timestamp: stamp(submitted, 0, 484 + (i % 300)), category: 'Case Management',
    action: 'Source document received', channel: arrival, field: 'Document',
    after: `${arrival === 'Fax / OCR Intake' ? 'Fax' : 'Upload'} — clinical packet, ${pages} pages`,
    reasonCode: 'DOC-RECEIVED',
  }));
  out.push(base({
    timestamp: stamp(submitted, 0, 488 + (i % 300)), category: 'Clinical Decision',
    action: 'Document fields extracted', channel: 'System Rule',
    actor: 'svc_trucare_hl7', actorId: USER_BY_NAME.get('svc_trucare_hl7')!.userId, actorRole: 'Interface Service Account',
    sourceIp: '172.19.4.11', field: 'Extraction',
    after: `${fields - lowConfidenceFields}/${fields} fields at or above threshold · confidence ${extractConfidence}`,
    reasonCode: 'extractor · v0.2.0',
  }));
  if (lowConfidenceFields > 0) {
    out.push(base({
      timestamp: stamp(submitted, 0, 490 + (i % 300)), category: 'Clinical Decision',
      action: 'Extracted field below threshold — routed for verification', channel: 'System Rule',
      actor: 'svc_trucare_hl7', actorId: USER_BY_NAME.get('svc_trucare_hl7')!.userId, actorRole: 'Interface Service Account',
      sourceIp: '172.19.4.11', field: 'Extraction', after: `${lowConfidenceFields} field(s) held for human verification`,
      reasonCode: 'EXTRACT-LOW-CONFIDENCE', outcome: 'Denied',
    }));
  }
  out.push(base({
    timestamp: stamp(submitted, 0, 495 + (i % 300)), category: 'Access', action: 'Member eligibility verified',
    entityType: 'Member', entityId: memberId, field: null,
  }));
  // Which policy governs this case, and on what basis — the selection step, logged separately from
  // the criteria that selection produced.
  const st = stateOf(c.authId, lob);
  const pol = resolvePolicy(lob, st);
  out.push(base({
    timestamp: stamp(submitted, 0, 498 + (i % 300)), category: 'Clinical Decision',
    action: 'Policy version resolved', channel: 'System Rule',
    actor: 'svc_trucare_hl7', actorId: USER_BY_NAME.get('svc_trucare_hl7')!.userId, actorRole: 'Interface Service Account',
    sourceIp: '172.19.4.11', field: 'Policy',
    before: `${lob} · ${st} · ${marketOf(st)}`, after: pol.policyVersion,
    reasonCode: pol.basis,
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
    // What the model recommended, at what confidence, from which model version — logged as its own
    // event so a determination can be traced back to the machine input that preceded it, not just
    // to the human who signed it.
    const ai = AI_BY_AUTH.get(c.authId);
    if (ai) {
      out.push(base({
        timestamp: stamp(submitted, 1, 566 + (i % 240)), category: 'Clinical Decision',
        action: 'AI recommendation generated', channel: 'System Rule',
        actor: 'svc_trucare_hl7', actorId: USER_BY_NAME.get('svc_trucare_hl7')!.userId, actorRole: 'Interface Service Account',
        sourceIp: '172.19.4.11', field: 'AI Recommendation',
        after: `${ai.recommendation} · confidence ${ai.confidence.toFixed(2)} · grounded ${ai.groundedMet}/${ai.groundedTotal}`,
        reasonCode: `${ai.model} · ${ai.workflowVersion} · ${ai.criteriaSet}`,
      }));
    }
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
      // A clinician disagreeing with the model is the single most audit-relevant thing that can
      // happen on a machine-influenced determination, so it is its own event with a structured
      // reason — before/after carrying what the model said and what the clinician decided instead.
      if (ai && ai.outcome === 'Overridden' && ai.overriddenBy) {
        const ov = USER_BY_NAME.get(ai.overriddenBy);
        if (ov) {
          out.push(base({
            timestamp: stamp(submitted, 3 + (i % 4), 636 + (i % 160)), category: 'Clinical Decision',
            action: 'AI recommendation overridden', actor: ov.name, actorId: ov.userId, actorRole: ov.role,
            sourceIp: ipFor(ov, i), field: 'AI Recommendation',
            before: `${ai.recommendation} · confidence ${ai.confidence.toFixed(2)}`, after: c.decision,
            reasonCode: ai.overrideReason ?? 'OVERRIDE',
          }));
        }
      }
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
        // Point at a REAL member from the pool, not a synthetic id. An emergency access is only
        // reviewable if you can open the record it touched and see it in context with everyone
        // else who was in there — a member id with no member behind it is a dead end on the one
        // event class where the reviewer most needs to keep pulling.
        const subject = CASE_POOL[parseInt(digest(u.userId + d).slice(0, 4), 16) % CASE_POOL.length];
        const subjectId = `M${digest(subject.member).slice(0, 8).toUpperCase()}`;
        out.push({
          timestamp: stamp(day, 0, login + 60), actor: u.name, actorId: u.userId, actorRole: u.role,
          category: 'Security', action: btg ? 'Break-the-glass access granted' : 'Access to unassigned member record denied',
          entityType: 'Member', entityId: subjectId,
          memberId: subjectId, lob: lobOf(subject.authId),
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
  const configs: {
    entity: string; action: ConfigChangeAction; reason: string;
    changes: { field: string; before: string | null; after: string }[];
  }[] = [
    { entity: 'CFG-AUTOAPPROVE', action: 'Updated', reason: 'CHG-2026-0412', changes: [
      { field: 'Auto-approval confidence threshold', before: '0.93', after: '0.95' },
      { field: 'Service types in scope', before: 'Imaging, DME', after: 'Imaging, DME, Outpatient Surgery' },
      { field: 'Effective date', before: null, after: '2026-05-01' },
    ] },
    { entity: 'CFG-CRITERIA-ORTHO', action: 'Activated', reason: 'CHG-2026-0431', changes: [
      { field: 'Criteria set version', before: 'Ortho v2.0', after: 'Ortho v3.0' },
      { field: 'Conservative-therapy minimum', before: '4 weeks', after: '6 weeks' },
    ] },
    { entity: 'CFG-LETTER-DENIAL', action: 'Updated', reason: 'CHG-2026-0447', changes: [
      { field: 'Denial notice template', before: 'v1.1', after: 'v1.2' },
      { field: 'Appeal-rights paragraph', before: 'Standard EN', after: 'Standard EN + ES translation block' },
      { field: 'Reading level target', before: 'Grade 8', after: 'Grade 6' },
    ] },
    { entity: 'CFG-TAT-MEDICAID', action: 'Updated', reason: 'CHG-2026-0455', changes: [
      { field: 'Medicaid standard TAT', before: '14 days', after: '14 days' },
      { field: 'Medicaid expedited TAT', before: null, after: '72 hours' },
    ] },
    { entity: 'CFG-ROLE-NURSE', action: 'Updated', reason: 'CHG-2026-0468', changes: [
      { field: 'UM Nurse Reviewer entitlements', before: 'approve, pend', after: 'approve, pend, partial-approve' },
    ] },
    { entity: 'CFG-RETENTION', action: 'Updated', reason: 'CHG-2026-0472', changes: [
      { field: 'Audit log retention', before: '6 years', after: '10 years' },
      { field: 'Disposition method', before: 'Purge', after: 'Certified disposition with terminal hash' },
    ] },
    // A rule taken OUT of force. Deletion is the change an auditor most often cannot find, because
    // a deleted rule leaves nothing behind to inspect — which is exactly why the trail has to hold it.
    { entity: 'CFG-AUTOAPPROVE-DME', action: 'Deleted', reason: 'CHG-2026-0481', changes: [
      { field: 'DME auto-approval rule', before: 'Active — confidence ≥ 0.90, cost < $2,500', after: 'Removed' },
    ] },
  ];
  configs.forEach((cfg, k) => {
    // One event per field changed, all under the same change ticket. A ticket that moved three
    // settings is three lines in the trail, not one line naming whichever field happened to be
    // listed first — you cannot re-explain a determination against a change you cannot see.
    cfg.changes.forEach((ch, f) => {
      out.push({
        timestamp: stamp(addDays(TODAY, -(9 + k * 11)), 0, 600 + k * 23 + f), actor: admin.name, actorId: admin.userId, actorRole: admin.role,
        category: 'Configuration', action: 'Configuration change published', entityType: 'Configuration', entityId: cfg.entity,
        memberId: null, lob: null, field: ch.field, before: ch.before, after: ch.after, changeAction: cfg.action,
        channel: 'Web UI', sourceIp: ipFor(admin, k), sessionId: `S-${digest(admin.userId + k).slice(0, 8)}`,
        correlationId: cfg.reason, reasonCode: cfg.reason, phi: false, outcome: 'Success',
      });
    });
    // Two-person control: the publish above is preceded by an approval from someone other than the
    // person making the change. One approval per ticket, not per field — that's what gets signed.
    // Where that approval is missing, the Governance tab flags it.
    if (k % 3 !== 2) {
      out.push({
        timestamp: stamp(addDays(TODAY, -(9 + k * 11)), 0, 580 + k * 23), actor: supervisor.name, actorId: supervisor.userId, actorRole: supervisor.role,
        category: 'Configuration', action: 'Configuration change approved', entityType: 'Configuration', entityId: cfg.entity,
        memberId: null, lob: null, field: 'Change ticket', before: null, after: `Approved — ${cfg.changes.length} field${cfg.changes.length > 1 ? 's' : ''}`,
        changeAction: cfg.action,
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
    const payload = [eventId, d.timestamp, d.actorId, d.action, d.entityType, d.entityId, d.field, d.before, d.after, d.changeAction ?? '', d.outcome, prevHash].join('|');
    const recordHash = digest(payload);
    const ev: AuditEvent = { ...d, eventId, prevHash, recordHash };
    prevHash = recordHash;
    return ev;
  });
}

export const AUDIT_EVENTS: AuditEvent[] = buildEvents();

/** Symphony's Audit view presents a determination's record in three sections — the AI's work, what
 *  a human did about it, and what actually fired as a result — and calls the whole thing a
 *  governance record. A flat event list carries the same information but makes a reviewer do the
 *  sorting, so the same three sections are derived here and shown as a column on the lineage drill.
 *  Anything unrecognised stays in Execution rather than being dropped: an event with no section is
 *  still an event that happened. */
/** A stable digest over arbitrary content, for stamping an assembled artifact. The point is not
 *  secrecy — it is that the plan holding a copy can tell whether it is the copy that was issued.
 *  Same non-cryptographic stand-in as the event chain, and the same caveat applies. */
export function contentHash(input: string): string { return digest(input); }

export type GovernanceSection = 'Decision lineage' | 'Human actions' | 'Execution';
const DECISION_LINEAGE = new Set([
  'Document fields extracted', 'Extracted field below threshold — routed for verification',
  'Policy version resolved', 'Clinical criteria applied', 'AI recommendation generated', 'Auto-approval rule applied',
  'Member eligibility verified',
]);
const HUMAN_ACTIONS = new Set([
  'AI recommendation overridden', 'Determination recorded', 'Medical Director review completed',
  'Case opened for review', 'Case routed to Medical Director', 'Break-the-glass access granted',
]);
export function governanceSection(e: AuditEvent): GovernanceSection {
  if (DECISION_LINEAGE.has(e.action)) return 'Decision lineage';
  if (HUMAN_ACTIONS.has(e.action)) return 'Human actions';
  return 'Execution';
}

/** Re-walks the chain and reports the first break, if any. Backs the "Verify chain" action —
 *  the point of the demo is that this is a check anyone can run, not a claim on a slide. */
export function verifyChain(events: AuditEvent[] = AUDIT_EVENTS): { verified: number; brokenAt: string | null } {
  let prevHash = '0000000000000000';
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const payload = [e.eventId, e.timestamp, e.actorId, e.action, e.entityType, e.entityId, e.field, e.before, e.after, e.changeAction ?? '', e.outcome, prevHash].join('|');
    if (digest(payload) !== e.recordHash) return { verified: i, brokenAt: e.eventId };
    prevHash = e.recordHash;
  }
  return { verified: events.length, brokenAt: null };
}

// ---------------------------------------------------------------------------------------------
// Governance — entitlements, segregation of duties, access attestation
// ---------------------------------------------------------------------------------------------
export const PERMISSIONS = [
  'View member PHI', 'Approve authorization', 'Deny authorization',
  'View AI confidence score', 'Override AI recommendation',
  'Reopen closed case', 'Reassign work', 'Export member-level data', 'Publish configuration change', 'Administer user accounts',
] as const;
export type Permission = typeof PERMISSIONS[number];

/** Role → permission grid. 'Yes' / 'No' / a constraint string. Constraints matter more than the
 *  yes/no: "Yes — own caseload only" is a materially different control than an unconditional yes,
 *  and it's the distinction an auditor writes up. */
export const PERMISSION_MATRIX: Record<AccessRole, Partial<Record<Permission, string>>> = {
  'UM Nurse Reviewer': { 'View member PHI': 'Yes — assigned caseload', 'Approve authorization': 'Yes — within criteria', 'Deny authorization': 'No — MD only', 'View AI confidence score': 'Yes — after own assessment recorded', 'Override AI recommendation': 'Yes — reason required', 'Reopen closed case': 'No', 'Reassign work': 'No', 'Export member-level data': 'No', 'Publish configuration change': 'No', 'Administer user accounts': 'No' },
  'Medical Director': { 'View member PHI': 'Yes', 'Approve authorization': 'Yes', 'Deny authorization': 'Yes', 'View AI confidence score': 'Yes', 'Override AI recommendation': 'Yes — reason required', 'Reopen closed case': 'Yes', 'Reassign work': 'No', 'Export member-level data': 'No', 'Publish configuration change': 'No', 'Administer user accounts': 'No' },
  'UM Supervisor': { 'View member PHI': 'Yes — team caseload', 'Approve authorization': 'No', 'Deny authorization': 'No', 'View AI confidence score': 'Yes — aggregate only', 'Override AI recommendation': 'No', 'Reopen closed case': 'Yes', 'Reassign work': 'Yes', 'Export member-level data': 'Yes — logged', 'Publish configuration change': 'Approve only', 'Administer user accounts': 'No' },
  'Care Manager': { 'View member PHI': 'Yes — assigned caseload', 'Approve authorization': 'No', 'Deny authorization': 'No', 'View AI confidence score': 'No — not applicable', 'Override AI recommendation': 'No', 'Reopen closed case': 'Yes — own cases', 'Reassign work': 'No', 'Export member-level data': 'No', 'Publish configuration change': 'No', 'Administer user accounts': 'No' },
  'CM Supervisor': { 'View member PHI': 'Yes — team caseload', 'Approve authorization': 'No', 'Deny authorization': 'No', 'View AI confidence score': 'No — not applicable', 'Override AI recommendation': 'No', 'Reopen closed case': 'Yes', 'Reassign work': 'Yes', 'Export member-level data': 'Yes — logged', 'Publish configuration change': 'No', 'Administer user accounts': 'No' },
  'Appeals Reviewer': { 'View member PHI': 'Yes — appeal scope', 'Approve authorization': 'Yes — appeal outcome', 'Deny authorization': 'Yes — appeal outcome', 'View AI confidence score': 'No — blinded on appeal', 'Override AI recommendation': 'Yes — reason required', 'Reopen closed case': 'Yes', 'Reassign work': 'No', 'Export member-level data': 'No', 'Publish configuration change': 'No', 'Administer user accounts': 'No' },
  'Intake Coordinator': { 'View member PHI': 'Yes — demographic & eligibility only', 'Approve authorization': 'No', 'Deny authorization': 'No', 'View AI confidence score': 'No', 'Override AI recommendation': 'No', 'Reopen closed case': 'No', 'Reassign work': 'Yes — unassigned queue', 'Export member-level data': 'No', 'Publish configuration change': 'No', 'Administer user accounts': 'No' },
  'Compliance Analyst': { 'View member PHI': 'Yes — audit scope, read-only', 'Approve authorization': 'No', 'Deny authorization': 'No', 'View AI confidence score': 'Yes — read-only', 'Override AI recommendation': 'No', 'Reopen closed case': 'No', 'Reassign work': 'No', 'Export member-level data': 'Yes — logged', 'Publish configuration change': 'No', 'Administer user accounts': 'No' },
  'System Administrator': { 'View member PHI': 'No — masked', 'Approve authorization': 'No', 'Deny authorization': 'No', 'View AI confidence score': 'No', 'Override AI recommendation': 'No', 'Reopen closed case': 'No', 'Reassign work': 'No', 'Export member-level data': 'No', 'Publish configuration change': 'Yes — with approval', 'Administer user accounts': 'Yes' },
  'Interface Service Account': { 'View member PHI': 'Yes — transport only', 'Approve authorization': 'Yes — rule-driven', 'Deny authorization': 'No', 'View AI confidence score': 'Yes — rule-driven', 'Override AI recommendation': 'No', 'Reopen closed case': 'No', 'Reassign work': 'No', 'Export member-level data': 'No', 'Publish configuration change': 'No', 'Administer user accounts': 'No' },
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
  domain: 'Audit Trail' | 'User Activity' | 'Access Governance' | 'Reporting & Extracts' | 'Retention & Integrity' | 'AI Governance';
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
  { id: 'REQ-01', domain: 'Audit Trail', requirement: 'Record and examine activity in systems containing ePHI', citation: 'HIPAA §164.312(b)', control: 'Every create/read/update on an auth, CM case, member, or appeal writes an immutable event with actor, role, timestamp, channel, source IP and correlation ID — including the source document, the fields extracted from it with their confidence, and the policy version the case resolved to. A determination reads back as a governance record in three sections: decision lineage, human actions, execution.', evidence: 'Audit Trail tab — filter by entity or actor', status: 'Met', priority: 'P1', gap: null, nextStep: null, owner: 'Platform Engineering' },
  { id: 'REQ-02', domain: 'Retention & Integrity', requirement: 'Audit records are tamper-evident and retained for the required period', citation: 'HIPAA §164.316(b)(2) · CMS 10-year', control: 'Events are hash-chained in timestamp order, and each sealed archive segment chains to the next, so the chain stays continuous across the archive boundary. Retention is configured per record class and every change to it is itself logged.', evidence: 'Audit Trail — Verify chain · Retention & Archive — Verify archive chain', status: 'Met', priority: 'P1', gap: null, nextStep: null, owner: 'Platform Engineering' },
  { id: 'REQ-03', domain: 'User Activity', requirement: 'Regular review of information-system activity', citation: 'HIPAA §164.308(a)(1)(ii)(D)', control: 'Per-user activity rollups with off-hours, external-IP, failed sign-in, unassigned-record and bulk-export signals.', evidence: 'User Activity tab · Reports → User Activity Review', status: 'Partial', priority: 'P1', gap: 'Review is available on demand but there is no scheduled attestation that a named reviewer looked at it, and no sign-off record.', nextStep: 'Add a monthly activity-review task with reviewer sign-off captured as its own audit event.', owner: 'Compliance' },
  { id: 'REQ-04', domain: 'User Activity', requirement: 'Break-the-glass access is justified and reviewed', citation: 'HIPAA §164.308(a)(4) — minimum necessary', control: 'Out-of-scope record access is denied by default; emergent access requires a reason code and is logged as PHI disclosure.', evidence: 'User Activity — Break-the-glass', status: 'Partial', priority: 'P1', gap: 'Reason codes are captured but free-text justification is not required, and nothing forces a follow-up review within a set window.', nextStep: 'Require narrative justification at the point of access and auto-route each event to Compliance for 5-day review.', owner: 'Compliance' },
  { id: 'REQ-05', domain: 'Access Governance', requirement: 'Role-based access enforces minimum necessary', citation: 'HIPAA §164.308(a)(3)-(4) · NCQA UM 2', control: 'Nine access roles with per-permission constraints; PHI is scoped to assigned caseload for reviewer roles and masked for administrators.', evidence: 'Governance & Access — permission matrix', status: 'Met', priority: 'P2', gap: null, nextStep: null, owner: 'IT Operations' },
  { id: 'REQ-06', domain: 'Access Governance', requirement: 'Periodic entitlement review and attestation', citation: 'SOC 2 CC6.2 · HIPAA §164.308(a)(3)(ii)(B)', control: 'Each account carries a last-attested date surfaced against a 90-day cycle.', evidence: 'Governance & Access — attestation status', status: 'Partial', priority: 'P1', gap: 'Attestation is tracked but not enforced — an account past its cycle keeps full access.', nextStep: 'Escalate at 90 days and auto-suspend entitlements at 120 unless re-attested.', owner: 'IT Operations' },
  { id: 'REQ-07', domain: 'Access Governance', requirement: 'Segregation of duties between decision and appeal', citation: '42 CFR §438.406(b)(2) · §422.590', control: 'The appeal assignment check compares the appeal reviewer against the original determination actor recorded in the audit trail.', evidence: 'Governance & Access — SOD conflicts', status: 'Met', priority: 'P1', gap: null, nextStep: null, owner: 'UM Operations' },
  { id: 'REQ-08', domain: 'Access Governance', requirement: 'Multi-factor authentication on all accounts with PHI access', citation: 'HIPAA Security Rule (proposed) · SOC 2 CC6.1', control: 'MFA enrollment is tracked per account and recorded on each sign-in event.', evidence: 'Governance & Access — MFA coverage', status: 'Gap', priority: 'P1', gap: 'A minority of accounts still authenticate with password only, including at least one with standing PHI access.', nextStep: 'Enforce MFA at the identity provider and disable password-only sign-in for every clinical role.', owner: 'IT Operations' },
  { id: 'REQ-09', domain: 'Audit Trail', requirement: 'Automated determinations are traceable to the rule version that produced them', citation: 'NCQA UM 2 · CMS delegation oversight', control: 'Auto-approval events carry the firing rule and version as the reason code, and rule changes are themselves logged with before/after.', evidence: 'Audit Trail — governance record · Governance & Access — policy resolution', status: 'Met', priority: 'P1', gap: null, nextStep: null, owner: 'Clinical Content' },
  { id: 'REQ-10', domain: 'Reporting & Extracts', requirement: 'Produce program-audit universes on request within the required window', citation: 'CMS Program Audit — ODAG / CDAG', control: 'Reports module generates filtered, dated extracts with provenance; audit-trail extracts are exportable per entity or actor.', evidence: 'Reports → Audit & Traceability (7 extracts) · Audit Trail export', status: 'Partial', priority: 'P2', gap: 'Extracts are not yet shaped to the CMS ODAG/CDAG record layouts, so a universe request still needs manual reformatting.', nextStep: 'Add ODAG/CDAG universe templates with field-level mapping and a record-count reconciliation page.', owner: 'Reporting' },
  { id: 'REQ-11', domain: 'Reporting & Extracts', requirement: 'Delegated-entity oversight reporting to the plan', citation: 'CMS 42 CFR §422.504(i) · NCQA DEL', control: 'A single Delegation Oversight Packet assembles the standard artifact set — volume and turnaround, UM inter-rater reliability, CM file audit, AI governance and calibration, access and segregation of duties, chain integrity, retention and disposition — behind a cover page carrying scope, coverage and a content stamp, with the open findings and an attestation block included rather than omitted.', evidence: 'Reports → Audit & Traceability → Delegation Oversight Packet', status: 'Met', priority: 'P2', gap: null, nextStep: null, owner: 'Compliance' },
  { id: 'REQ-12', domain: 'Retention & Integrity', requirement: 'Audit data is exportable to the plan\'s own SIEM / long-term store', citation: 'SOC 2 CC7.2 · plan security requirements', control: 'Audit events export as CSV on demand.', evidence: 'Audit Trail — Export', status: 'Gap', priority: 'P2', gap: 'No streaming or scheduled feed — a plan wanting continuous ingestion into its own SIEM has to pull manually.', nextStep: 'Expose an append-only audit event API and a nightly signed batch feed.', owner: 'Platform Engineering' },
  { id: 'REQ-13', domain: 'User Activity', requirement: 'Alerting on anomalous access', citation: 'SOC 2 CC7.2 · HIPAA §164.308(a)(6)', control: 'Every signal has a named owner, a severity and a review window in the notification rules, and reaches the Inbox where it opens the screen that owns it.', evidence: 'Governance & Access — notification rules · Inbox', status: 'Partial', priority: 'P2', gap: 'Routing is configured and signals surface in the app, but nothing leaves the platform — no mail, no page, no ticket. Anyone relying on being told rather than on looking would not be told.', nextStep: 'Wire the configured destinations to real delivery, and treat a signal past its review window as an exception in its own right.', owner: 'Compliance' },
  { id: 'REQ-14', domain: 'Audit Trail', requirement: 'Member-facing disclosure accounting', citation: 'HIPAA §164.528', control: 'PHI disclosure events (letters, exports, break-the-glass) are individually flagged in the trail.', evidence: 'Audit Trail — PHI filter', status: 'Partial', priority: 'P3', gap: 'The underlying events exist, but there is no per-member accounting-of-disclosures report a member request could be answered with.', nextStep: 'Add a member-scoped disclosure report covering the trailing 6 years.', owner: 'Compliance' },
  { id: 'REQ-15', domain: 'Retention & Integrity', requirement: 'Retention schedule defined and applied per record class', citation: '42 CFR §422.504(d) · HIPAA §164.316(b)(2)(i)', control: 'Six record classes each carry their own retention period, legal basis and disposition action; the archive segment index shows the purge-eligible date every sealed period resolves to.', evidence: 'Retention & Archive — retention schedule', status: 'Met', priority: 'P1', gap: null, nextStep: null, owner: 'Compliance' },
  { id: 'REQ-16', domain: 'Retention & Integrity', requirement: 'Legal hold suspends disposition', citation: 'FRCP 37(e) · plan litigation-hold policy', control: 'A hold on a segment is a hard precondition on disposition, not a warning: the disposal action refuses outright and names the hold that stopped it, regardless of the retention date.', evidence: 'Retention & Archive — Dispose on a held segment', status: 'Met', priority: 'P1', gap: null, nextStep: null, owner: 'Compliance' },
  { id: 'REQ-17', domain: 'Retention & Integrity', requirement: 'Defensible disposition — destruction is certified and itself logged', citation: 'HIPAA §164.310(d)(2)(i) · NARA-style disposition practice', control: 'Disposition requires an independent countersignature and issues a certificate carrying the period, event count, retained terminal hash, retention basis, method, both signatories and the date — written back into the session history as its own event. The terminal hash survives the events, so the chain the segment closed can still be confirmed.', evidence: 'Retention & Archive — Certificates of Destruction', status: 'Met', priority: 'P2', gap: null, nextStep: null, owner: 'Platform Engineering' },
  { id: 'REQ-18', domain: 'Retention & Integrity', requirement: 'Archived records are retrievable within the requested window', citation: 'CMS program audit request timelines', control: 'Restore requests from cold storage are tracked with requester, reason, and turnaround against a 5-day retrieval SLA.', evidence: 'Retention & Archive — restore requests', status: 'Partial', priority: 'P2', gap: 'Turnaround is recorded after the fact; nothing alerts when a request is approaching or past the retrieval SLA.', nextStep: 'Surface open restore requests as a work item with an SLA countdown, the same treatment the UM queues get.', owner: 'Platform Engineering' },
  { id: 'REQ-19', domain: 'AI Governance', requirement: 'Every machine-influenced determination is traceable to the model version and criteria that produced it', citation: 'NCQA UM 2 · emerging Clinical AI governance practice', control: 'The recommendation, its confidence score, the model version and the criteria set are written to the audit trail as their own event before the determination, and an override is logged separately with before/after.', evidence: 'Audit Trail — filter Clinical Decision · AI Oversight tab', status: 'Met', priority: 'P1', gap: null, nextStep: null, owner: 'Clinical Content' },
  { id: 'REQ-20', domain: 'AI Governance', requirement: 'Confidence scores are calibrated and monitored for drift', citation: 'Emerging Clinical AI governance practice · SOC 2 CC7.2', control: 'Observed agreement is measured against each confidence band and against a defined tolerance, and concordance is tracked month over month against the model version in force.', evidence: 'AI Oversight — calibration & drift', status: 'Partial', priority: 'P1', gap: 'Calibration is measured and visible, but nothing alerts when a band drifts outside tolerance — today it is found by someone opening the tab. The 95%+ band is currently running overconfident.', nextStep: 'Alert on any adequately-sampled band exceeding the deviation tolerance, and gate model promotion on the same check.', owner: 'Clinical Content' },
  { id: 'REQ-21', domain: 'AI Governance', requirement: 'Clinician overrides are captured with a structured reason and reviewed', citation: 'Emerging Clinical AI governance practice · NCQA UM 4', control: 'Overrides require a reason code, and reasons are split between model-attributable findings and legitimate clinical divergence so the override rate can actually be interpreted.', evidence: 'AI Oversight — override reasons', status: 'Partial', priority: 'P2', gap: 'Reasons are coded and reportable, but model-attributable overrides do not route anywhere — there is no loop back to the clinical content team who own the criteria.', nextStep: 'Route model-attributable overrides to Clinical Content as a work item, and report closure alongside the IRR corrective-action loop.', owner: 'Clinical Content' },
];

export function registerCounts(rows: ComplianceRequirement[] = COMPLIANCE_REGISTER) {
  const met = rows.filter((r) => r.status === 'Met').length;
  const partial = rows.filter((r) => r.status === 'Partial').length;
  const gap = rows.filter((r) => r.status === 'Gap').length;
  return { met, partial, gap, total: rows.length, coverage: pctOf(met, rows.length) };
}

// ---------------------------------------------------------------------------------------------
// Rollups — extracted so the Audit & Traceability tabs and the Reports module compute these the
// SAME way. The report registry's own design rule is that a report calls straight into the
// function backing the dashboard rather than recomputing independently; an audit report that
// disagreed with the audit screen would be worse than no report at all.
// ---------------------------------------------------------------------------------------------

/** Time ranges the Audit Trail offers. Deliberately NOT the shared Lookback service: on a
 *  caseload dashboard '30 days' is the unfiltered baseline because every pending case falls inside
 *  it, but the audit log spans the whole retained history, so that convention made the event count
 *  DROP when you widened from '30 days' to 'QTD'. Here every option means exactly what it says and
 *  'All' is the default. */
export type AuditRange = 'today' | '7d' | '30d' | '90d' | '12m' | 'all';
export const AUDIT_RANGES: { id: AuditRange; label: string; days: number | null }[] = [
  { id: 'today', label: 'Today', days: 0 },
  { id: '7d', label: '7 days', days: 6 },
  { id: '30d', label: '30 days', days: 29 },
  { id: '90d', label: '90 days', days: 89 },
  { id: '12m', label: '12 months', days: 364 },
  { id: 'all', label: 'All history', days: null },
];

/** Earliest and latest event actually retained, plus the count — so the screen can state the real
 *  span instead of implying the log starts wherever the current filter starts. */
export function auditSpan(events: AuditEvent[] = AUDIT_EVENTS): { from: string; to: string; count: number } {
  if (!events.length) return { from: '—', to: '—', count: 0 };
  return { from: eventDate(events[0].timestamp), to: eventDate(events[events.length - 1].timestamp), count: events.length };
}

export interface UserActivityRow {
  userId: string; name: string; role: AccessRole; department: string;
  mfaEnrolled: boolean; lastAccessReview: string;
  events: number; sessions: number; phi: number; exports: number; exportedRows: number;
  offHours: number; failedLogins: number; deniedAccess: number; breakGlass: number; externalIp: number;
  lastActivity: string;
  signals: string[];
}
/** Per-account activity review — the HIPAA §164.308(a)(1)(ii)(D) evidence, in one place. */
// ---------------------------------------------------------------------------------------------
// The two pivots an auditor actually works in: one user across many members, and one member
// across many users. Both are group-bys over the SAME event store the Audit Trail tab reads —
// no second source of truth, so a number here can never disagree with a number there.
// ---------------------------------------------------------------------------------------------

/** memberId -> display name. Audit events carry only the id (they are the system of record, and a
 *  name is presentation), so the label is resolved from the case pools the events were generated
 *  from. UM hashes the member name into an id; CM already has one. */
export const MEMBER_NAMES: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const c of CASE_POOL) m.set(`M${digest(c.member).slice(0, 8).toUpperCase()}`, c.member);
  for (const c of CM_CASE_POOL) m.set(c.memberId, c.member);
  return m;
})();
export function memberName(memberId: string): string { return MEMBER_NAMES.get(memberId) ?? memberId; }

export interface MemberAuditRow {
  memberId: string;
  member: string;
  lob: string;
  events: number;
  users: number;          // distinct people and service accounts that touched this member
  records: number;        // distinct authorizations / cases / appeals
  phi: number;
  modules: string;
  firstActivity: string;
  lastActivity: string;
}

/** One row per member touched in range — the entry point for "show me everything on this member,
 *  whoever did it". */
export function memberAuditRollup(events: AuditEvent[]): MemberAuditRow[] {
  const groups = new Map<string, AuditEvent[]>();
  for (const e of events) {
    if (!e.memberId) continue;                 // configuration and account admin touch no member
    const g = groups.get(e.memberId) ?? [];
    g.push(e); groups.set(e.memberId, g);
  }
  const rows: MemberAuditRow[] = [];
  groups.forEach((evs, memberId) => {
    const sorted = [...evs].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const mods = new Set<string>();
    for (const e of sorted) {
      if (e.entityType === 'Authorization') mods.add('UM');
      else if (e.entityType === 'CM Case') mods.add('CM');
      else if (e.entityType === 'Appeal') mods.add('Appeals');
    }
    rows.push({
      memberId, member: memberName(memberId),
      lob: sorted.find((e) => e.lob)?.lob ?? '—',
      events: sorted.length,
      users: new Set(sorted.map((e) => e.actorId)).size,
      records: new Set(sorted.map((e) => e.entityId)).size,
      phi: sorted.filter((e) => e.phi).length,
      modules: [...mods].join(' · ') || '—',
      firstActivity: sorted[0].timestamp.replace('T', ' '),
      lastActivity: sorted[sorted.length - 1].timestamp.replace('T', ' '),
    });
  });
  return rows.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
}

export interface TimelineThread {
  correlationId: string;
  entityType: AuditEntityType;
  entityId: string;
  opened: string;
  closed: string;
  actors: string[];
  events: AuditEvent[];
}

/** One member's complete history, threaded by case rather than served as a flat list. A member with
 *  three authorizations and a care-management case is four threads, because that is how the work
 *  actually happened — a flat chronology interleaves them and reads as noise. */
export function memberTimeline(memberId: string, events: AuditEvent[], actorId?: string): TimelineThread[] {
  const mine = events
    .filter((e) => e.memberId === memberId && (!actorId || e.actorId === actorId))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const threads = new Map<string, AuditEvent[]>();
  for (const e of mine) {
    const g = threads.get(e.correlationId) ?? [];
    g.push(e); threads.set(e.correlationId, g);
  }
  return [...threads.entries()].map(([correlationId, evs]) => ({
    correlationId,
    entityType: evs[0].entityType,
    entityId: evs[0].entityId,
    opened: evs[0].timestamp.replace('T', ' '),
    closed: evs[evs.length - 1].timestamp.replace('T', ' '),
    actors: [...new Set(evs.map((e) => e.actor))],
    events: evs,
  })).sort((a, b) => b.closed.localeCompare(a.closed));
}

export interface UserMemberRow {
  memberId: string;
  member: string;
  lob: string;
  events: number;
  phi: number;
  records: number;
  firstTouch: string;
  lastTouch: string;
  actions: string;
}

/** The other direction: every member one user touched, and what they did to each. This is the view
 *  a supervisor opens when an access review flags someone, and the one a member asks for by name
 *  under an accounting-of-disclosures request. */
export function membersForUser(userId: string, events: AuditEvent[]): UserMemberRow[] {
  const mine = events.filter((e) => e.actorId === userId && e.memberId);
  const groups = new Map<string, AuditEvent[]>();
  for (const e of mine) {
    const g = groups.get(e.memberId!) ?? [];
    g.push(e); groups.set(e.memberId!, g);
  }
  const rows: UserMemberRow[] = [];
  groups.forEach((evs, memberId) => {
    const sorted = [...evs].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const actions = [...new Set(sorted.map((e) => e.action))];
    rows.push({
      memberId, member: memberName(memberId),
      lob: sorted.find((e) => e.lob)?.lob ?? '—',
      events: sorted.length,
      phi: sorted.filter((e) => e.phi).length,
      records: new Set(sorted.map((e) => e.entityId)).size,
      firstTouch: sorted[0].timestamp.replace('T', ' '),
      lastTouch: sorted[sorted.length - 1].timestamp.replace('T', ' '),
      actions: actions.slice(0, 3).join(', ') + (actions.length > 3 ? ` +${actions.length - 3} more` : ''),
    });
  });
  return rows.sort((a, b) => b.lastTouch.localeCompare(a.lastTouch));
}

export function userActivityRollup(events: AuditEvent[], users: SystemUser[] = SYSTEM_USERS): UserActivityRow[] {
  return users.map((u) => {
    const mine = events.filter((e) => e.actorId === u.userId);
    const row: UserActivityRow = {
      userId: u.userId, name: u.name, role: u.role, department: u.department,
      mfaEnrolled: u.mfaEnrolled, lastAccessReview: u.lastAccessReview,
      events: mine.length,
      sessions: new Set(mine.map((e) => e.sessionId)).size,
      phi: mine.filter((e) => e.phi).length,
      exports: mine.filter((e) => e.category === 'Data Export').length,
      exportedRows: mine.filter((e) => e.category === 'Data Export').reduce((s, e) => s + Number(e.after ?? 0), 0),
      offHours: mine.filter((e) => isOffHours(e.timestamp)).length,
      failedLogins: mine.filter((e) => e.action === 'Failed sign-in attempt').length,
      deniedAccess: mine.filter((e) => e.outcome === 'Denied').length,
      breakGlass: mine.filter((e) => e.action.startsWith('Break-the-glass')).length,
      externalIp: mine.filter((e) => isExternalIp(e.sourceIp)).length,
      lastActivity: mine.length ? mine[mine.length - 1].timestamp.replace('T', ' ') : '',
      signals: [],
    };
    if (row.breakGlass > 0) row.signals.push('break-the-glass');
    if (row.externalIp > 0) row.signals.push('external IP');
    if (!u.mfaEnrolled) row.signals.push('no MFA');
    if (row.failedLogins >= 2) row.signals.push('repeated failed sign-ins');
    if (row.offHours > 0 && row.events > 0 && row.offHours / row.events > 0.15) row.signals.push('off-hours pattern');
    if (row.exports >= 8) row.signals.push('high export volume');
    return row;
  }).sort((a, b) => b.signals.length - a.signals.length || b.events - a.events);
}

export interface SodConflictRow { ruleId: string; rule: string; citation: string; subject: string; detail: string; eventIds: string[]; }
export interface SodResult { rule: SodRule; conflicts: SodConflictRow[]; }
/** Every SOD rule evaluated against the supplied event window. A clean rule returns an empty
 *  conflict list — which is an auditable statement about the events examined, not a green tick. */
export function evaluateSod(events: AuditEvent[], users: SystemUser[] = SYSTEM_USERS): SodResult[] {
  return SOD_RULES.map((rule) => {
    const conflicts: SodConflictRow[] = [];
    const add = (subject: string, detail: string, eventIds: string[]) =>
      conflicts.push({ ruleId: rule.id, rule: rule.name, citation: rule.citation, subject, detail, eventIds });

    if (rule.id === 'SOD-1') {
      const determinationBy = new Map<string, string>();
      events.filter((e) => e.action === 'Determination recorded').forEach((e) => determinationBy.set(e.entityId, e.actorId));
      events.filter((e) => e.entityType === 'Appeal').forEach((e) => {
        if (determinationBy.get(e.entityId) === e.actorId) {
          add(e.actor, `${e.actor} reviewed the appeal on ${e.entityId} after recording its original determination`, [e.eventId]);
        }
      });
    }
    if (rule.id === 'SOD-2') {
      const approvals = new Set(events.filter((e) => e.action === 'Configuration change approved').map((e) => e.correlationId));
      // A change ticket that moved three fields is ONE unapproved change, not three. Grouping by
      // correlationId before flagging keeps the exception count honest — an inflated count is as
      // misleading to an auditor as a suppressed one.
      const byTicket = new Map<string, AuditEvent[]>();
      events.filter((e) => e.action === 'Configuration change published' && !approvals.has(e.correlationId))
        .forEach((e) => { const g = byTicket.get(e.correlationId) ?? []; g.push(e); byTicket.set(e.correlationId, g); });
      byTicket.forEach((evs, ticket) => {
        const e = evs[0];
        const fields = evs.map((x) => `"${x.field}"`).join(', ');
        add(e.actor, `${e.entityId} — ${e.changeAction ?? 'Changed'}: ${fields} by ${e.actor} with no independent approval on ${ticket}`, evs.map((x) => x.eventId));
      });
    }
    if (rule.id === 'SOD-3') {
      const clinical: AccessRole[] = ['Medical Director', 'Appeals Reviewer'];
      events.filter((e) => e.action === 'Determination recorded' && e.after === 'Denied').forEach((e) => {
        if (!clinical.includes(e.actorRole)) {
          add(e.actor, `${e.entityId} denied by ${e.actor} (${e.actorRole}) — medical-necessity denials require a qualified clinician`, [e.eventId]);
        }
      });
    }
    if (rule.id === 'SOD-4') {
      const admins = new Set(users.filter((u) => u.role === 'System Administrator').map((u) => u.userId));
      const seen = new Set<string>();
      events.filter((e) => admins.has(e.actorId) && e.phi).forEach((e) => {
        if (seen.has(e.actorId)) return;
        seen.add(e.actorId);
        add(e.actor, `${e.actor} holds administrator rights and accessed PHI (${e.entityId})`, [e.eventId]);
      });
    }
    return { rule, conflicts };
  });
}

/** Days since an account's entitlements were last attested, against the 90-day policy cycle. */
export const ATTESTATION_CYCLE_DAYS = 90;
export function attestationAgeDays(u: SystemUser): number {
  return Math.round((TODAY.getTime() - new Date(`${u.lastAccessReview}T00:00:00`).getTime()) / 86400000);
}


// ---------------------------------------------------------------------------------------------
// Retention & archive
// ---------------------------------------------------------------------------------------------
// AUDIT_EVENTS above is the ONLINE store — what the Audit Trail tab can query directly. It is not
// the whole retained record, and a screen that implies otherwise fails the first question a
// records-retention reviewer asks: "where is everything older than that?"
//
// Real platforms tier this. Recent events stay queryable; older ones are sealed into immutable
// segments on cheaper storage, still hash-chained, retrievable on request. Materialising ten years
// of individual events in a browser demo would misrepresent what is actually there, so the archive
// is modelled the way a real system exposes it: a SEGMENT INDEX carrying period, event count, hash
// range, storage tier, seal date, retention class and hold status — metadata about events that
// live elsewhere, rather than the events themselves.
//
// The hash range is the part that matters. Each sealed segment's last hash is the input to the
// next segment's first hash, so the chain is continuous across the archive boundary and on into
// the online store. That continuity is what lets an archived record still be evidence.

export type StorageTier = 'Online' | 'Nearline' | 'Archive';
export type RetentionClass =
  | 'Authorization & Determination' | 'Care Management' | 'Appeal & Grievance'
  | 'Audit & Security Event' | 'PHI Disclosure Accounting' | 'Configuration Change';

export interface RetentionPolicy {
  recordClass: RetentionClass;
  retentionYears: number;
  basis: string;
  citation: string;
  dispositionAction: string;
}
/** Retention is per record class, not one blanket number — the shortest legal minimum and the
 *  longest applicable requirement are rarely the same, and the org holds to the longest.
 *  Directional; confirm against the plan's own schedule and any state overrides. */
export const RETENTION_POLICIES: RetentionPolicy[] = [
  { recordClass: 'Authorization & Determination', retentionYears: 10, basis: 'CMS records-retention requirement for Medicare Advantage contract records', citation: '42 CFR §422.504(d)', dispositionAction: 'Purge after certified disposition' },
  { recordClass: 'Appeal & Grievance', retentionYears: 10, basis: 'Appeal file must survive the full CMS look-back window', citation: '42 CFR §422.504(d) · §438.416', dispositionAction: 'Purge after certified disposition' },
  { recordClass: 'Care Management', retentionYears: 10, basis: 'Aligned to the authorization schedule; state Medicaid overrides may run longer', citation: '42 CFR §438.3(u) · state schedule', dispositionAction: 'Purge after certified disposition' },
  { recordClass: 'Audit & Security Event', retentionYears: 10, basis: 'HIPAA sets a 6-year floor; org policy holds audit events the full 10 to match the record they describe', citation: 'HIPAA §164.316(b)(2)(i)', dispositionAction: 'Purge after certified disposition' },
  { recordClass: 'PHI Disclosure Accounting', retentionYears: 6, basis: 'A member may request an accounting covering the trailing six years', citation: 'HIPAA §164.528(a)(1)', dispositionAction: 'Retain 6 years, then purge' },
  { recordClass: 'Configuration Change', retentionYears: 10, basis: 'A determination can only be re-explained against the rule version in force at the time', citation: 'NCQA UM 2 · CMS delegation oversight', dispositionAction: 'Retain for the life of every record it governed' },
];

export interface ArchiveSegment {
  segmentId: string;
  periodFrom: string;          // ISO date
  periodTo: string;            // ISO date
  eventCount: number;
  firstHash: string;
  lastHash: string;
  sealedDate: string;          // ISO date — when the segment was closed and made immutable
  tier: StorageTier;
  wormLocked: boolean;         // object-lock / write-once storage
  lastVerified: string;        // ISO date — last time the chain was re-walked in place
  verified: boolean;
  purgeEligible: string;       // ISO date — periodTo + the longest applicable retention
  legalHold: string | null;    // hold reference suspending disposition, or null
}

/** Quarter boundaries walking backwards from the start of the online window. */
function quarterStarts(fromExclusive: Date, count: number): { from: Date; to: Date }[] {
  const out: { from: Date; to: Date }[] = [];
  let y = fromExclusive.getFullYear();
  let q = Math.floor(fromExclusive.getMonth() / 3);
  for (let i = 0; i < count; i++) {
    q -= 1;
    if (q < 0) { q = 3; y -= 1; }
    out.push({ from: new Date(y, q * 3, 1), to: new Date(y, q * 3 + 3, 0) });
  }
  return out;
}

// Deliberately more than the 10-year retention window, not less: an archive that stops exactly at
// the retention boundary has no disposition queue and no segment a legal hold could matter to,
// which are the two things a records reviewer actually asks about.
const ARCHIVE_QUARTERS = 46;

function buildArchive(): ArchiveSegment[] {
  const onlineStart = AUDIT_EVENTS.length ? new Date(eventDate(AUDIT_EVENTS[0].timestamp) + 'T00:00:00') : TODAY;
  const quarters = quarterStarts(onlineStart, ARCHIVE_QUARTERS);
  quarters.reverse(); // oldest first, so the chain reads forward into the online store

  let prevHash = '0000000000000000';
  const segments: ArchiveSegment[] = quarters.map((qtr, i) => {
    const label = qtr.from.getFullYear() + 'Q' + (Math.floor(qtr.from.getMonth() / 3) + 1);
    const segmentId = 'SEG-' + label;
    // Volume ramps with adoption rather than sitting flat across a decade.
    const eventCount = 1400 + Math.round(i * 62) + ((i * 37) % 240);
    const firstHash = digest(segmentId + '|first|' + prevHash);
    const lastHash = digest(segmentId + '|last|' + firstHash + '|' + eventCount);
    prevHash = lastHash;
    const ageDays = Math.round((TODAY.getTime() - qtr.to.getTime()) / 86400000);
    const tier: StorageTier = ageDays <= 365 ? 'Nearline' : 'Archive';
    const sealed = new Date(qtr.to); sealed.setDate(sealed.getDate() + 7);
    const purge = new Date(qtr.to); purge.setFullYear(purge.getFullYear() + 10);
    // Segments are re-verified on a rolling schedule, not all on the same day.
    const verifiedOffset = 20 + ((i * 53) % 300);
    return {
      segmentId, periodFrom: isoDate(qtr.from), periodTo: isoDate(qtr.to), eventCount,
      firstHash, lastHash, sealedDate: isoDate(capToday(sealed)), tier, wormLocked: true,
      lastVerified: isoDate(capToday(addDays(TODAY, -verifiedOffset))), verified: true,
      purgeEligible: isoDate(purge), legalHold: null,
    };
  });

  // Holds land on the oldest segments already past their purge-eligible date — the only ones where
  // a hold changes what happens next, which is exactly where a reviewer looks first.
  const today = isoDate(TODAY);
  segments.filter((s) => s.purgeEligible <= today).slice(0, 2).forEach((s, i) => {
    s.legalHold = i === 0 ? 'HOLD-2026-004 · CMS program audit' : 'HOLD-2025-011 · Member grievance G-88214';
  });
  return segments;
}
export const ARCHIVE_SEGMENTS: ArchiveSegment[] = buildArchive();

export interface RestoreRequest {
  requestId: string; segmentId: string; requestedBy: string; requestedDate: string;
  reason: string; status: 'Fulfilled' | 'In Progress' | 'Denied'; fulfilledDate: string | null; slaDays: number;
}
/** Retrieval from cold storage is itself an auditable act — who asked, why, and how long it took
 *  against the retrieval SLA. */
export const RESTORE_REQUESTS: RestoreRequest[] = (() => {
  const targets = ARCHIVE_SEGMENTS.slice(-8);
  const reasons = ['CMS program audit — ODAG universe request', 'Member appeal — prior determination history', 'Delegation oversight review', 'Litigation hold discovery', 'Internal IRR look-back'];
  const requesters = ['Priya Shah, RN (QI)', 'Christina Lawson', 'Renee Alvarez', 'Daniel Okafor'];
  return targets.map((seg, i) => {
    const requested = addDays(TODAY, -(8 + i * 17));
    const status: RestoreRequest['status'] = i % 5 === 3 ? 'In Progress' : 'Fulfilled';
    const turnaround = 1 + (i % 4);
    return {
      requestId: 'RST-2026-' + String(100 + i * 7), segmentId: seg.segmentId,
      requestedBy: requesters[i % requesters.length], requestedDate: isoDate(requested),
      reason: reasons[i % reasons.length], status,
      fulfilledDate: status === 'Fulfilled' ? isoDate(capToday(addDays(requested, turnaround))) : null,
      slaDays: 5,
    };
  });
})();

export interface ArchiveSummary {
  onlineEvents: number; onlineFrom: string; onlineTo: string;
  archivedEvents: number; archivedSegments: number; oldestRetained: string;
  totalRetained: number; onHold: number; purgeEligible: number; unverified: number;
}
/** Takes the segments still standing rather than reading the constant, so a certified disposition
 *  actually moves these counts. A screen where destroying a segment leaves the totals unchanged
 *  would be worse than not offering the action. */
export function archiveSummary(segments: ArchiveSegment[] = ARCHIVE_SEGMENTS): ArchiveSummary {
  const online = auditSpan();
  const archivedEvents = segments.reduce((s, x) => s + x.eventCount, 0);
  const today = isoDate(TODAY);
  return {
    onlineEvents: online.count, onlineFrom: online.from, onlineTo: online.to,
    archivedEvents, archivedSegments: segments.length,
    oldestRetained: segments.length ? segments[0].periodFrom : online.from,
    totalRetained: archivedEvents + online.count,
    onHold: segments.filter((s) => s.legalHold).length,
    // Past its retention date and not held — the disposition queue a reviewer asks to see.
    purgeEligible: segments.filter((s) => s.purgeEligible <= today && !s.legalHold).length,
    unverified: segments.filter((s) => !s.verified).length,
  };
}

/** Walks the sealed segments in order and confirms each one's first hash derives from the previous
 *  segment's last hash — the archive-boundary equivalent of verifyChain(). */
export function verifyArchiveChain(segments: ArchiveSegment[] = ARCHIVE_SEGMENTS): { verified: number; brokenAt: string | null } {
  let prevHash = '0000000000000000';
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (digest(s.segmentId + '|first|' + prevHash) !== s.firstHash) return { verified: i, brokenAt: s.segmentId };
    if (digest(s.segmentId + '|last|' + s.firstHash + '|' + s.eventCount) !== s.lastHash) return { verified: i, brokenAt: s.segmentId };
    prevHash = s.lastHash;
  }
  return { verified: segments.length, brokenAt: null };
}
