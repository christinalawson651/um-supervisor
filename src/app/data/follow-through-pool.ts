// Data behind the Follow-Through Board — a shared, non-clinical work pool for unskilled/support
// staff who complete what UM and CM already decided or triggered (notifications, determination
// letters, outreach calls) rather than making clinical judgments themselves. Deterministic (no RNG),
// same convention as case-pool.ts/cm-case-pool.ts, and sourced FROM those pools so every item here
// traces back to a real UM authorization or CM case rather than being invented fresh.
import { TODAY } from './case-fields';
import { CASE_POOL } from './case-pool';
import { CM_CASE_POOL } from './cm-case-pool';

export type FollowThroughType = 'Follow-up Call' | 'Notification Generation' | 'Letter Completion';
export type SourceModule = 'UM' | 'CM';
export type FollowThroughStatus = 'Queued' | 'Drawn' | 'Completed';

export interface FollowThroughItem {
  id: string;
  taskType: FollowThroughType;
  sourceModule: SourceModule;
  sourceId: string;      // AUTH-xxxx (UM) or memberId (CM)
  member: string;
  detail: string;
  dueDate: string;       // ISO
  priority: 'Standard' | 'Urgent';
  status: FollowThroughStatus;
  drawnBy: string | null;
  drawnAt: string | null;
}

export const FOLLOW_THROUGH_TYPES: FollowThroughType[] = ['Follow-up Call', 'Notification Generation', 'Letter Completion'];

// The unskilled/support-staff roster who work this board — distinct from UM's nurses and CM's care
// managers, who each need clinical judgment this board is explicitly designed to route around.
export const FOLLOW_THROUGH_STAFF = ['Priya Anand', 'Marcus Diaz', 'Devon Brooks', 'Latasha Owens', 'Christine Lee'];

// A multiplicative string hash, not a linear function of array index — sampling/seeding off of
// `idx % N` directly would stride in lockstep with CASE_POOL/CM_CASE_POOL's own 30-length name
// arrays (a documented pitfall in cm-case-pool.ts: shared factors between the stride and the array
// length collapse diversity, e.g. every 6th record landing on only 5 distinct surnames). Hashing the
// record's own id decorrelates sampling from that internal structure entirely.
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
  return h;
}

function isoDate(daysFromToday: number): string {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}
function clockOf(seed: number): string {
  const h = 8 + (seed % 9); // 8am - 4pm
  const m = (seed * 7) % 60;
  const hh = h > 12 ? h - 12 : h;
  return `${hh}:${m.toString().padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}
function statusOf(seed: number, completedFloor: number, drawnFloor: number): FollowThroughStatus {
  const s = seed % 10;
  return s < drawnFloor ? 'Queued' : s < completedFloor ? 'Drawn' : 'Completed';
}

// ---- Notification Generation — every decided UM authorization eventually needs a member/provider
// notification generated and sent; sampled to a believable working set rather than all 247. ----
function buildUmNotifications(): FollowThroughItem[] {
  const out: FollowThroughItem[] = [];
  CASE_POOL.filter((c) => c.phase === 'decided').forEach((c) => {
    const h = hash(c.authId + 'N');
    if (h % 8 !== 0) return; // ~1/8 of decided cases
    const status = statusOf(h, 9, 6);
    const staff = FOLLOW_THROUGH_STAFF[h % FOLLOW_THROUGH_STAFF.length];
    out.push({
      id: `FT-N-${c.authId}`,
      taskType: 'Notification Generation',
      sourceModule: 'UM',
      sourceId: c.authId,
      member: c.member,
      detail: `${c.decision} notification — ${c.procedure}`,
      dueDate: isoDate((h % 3) - 1),
      priority: c.tags.includes('expedited') ? 'Urgent' : 'Standard',
      status,
      drawnBy: status === 'Queued' ? null : staff,
      drawnAt: status === 'Queued' ? null : clockOf(h),
    });
  });
  return out;
}

// ---- Letter Completion — determination letters, skewed toward Denied/Partial (statutorily
// required) but including a share of Approved letters too. ----
function buildUmLetters(): FollowThroughItem[] {
  const out: FollowThroughItem[] = [];
  CASE_POOL.filter((c) => c.phase === 'decided').forEach((c) => {
    const h = hash(c.authId + 'L');
    if (h % 6 !== 0) return; // ~1/6 of decided cases
    const status = statusOf(h, 8, 5);
    const staff = FOLLOW_THROUGH_STAFF[h % FOLLOW_THROUGH_STAFF.length];
    const label = c.decision === 'Approved' ? 'Approval letter' : c.decision === 'Denied' ? 'Denial determination letter' : 'Partial approval letter';
    out.push({
      id: `FT-L-${c.authId}`,
      taskType: 'Letter Completion',
      sourceModule: 'UM',
      sourceId: c.authId,
      member: c.member,
      detail: `${label} — ${c.procedure}`,
      dueDate: isoDate((h % 4) - 1),
      priority: c.decision !== 'Approved' ? 'Urgent' : 'Standard',
      status,
      drawnBy: status === 'Queued' ? null : staff,
      drawnAt: status === 'Queued' ? null : clockOf(h),
    });
  });
  return out;
}

// ---- Follow-up Call — CM members currently sitting in Outreach Queue or Discharge Follow-Up
// Queue: the two CM work queues that are pure "make contact with the member" work, no clinical
// judgment required to place the call itself. ----
function buildCmFollowUps(): FollowThroughItem[] {
  const out: FollowThroughItem[] = [];
  CM_CASE_POOL.filter((c) => c.queue === 'Outreach Queue' || c.queue === 'Discharge Follow-Up Queue').forEach((c) => {
    const h = hash(c.memberId + 'F');
    const status = statusOf(h, 9, 6);
    const staff = FOLLOW_THROUGH_STAFF[h % FOLLOW_THROUGH_STAFF.length];
    const label = c.queue === 'Outreach Queue' ? `Initial outreach call — ${c.program}` : `Post-discharge follow-up call — ${c.program}`;
    out.push({
      id: `FT-F-${c.memberId}`,
      taskType: 'Follow-up Call',
      sourceModule: 'CM',
      sourceId: c.memberId,
      member: c.member,
      detail: label,
      dueDate: isoDate((h % 5) - 2),
      priority: c.queueBreached || c.tags.includes('highRisk') ? 'Urgent' : 'Standard',
      status,
      drawnBy: status === 'Queued' ? null : staff,
      drawnAt: status === 'Queued' ? null : clockOf(h),
    });
  });
  return out;
}

export const FOLLOW_THROUGH_POOL: FollowThroughItem[] = [...buildUmNotifications(), ...buildUmLetters(), ...buildCmFollowUps()];
