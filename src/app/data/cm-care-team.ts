// Care team and external (community) programmes.
//
// Two concepts the plan-run programme taxonomy in cm-programs.ts deliberately does not cover:
//
//   An EXTERNAL PROGRAMME is run by somebody else — a community-based organisation, a state
//   agency, a school district. The plan does not enrol a member into it, it LINKS them to it, and
//   the distinction matters for oversight: the plan is accountable for making and tracking the
//   linkage, not for delivering the service, and it cannot close a referral it does not control.
//   Folding these into CareProgramName would corrupt every enrolment and disenrollment metric on
//   the Programs tab with services the plan never ran.
//
//   A CARE TEAM is who is actually around the member, internal and external together. The agenda
//   asks how a single source of truth is maintained across teams, programmes and outside agencies;
//   a team list that stops at the plan's own staff cannot answer it, because the person a foster
//   child sees most may not work for the plan at all.
import { TODAY } from './case-fields';
import { CM_CASE_POOL, CmCaseRec, CARE_MANAGERS } from './cm-case-pool';

function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(base: Date, days: number): Date { const d = new Date(base); d.setDate(d.getDate() + days); return d; }

export type ExternalSponsor = 'Community-based organization' | 'State agency' | 'School district' | 'Faith-based organization';

export interface ExternalProgram {
  id: string;
  name: string;
  sponsor: ExternalSponsor;
  organization: string;
  services: string[];
  contactName: string;
  contactRole: string;
  contactPhone: string;
  /** Whether the organisation reports service delivery back to the plan. Where it does not, a
   *  linkage can be made and never confirmed — which is precisely the closed-loop gap the
   *  coordination agenda asks about, so it is a field rather than an assumption. */
  reportsBack: boolean;
}

export const EXTERNAL_PROGRAMS: ExternalProgram[] = [
  {
    id: 'EXT-FOSTERCONNECT', name: 'FosterConnect', sponsor: 'Community-based organization',
    organization: 'FosterConnect', services: ['Clothing', 'Food assistance', 'Respite care'],
    contactName: 'Fred Flint, SW', contactRole: 'Social Worker — FosterConnect', contactPhone: '123-456-7777',
    reportsBack: true,
  },
  {
    id: 'EXT-COMMUNITY-TABLE', name: 'Community Table', sponsor: 'Faith-based organization',
    organization: 'Community Table Network', services: ['Food pantry', 'Meal delivery'],
    contactName: 'Alma Reyes', contactRole: 'Program Coordinator', contactPhone: '214-555-0164',
    reportsBack: false,
  },
  {
    id: 'EXT-BRIDGE-HOUSING', name: 'Bridge Housing Alliance', sponsor: 'Community-based organization',
    organization: 'Bridge Housing Alliance', services: ['Housing navigation', 'Utility assistance'],
    contactName: 'Deshawn Pierce', contactRole: 'Housing Navigator', contactPhone: '214-555-0192',
    reportsBack: true,
  },
  {
    id: 'EXT-PARENTLINK', name: 'ParentLink', sponsor: 'State agency',
    organization: 'State Family Services — ParentLink', services: ['Parenting support', 'Respite care'],
    contactName: 'Nora Whitfield', contactRole: 'Family Support Specialist', contactPhone: '512-555-0138',
    reportsBack: true,
  },
  {
    id: 'EXT-WHEELS', name: 'Wheels to Care', sponsor: 'Community-based organization',
    organization: 'Wheels to Care', services: ['Non-emergency transport'],
    contactName: 'Marcus Bell', contactRole: 'Dispatch Lead', contactPhone: '214-555-0177',
    reportsBack: false,
  },
];
export const EXTERNAL_PROGRAM_BY_ID = new Map(EXTERNAL_PROGRAMS.map((p) => [p.id, p]));

/** A member's link to an outside programme. Deliberately not called an enrolment: the plan refers
 *  and tracks, the organisation decides and delivers. */
export type LinkStatus = 'Referred' | 'Engaged' | 'Declined' | 'Unable to contact' | 'Completed';
export interface ExternalProgramLink {
  memberId: string;
  programId: string;
  referredDate: string;
  referredBy: string;
  status: LinkStatus;
  lastConfirmed: string | null;   // null where the organisation does not report back
}

export type CareTeamRelation =
  | 'Primary case owner' | 'Secondary care manager' | 'Primary care provider'
  | 'Behavioral health clinician' | 'External program contact' | 'Guardian / caregiver'
  | 'School liaison' | 'Guardian ad Litem';

export interface CareTeamMember {
  memberId: string;
  name: string;
  relation: CareTeamRelation;
  organization: string;
  phone: string;
  /** Internal means an account in this system whose actions land on the audit trail. External
   *  means they do not, and a reviewer should know which of the two they are reading about. */
  internal: boolean;
  addedDate: string;
}

const PCPS = ['Dr. Alicia Ramos', 'Dr. Owen Hartley', 'Dr. Priya Raman', 'Dr. Marcus Webb', 'Dr. Lena Ostrowski'];
const PCP_ORGS = ['Lakeview Family Medicine', 'Northside Pediatrics', 'Riverbend Primary Care', 'Summit Health Partners'];

function phoneFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return `214-555-${String(h % 10000).padStart(4, '0')}`;
}

/** Every managed member has at least a case owner and a PCP; a minority carry an external contact.
 *  Built off the case pool so the team is real for any member a reviewer opens, not just the two
 *  from the workflow specification. */
function buildCareTeams(cases: CmCaseRec[]): CareTeamMember[] {
  const out: CareTeamMember[] = [];
  cases.forEach((c, i) => {
    const added = isoDate(addDays(TODAY, -(30 + (i * 7) % 300)));
    out.push({
      memberId: c.memberId, name: c.careManager, relation: 'Primary case owner',
      organization: 'Zyter TruCare — Care Management', phone: phoneFor(c.careManager),
      internal: true, addedDate: added,
    });
    out.push({
      memberId: c.memberId, name: PCPS[i % PCPS.length], relation: 'Primary care provider',
      organization: PCP_ORGS[(i * 3 + 1) % PCP_ORGS.length], phone: phoneFor(c.memberId + 'pcp'),
      internal: false, addedDate: added,
    });
    // A behavioural health clinician where the case carries a BH dimension.
    if (i % 4 === 1) {
      out.push({
        memberId: c.memberId, name: ['R. Osei, LPC', 'T. Nakamura, LCSW', 'B. Adeyemi, LMFT'][i % 3],
        relation: 'Behavioral health clinician', organization: 'Integrated Behavioral Health',
        phone: phoneFor(c.memberId + 'bh'), internal: false, addedDate: added,
      });
    }
  });
  return out;
}

function buildExternalLinks(cases: CmCaseRec[]): ExternalProgramLink[] {
  const out: ExternalProgramLink[] = [];
  const statuses: LinkStatus[] = ['Referred', 'Engaged', 'Engaged', 'Declined', 'Unable to contact', 'Completed'];
  cases.forEach((c, i) => {
    // Roughly a third of the managed population carries at least one community linkage — enough
    // for the panel to mean something, not so many that "linked" stops being informative.
    if ((i * 17 + 5) % 100 >= 34) return;
    const prog = EXTERNAL_PROGRAMS[(i * 3 + 1) % EXTERNAL_PROGRAMS.length];
    const status = statuses[(i * 5 + 2) % statuses.length];
    const referred = addDays(TODAY, -(14 + (i * 11) % 180));
    out.push({
      memberId: c.memberId, programId: prog.id, referredDate: isoDate(referred),
      referredBy: c.careManager, status,
      // An organisation that does not report back leaves the loop open by design, and the screen
      // should show that rather than inventing a confirmation date.
      lastConfirmed: prog.reportsBack && (status === 'Engaged' || status === 'Completed')
        ? isoDate(addDays(referred, 5 + (i % 20))) : null,
    });
  });
  return out;
}

export const CARE_TEAMS: CareTeamMember[] = buildCareTeams(CM_CASE_POOL);
export const EXTERNAL_PROGRAM_LINKS: ExternalProgramLink[] = buildExternalLinks(CM_CASE_POOL);

// ---------------------------------------------------------------------------------------------
// The foster-care scenario member from the workflow specification. Held here rather than in the
// generated pools because the specification names these people, and a demo that says "Fred Flint,
// FosterConnect" while the screen shows a generated name is a demo nobody believes.
// ---------------------------------------------------------------------------------------------
export const SCENARIO_CARE_TEAM: Record<string, CareTeamMember[]> = {};
export const SCENARIO_EXTERNAL_LINKS: Record<string, ExternalProgramLink[]> = {};

export function registerScenarioCareTeam(memberId: string, team: CareTeamMember[], links: ExternalProgramLink[]) {
  SCENARIO_CARE_TEAM[memberId] = team;
  SCENARIO_EXTERNAL_LINKS[memberId] = links;
}

export function careTeamFor(memberId: string): CareTeamMember[] {
  return SCENARIO_CARE_TEAM[memberId] ?? CARE_TEAMS.filter((t) => t.memberId === memberId);
}
export function externalLinksFor(memberId: string): ExternalProgramLink[] {
  return SCENARIO_EXTERNAL_LINKS[memberId] ?? EXTERNAL_PROGRAM_LINKS.filter((l) => l.memberId === memberId);
}

/** Population-level rollup for the Programs tab: how many members are linked to each outside
 *  programme, and how many of those linkages were ever confirmed as delivered. */
export interface ExternalProgramStat {
  program: ExternalProgram;
  linked: number;
  engaged: number;
  declined: number;
  unconfirmed: number;   // referred or engaged, never confirmed back
}
export function externalProgramStats(links: ExternalProgramLink[] = EXTERNAL_PROGRAM_LINKS): ExternalProgramStat[] {
  return EXTERNAL_PROGRAMS.map((program) => {
    const mine = links.filter((l) => l.programId === program.id);
    return {
      program,
      linked: mine.length,
      engaged: mine.filter((l) => l.status === 'Engaged' || l.status === 'Completed').length,
      declined: mine.filter((l) => l.status === 'Declined' || l.status === 'Unable to contact').length,
      unconfirmed: mine.filter((l) => l.lastConfirmed === null && l.status !== 'Declined' && l.status !== 'Unable to contact').length,
    };
  }).sort((a, b) => b.linked - a.linked);
}
