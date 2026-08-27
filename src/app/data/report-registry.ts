// Report registry — granular, operational reports (UM/CM/Appeals; Cost & Utilization excluded
// per request). Every report calls straight into the SAME calculation functions already backing
// each module's dashboard tabs, so a report's numbers always reconcile with what's on screen
// elsewhere — nothing here is recomputed independently.
//
// Design rules, per direct feedback on the first two passes at this:
// 1. One report = one specific query (Queue Standing, Breach Detail, Team Workload, PTO, etc.),
//    not one report per dashboard tab bundling several unrelated tables together.
// 2. Full, real detail by default — no pre-baked "top 5" or "only the bad ones" truncation. If a
//    slice is useful, it's a dropdown filter the user picks, not a decision the report makes for
//    them. This is for actual operational use, not an executive summary.
// 3. No KPI tiles. Just filters and tables.
//
// UM is implemented first (its data layer — including the new real IRR process — is the most
// complete). CM and Appeals follow the identical ReportDef shape.
import {
  liveTatBuckets, liveTatStats, liveDecisionRows, liveDecisionStats, liveConcurrentRows,
  liveMissingFields, liveProviderInsights, liveQualityBars, liveComplianceBars,
  liveIrrByReviewer, liveIrrCorrectiveActions, liveIrrDiscrepancyReasons, liveRegCompliance, inScope,
  liveDeterminationMix,
  DashboardData,
} from './dashboard-data';
import { PROVIDERS, CASE_POOL, NURSES } from './case-pool';
import {
  TODAY, urgencyOf, authTypeOf, LOBS, lobOf, daysAgo, serviceCategoryOf, SERVICE_CATEGORIES,
  intakeChannelOf, routingStatusOf, isDuplicateOf, duplicateResolvedOf, missingInfoCategoryOf,
  reviewTypeOf, providerIssueOf, intakeProcessingStatusOf, INTAKE_CHANNELS,
  intakeCategoryOf, rfiOriginStageOf,
} from './case-fields';
import { COLUMNS, toRow } from '../shared/metrics';
import { IRR_TARGET_PCT } from './um-irr';
import { UM_NURSE_ROSTER, UM_ROLLING_4_WEEKS, UM_MONTHLY_WEEKS, UM_PTO_BALANCES, UM_UPCOMING_WEEKS, UM_TODAY_ISO } from './um-schedule';

export const UM_QUEUE_NAMES = ['Intake', 'Clinical Review', 'MD Review', 'RFI Pending', 'OON Review', 'Concurrent Review', 'Pending P2P'];
export const UM_TEAMS = ['Inpatient Review', 'Outpatient Review', 'Complex & Concurrent'];
function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(base: Date, days: number): Date { const d = new Date(base); d.setDate(d.getDate() + days); return d; }
function mondayOf(d: Date): Date { const day = d.getDay(); return addDays(d, day === 0 ? -6 : 1 - day); }
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
const ALL = 'All';

// Rachel Foster isn't in case-pool.ts's NURSES roster (she's a manually-added 7th teammate — see
// dashboard-data.ts), so nurseStatsForLob() correctly returns all-zero for her (no case-pool rows
// reference her). Her real workload lives only on the base nurses() row and isn't LOB/date-scoped —
// same special-case the Workforce & Queue Management tab itself applies.
function workloadFor(n: { name: string; active: number; pending: number; completed: number; avgTat: string }, ctx: ReportContext) {
  if (!NURSES.includes(n.name)) return { active: n.active, pending: n.pending, completed: n.completed, avgTat: n.avgTat };
  return ctx.data.nurseStatsForLob(n.name, ctx.lob, ctx.days);
}

export interface ReportTable { title: string; columns: string[]; rows: (string | number)[][]; }
export interface ReportDimensionFilter { label: string; options: string[]; }

export interface ReportContext {
  lob?: string | string[];
  days?: number;
  dimension?: string;  // currently-selected value of the report's optional dimension filter
  dimension2?: string; // a second, independent dropdown — for reports needing two orthogonal filters (e.g. TAT's Auth Type + Service Category)
  queues?: string[];  // selected queues, for queueFilterable reports — empty/undefined = all queues
  memberSearch?: string; // free-text member-name filter, for caseLevel/historyFilterable/memberSearchable reports
  period?: string; // schedulePeriod reports only — Daily/Weekly/Rolling 4 Weeks/Monthly
  historyTeam?: string;  // historyFilterable reports only
  historyStaff?: string;
  historyActor?: string;
  data: DashboardData; // for the handful of reports that need session-mutable signals (nurses(), riskCases(), auditFlags())
}

export interface ReportDef {
  id: string;
  module: 'um' | 'cm' | 'appeals' | 'generic';
  group: string; // sidebar sub-heading — groups a long report list into findable clusters (WFM, Audit & Compliance, etc.)
  title: string;
  description: string;
  staticNote?: string; // shown as a callout when part/all of the report is illustrative, not live
  dimension?: ReportDimensionFilter;
  dimension2?: ReportDimensionFilter; // a second, independent dropdown alongside `dimension`
  noLobDays?: boolean; // true for reports that aren't LOB/date-scoped (staffing/schedule-based)
  // A caseLevel report can be drilled further, same as any dashboard tile: select specific queues
  // and/or search by member, and the resulting table uses the exact same columns as every other
  // case drilldown in the app (shared/metrics.ts's COLUMNS/toRow), not a bespoke column set.
  caseLevel?: boolean;
  queueFilterable?: boolean; // adds a Queue multi-select — only meaningful for pending-only reports where `status` is a real queue name
  historyFilterable?: boolean; // adds Team / Staff / Actor dropdowns + Member search, for HistoryEntry-based reports
  memberSearchable?: boolean; // adds a plain Member search box (for non-caseLevel, non-history reports that still want it, e.g. Concurrent Review)
  schedulePeriod?: boolean;   // adds a Daily/Weekly/Rolling 4 Weeks/Monthly dropdown, for schedule/adherence reports
  tables: (ctx: ReportContext) => ReportTable[];
}

export const UM_REPORTS: ReportDef[] = [
  // ---- Workforce & Queue Management, split into its component queries ----
  {
    id: 'um-queue-standing', module: 'um', group: 'Queue & Case Operations', title: 'Queue Standing',
    description: 'Unclaimed authorizations by queue, with full age-band, breach, and by-LOB detail.',
    tables: (ctx) => {
      const activeLobs = Array.isArray(ctx.lob) && ctx.lob.length ? ctx.lob : (typeof ctx.lob === 'string' && ctx.lob !== 'all' ? [ctx.lob] : LOBS);
      const byLobRows = UM_QUEUE_NAMES.map((q) => [q, ...activeLobs.map((l) => ctx.data.queueStatsScoped(q, l, ctx.days).count)]);
      return [
        { title: 'Queue Standing', columns: ['Queue', 'Unclaimed', '0-24h %', '24-48h %', '>48h %', 'Breach %'],
          rows: UM_QUEUE_NAMES.map((q) => {
            const s = ctx.data.queueStatsScoped(q, ctx.lob, ctx.days);
            return [q, s.count, `${s.buckets.fresh}%`, `${s.buckets.day2}%`, `${s.buckets.over48}%`, `${s.buckets.breach}%`];
          }) },
        { title: 'Queue Standing by LOB', columns: ['Queue', ...activeLobs], rows: byLobRows },
      ];
    },
  },
  {
    id: 'um-breach-detail', module: 'um', group: 'Queue & Case Operations', title: 'Breach Detail',
    description: 'Every unclaimed authorization currently past its TAT deadline, case-level — select specific queues and/or search by member. Matches the Workforce tab\'s queue-card breach drill (unclaimed only — already-assigned breaches show under that nurse\'s workload instead).',
    caseLevel: true, queueFilterable: true,
    tables: (ctx) => {
      const search = ctx.memberSearch?.trim().toLowerCase();
      const rows = CASE_POOL.filter((c) => c.phase === 'pending' && c.nurse === '—' && c.tags.includes('breached') && inScope(c, ctx.lob, ctx.days)
        && (!ctx.queues?.length || ctx.queues.includes(c.status))
        && (!search || c.member.toLowerCase().includes(search)));
      return [{ title: 'Breached Authorizations', columns: COLUMNS, rows: rows.map(toRow) }];
    },
  },
  {
    id: 'um-team-workload', module: 'um', group: 'Workforce Management (WFM)', title: 'Team & Nurse Workload',
    description: 'Full per-nurse workload — active, pending, completed, TAT, and utilization — plus team rollups. Filter by team and/or search by nurse name.',
    dimension: { label: 'Team', options: [ALL, ...UM_TEAMS] },
    memberSearchable: true,
    tables: (ctx) => {
      const search = ctx.memberSearch?.trim().toLowerCase();
      const nurses = ctx.data.nurses().filter((n) => (!ctx.dimension || ctx.dimension === ALL || n.team === ctx.dimension)
        && (!search || n.name.toLowerCase().includes(search)));
      const rows = nurses.map((n) => {
        const s = workloadFor(n, ctx);
        return [n.name, n.team, s.active, s.pending, s.completed, s.avgTat, `${n.utilization}%`];
      });
      const teamTotals = UM_TEAMS.filter((t) => !ctx.dimension || ctx.dimension === ALL || t === ctx.dimension).map((t) => {
        const mine = ctx.data.nurses().filter((n) => n.team === t);
        const stats = mine.map((n) => workloadFor(n, ctx));
        const active = stats.reduce((s, x) => s + x.active, 0);
        const pending = stats.reduce((s, x) => s + x.pending, 0);
        const completed = stats.reduce((s, x) => s + x.completed, 0);
        const avgTatH = stats.length ? stats.reduce((s, x) => s + parseFloat(x.avgTat), 0) / stats.length : 0;
        const util = Math.round(mine.reduce((s, n) => s + n.utilization, 0) / (mine.length || 1));
        return [t, mine.length, active, pending, completed, `${avgTatH.toFixed(1)}h`, `${util}%`];
      });
      return [
        { title: 'Workload by Nurse', columns: ['Nurse', 'Team', 'Active', 'Pending (RFI/P2P)', 'Completed', 'Avg TAT', 'Utilization'], rows },
        { title: 'Team Totals', columns: ['Team', 'Nurses', 'Total Active', 'Total Pending', 'Total Completed', 'Avg TAT', 'Avg Utilization'], rows: teamTotals },
      ];
    },
  },
  {
    id: 'um-assignment-history', module: 'um', group: 'Workforce Management (WFM)', title: 'Reassignment & Assignment History',
    description: 'The session\'s log of reassignments, balancing moves, and PTO-driven reassignments — filter by date, team, staff, who made the change, and member.',
    historyFilterable: true,
    tables: (ctx) => {
      const search = ctx.memberSearch?.trim().toLowerCase();
      const rows = ctx.data.assignmentHistory().filter((h) =>
        (ctx.days === undefined || daysAgo(h.date) <= ctx.days)
        && (!ctx.historyTeam || ctx.historyTeam === ALL || h.team === ctx.historyTeam)
        && (!ctx.historyStaff || ctx.historyStaff === ALL || h.fromStaff === ctx.historyStaff || h.toStaff === ctx.historyStaff)
        && (!ctx.historyActor || ctx.historyActor === ALL || h.actor === ctx.historyActor)
        && (!search || (h.members ?? []).some((m) => m.toLowerCase().includes(search))));
      return [{ title: 'Assignment History', columns: ['Date', 'Time', 'Action', 'Detail', 'Team', 'From', 'To', 'Members', 'By'],
        rows: rows.map((h) => [h.date, h.time, h.action, h.detail, h.team ?? '—', h.fromStaff ?? '—', h.toStaff ?? '—', (h.members ?? []).join(', ') || '—', h.actor]) }];
    },
  },

  // ---- Scheduling & Adherence, split ----
  {
    id: 'um-adherence-detail', module: 'um', group: 'Workforce Management (WFM)', title: 'Adherence Detail by Nurse',
    description: 'Every nurse\'s on-time/exception rate over the selected period. Not LOB/date-filtered — schedules aren\'t tied to a member\'s LOB.',
    staticNote: 'Underlying shifts/attendance are a deterministic seeded dataset, not a real timeclock feed — see the field guide.',
    dimension: { label: 'Team', options: [ALL, ...UM_TEAMS] },
    noLobDays: true,
    memberSearchable: true,
    schedulePeriod: true,
    tables: (ctx) => {
      const blocks = ctx.period === 'monthly' ? UM_MONTHLY_WEEKS
        : ctx.period === 'weekly' || ctx.period === 'daily' ? UM_ROLLING_4_WEEKS.slice(-1)
        : UM_ROLLING_4_WEEKS;
      let adherence = blocks.flatMap((w) => w.adherence);
      if (ctx.period === 'daily') adherence = adherence.filter((a) => a.date === UM_TODAY_ISO);
      const search = ctx.memberSearch?.trim().toLowerCase();
      const roster = UM_NURSE_ROSTER.filter((n) => (!ctx.dimension || ctx.dimension === ALL || n.team === ctx.dimension)
        && (!search || n.name.toLowerCase().includes(search)));
      const rows = roster.map((n) => {
        const mine = adherence.filter((a) => a.nurse === n.name);
        const onTime = mine.filter((a) => a.status === 'On Time').length;
        const late = mine.filter((a) => a.status === 'Late Start').length;
        const early = mine.filter((a) => a.status === 'Early Leave').length;
        const ot = mine.filter((a) => a.status === 'Overtime').length;
        const absent = mine.filter((a) => a.status === 'Absence').length;
        return [n.name, n.team, mine.length ? `${pct(onTime, mine.length)}%` : '100%', late, early, ot, absent];
      });
      const detailRows = roster.flatMap((n) => adherence.filter((a) => a.nurse === n.name)
        .map((a) => [a.nurse, a.date, a.day, a.scheduledStart, a.actualStart ?? '—', a.status, a.varianceMin]));
      const periodLabel = ctx.period === 'daily' ? 'Today' : ctx.period === 'weekly' ? 'This Week' : ctx.period === 'monthly' ? 'Monthly (5 Weeks)' : 'Rolling 4 Weeks';
      return [
        { title: `Adherence Detail (${periodLabel})`, columns: ['Nurse', 'Team', 'Adherence Rate', 'Late Start', 'Early Leave', 'Overtime', 'Absence'], rows },
        { title: 'Day-Level Detail', columns: ['Nurse', 'Date', 'Day', 'Scheduled Start', 'Actual Start', 'Status', 'Variance (min)'], rows: detailRows },
      ];
    },
  },
  {
    id: 'um-pto-balances', module: 'um', group: 'Workforce Management (WFM)', title: 'PTO Balances',
    description: 'Accrued, used, and remaining PTO for every nurse, year-to-date.',
    dimension: { label: 'Team', options: [ALL, ...UM_TEAMS] },
    noLobDays: true,
    tables: (ctx) => {
      const rows = UM_PTO_BALANCES.filter((p) => !ctx.dimension || ctx.dimension === ALL || p.team === ctx.dimension)
        .map((p) => [p.nurse, p.team, p.accruedDays, p.usedDays, p.remainingDays]);
      return [{ title: 'PTO Balances (YTD)', columns: ['Nurse', 'Team', 'Accrued', 'Used', 'Remaining'], rows }];
    },
  },
  {
    id: 'um-pto-upcoming', module: 'um', group: 'Workforce Management (WFM)', title: 'Upcoming PTO',
    description: 'Scheduled PTO days over the next 3 weeks, by nurse and date.',
    noLobDays: true,
    dimension: { label: 'Team', options: [ALL, ...UM_TEAMS] },
    tables: (ctx) => {
      const rows: (string | number)[][] = [];
      UM_UPCOMING_WEEKS.forEach((block) => {
        block.schedules.filter((s) => !ctx.dimension || ctx.dimension === ALL || s.team === ctx.dimension).forEach((s) => {
          s.days.forEach((d) => {
            if (d.type === 'PTO' && d.date >= isoDate(TODAY)) rows.push([s.nurse, s.team, d.day, d.date]);
          });
        });
      });
      rows.sort((a, b) => String(a[3]).localeCompare(String(b[3])));
      return [{ title: 'Upcoming PTO (Next 3 Weeks)', columns: ['Nurse', 'Team', 'Day', 'Date'], rows }];
    },
  },

  // ---- Demand & Forecasting, split ----
  {
    id: 'um-demand-weekly', module: 'um', group: 'Workforce Management (WFM)', title: 'Weekly Submission Volume',
    description: 'Raw weekly authorization-submission counts, trailing 9 weeks.',
    noLobDays: true,
    dimension: { label: 'Team', options: [ALL, ...UM_TEAMS] },
    tables: (ctx) => {
      const teamOf = new Map(UM_NURSE_ROSTER.map((n) => [n.name, n.team]));
      const weeksBack = 9;
      const thisMonday = mondayOf(TODAY);
      const buckets = Array.from({ length: weeksBack }, (_, i) => {
        const start = addDays(thisMonday, -(weeksBack - 1 - i) * 7);
        return { start, end: addDays(start, 6), count: 0 };
      });
      CASE_POOL.filter((c) => !ctx.dimension || ctx.dimension === ALL || teamOf.get(c.nurse) === ctx.dimension).forEach((c) => {
        const d = new Date(`${c.submitted}T00:00:00`);
        const b = buckets.find((bk) => d >= bk.start && d <= bk.end);
        if (b) b.count++;
      });
      return [{ title: 'Weekly Submission Volume (9 Weeks)', columns: ['Week Of', 'Submissions'], rows: buckets.map((b) => [isoDate(b.start), b.count]) }];
    },
  },
  {
    id: 'um-capacity-coverage', module: 'um', group: 'Workforce Management (WFM)', title: 'Capacity & Coverage Outlook',
    description: 'Projected next-week volume against nurse capacity — team-wide, or Caseload Headroom (capacity minus current active) when a team is selected.',
    noLobDays: true,
    dimension: { label: 'Team', options: [ALL, ...UM_TEAMS] },
    tables: (ctx) => {
      const CAPACITY_PER_NURSE = 25;
      const team = !ctx.dimension || ctx.dimension === ALL ? undefined : ctx.dimension;
      const teamOf = new Map(UM_NURSE_ROSTER.map((n) => [n.name, n.team]));
      const weeksBack = 9;
      const thisMonday = mondayOf(TODAY);
      const buckets = Array.from({ length: weeksBack }, (_, i) => {
        const start = addDays(thisMonday, -(weeksBack - 1 - i) * 7);
        return { start, end: addDays(start, 6), count: 0 };
      });
      CASE_POOL.filter((c) => !team || teamOf.get(c.nurse) === team).forEach((c) => {
        const d = new Date(`${c.submitted}T00:00:00`);
        const b = buckets.find((bk) => d >= bk.start && d <= bk.end);
        if (b) b.count++;
      });
      const complete = buckets.slice(0, -1);
      const recentBasis = complete.slice(-4).map((w) => w.count);
      const projected = recentBasis.length ? Math.round(recentBasis.reduce((s, v) => s + v, 0) / recentBasis.length) : 0;
      const allNurses = ctx.data.nurses();
      const nurseDetail = (team ? allNurses.filter((n) => n.team === team) : allNurses).map((n) => [n.name, n.team, n.active, `${n.utilization}%`]);
      let teamCapacity: number;
      if (team) {
        const teamNurses = allNurses.filter((n) => n.team === team);
        const active = teamNurses.reduce((s, n) => s + n.active, 0);
        teamCapacity = Math.max(0, teamNurses.length * CAPACITY_PER_NURSE - active);
      } else {
        teamCapacity = UM_NURSE_ROSTER.length * CAPACITY_PER_NURSE;
      }
      const overCapacity = projected > teamCapacity;
      const capacityLabel = team ? 'Caseload Headroom' : 'Total Nurse Capacity';
      const rows = UM_TEAMS.map((t) => {
        const teamNurses = UM_NURSE_ROSTER.filter((n) => n.team === t);
        const capacity = teamNurses.length * CAPACITY_PER_NURSE;
        return [t, teamNurses.length, capacity];
      });
      return [
        { title: 'Capacity by Team', columns: ['Team', 'Nurses', 'Nominal Capacity'], rows },
        { title: 'Per-Nurse Capacity & Utilization', columns: ['Nurse', 'Team', 'Active', 'Utilization'], rows: nurseDetail },
        {
          title: 'Coverage Outlook', columns: ['Metric', 'Value'],
          rows: [['This Week (to date)', buckets[buckets.length - 1].count], ['Projected Next Week', projected], [capacityLabel, teamCapacity], ['Margin', teamCapacity - projected], ['Outlook', overCapacity ? 'At Risk' : 'Adequate']],
        },
      ];
    },
  },

  // ---- Remaining tabs (unchanged in scope for this pass — already single-topic) ----
  {
    id: 'um-tat', module: 'um', group: 'Clinical & Utilization', title: 'TAT Compliance',
    description: 'Turnaround-time buckets, by-LOB and by-Service-Category compliance, urgency/pause detail, regulatory-clock and notification compliance, and inpatient concurrent-review aggregates — same breakdown as the TAT Compliance tab.',
    dimension: { label: 'Auth Type', options: [ALL, 'IP', 'OP', 'RX'] },
    dimension2: { label: 'Service Category', options: [ALL, ...SERVICE_CATEGORIES] },
    staticNote: 'Notification Compliance late/on-time flags are a deterministic seeded pattern, not real notice-delivery timestamps — see the field guide.',
    tables: (ctx) => {
      const authType = !ctx.dimension || ctx.dimension === ALL ? undefined : ctx.dimension;
      const svcCat = !ctx.dimension2 || ctx.dimension2 === ALL ? undefined : ctx.dimension2;
      const decided = CASE_POOL.filter((c) => c.phase === 'decided' && inScope(c, ctx.lob, ctx.days)
        && (!authType || authTypeOf(c) === authType) && (!svcCat || serviceCategoryOf(c) === svcCat));
      const total = decided.length || 1;
      const onTrackAll = decided.filter((c) => c.tags.includes('onTrack')).length;
      const atRiskAll = decided.filter((c) => c.tags.includes('atRisk')).length;
      const breachedAll = decided.filter((c) => c.tags.includes('breached')).length;

      const lobRows = LOBS.filter((l) => !Array.isArray(ctx.lob) || !ctx.lob.length || ctx.lob.includes(l)).map((l) => {
        const cs = decided.filter((c) => lobOf(c.authId) === l);
        const onTrack = cs.filter((c) => c.tags.includes('onTrack')).length;
        const atRisk = cs.filter((c) => c.tags.includes('atRisk')).length;
        const breached = cs.filter((c) => c.tags.includes('breached')).length;
        return [l, cs.length, onTrack, atRisk, breached, pct(onTrack, cs.length)];
      }).sort((a, b) => (b[1] as number) - (a[1] as number));

      const svcRows = SERVICE_CATEGORIES.map((s) => {
        const cs = decided.filter((c) => serviceCategoryOf(c) === s);
        const onTrack = cs.filter((c) => c.tags.includes('onTrack')).length;
        const atRisk = cs.filter((c) => c.tags.includes('atRisk')).length;
        const breached = cs.filter((c) => c.tags.includes('breached')).length;
        return [s, cs.length, onTrack, atRisk, breached, pct(onTrack, cs.length)];
      }).filter((r) => (r[1] as number) > 0).sort((a, b) => (b[1] as number) - (a[1] as number));

      const regGroups = [
        { name: 'Expedited / Urgent', clock: '72 hours', tag: 'expedited' },
        { name: 'Standard Pre-Service', clock: '14 calendar days', tag: 'standard' },
      ].map((g) => {
        const grp = decided.filter((c) => c.tags.includes(g.tag));
        const t = grp.length || 1;
        const onTime = grp.filter((c) => c.tags.includes('onTrack')).length;
        const atRisk = grp.filter((c) => c.tags.includes('atRisk')).length;
        const breached = grp.filter((c) => c.tags.includes('breached')).length;
        return [g.name, g.clock, grp.length, onTime, atRisk, breached, pct(onTime, t)];
      });

      const adverse = decided.filter((c) => c.tags.includes('appeal'));
      const memberLateCount = adverse.filter((_, i) => i % 31 === 0).length;
      const providerLateCount = decided.filter((_, i) => i % 55 === 0).length;
      const memberPct = adverse.length ? pct(adverse.length - memberLateCount, adverse.length) : 0;
      const providerPct = decided.length ? pct(decided.length - providerLateCount, decided.length) : 0;

      const concRows = liveConcurrentRows(ctx.lob, ctx.days);
      const cn = concRows.length || 1;
      const pending = CASE_POOL.filter((c) => c.phase === 'pending');
      const concurrentActive = pending.filter((c) => c.tags.includes('concurrent') && inScope(c, ctx.lob, ctx.days)).length;
      const overstay = concRows.filter((r) => r.overstayRisk !== 'green').length;
      const daysApproved = concRows.reduce((s, r) => s + r.totalCertifiedDays, 0);
      const daysRequested = concRows.reduce((s, r) => s + r.daysRequested, 0);
      const avgLos = (concRows.reduce((s, r) => s + parseInt(r.los), 0) / cn).toFixed(1);
      const avgExp = (concRows.reduce((s, r) => s + parseInt(r.expectedLos), 0) / cn).toFixed(1);

      return [
        { title: 'TAT Buckets', columns: ['Bucket', 'Decisions'], rows: [['On Track', onTrackAll], ['At Risk', atRiskAll], ['Breached', breachedAll]] },
        { title: 'TAT Compliance by Line of Business', columns: ['LOB', 'Total Decisions', 'On Track', 'At Risk', 'Breached', 'Compliance %'], rows: lobRows },
        { title: 'TAT Compliance by Service Category', columns: ['Service Category', 'Total Decisions', 'On Track', 'At Risk', 'Breached', 'Compliance %'], rows: svcRows },
        { title: 'Urgency & Pause Detail', columns: ['Metric', 'Value'], rows: liveTatStats(ctx.lob, ctx.days).map((s) => [s.label, s.value]) },
        { title: 'Regulatory TAT by Urgency', columns: ['Urgency', 'Clock', 'Total', 'On Time', 'At Risk', 'Breached', 'Compliance %'], rows: regGroups },
        { title: 'Notification Compliance', columns: ['Metric', 'Value'], rows: [['Member Notice On-Time %', `${memberPct}%`], ['Provider Notice On-Time %', `${providerPct}%`], ['Avg Time to Notice (d)', 0.7], ['Late Notices', memberLateCount + providerLateCount]] },
        { title: 'Inpatient Concurrent Review', columns: ['Metric', 'Value'], rows: [['Active Reviews', concurrentActive], ['Overstay Risk', overstay], ['Days Approved', daysApproved], ['Days Requested', daysRequested], ['Avg LOS (d)', avgLos], ['Avg Expected LOS (d)', avgExp]] },
      ];
    },
  },
  {
    id: 'um-daily-ip', module: 'um', group: 'Queue & Case Operations', title: 'Daily Inpatient Authorization Requests',
    description: 'Inpatient authorizations submitted in the selected window, case-level — defaults to a daily grain via the Lookback filter (pick "Today"); search by member.',
    caseLevel: true,
    tables: (ctx) => {
      const search = ctx.memberSearch?.trim().toLowerCase();
      const rows = CASE_POOL.filter((c) => authTypeOf(c) === 'IP' && inScope(c, ctx.lob, ctx.days) && (!search || c.member.toLowerCase().includes(search)));
      return [{ title: 'Inpatient Authorization Requests', columns: COLUMNS, rows: rows.map(toRow) }];
    },
  },
  {
    id: 'um-clinical', module: 'um', group: 'Clinical & Utilization', title: 'Decision & Determination Insights',
    description: 'Headline decision mix, approval rate/volume by procedure, and reason codes by outcome.',
    dimension: { label: 'Service Type', options: [ALL, 'Inpatient', 'Outpatient', 'Behavioral'] },
    dimension2: { label: 'Reason Codes — Outcome', options: ['Denied', 'Partial', 'Approved'] },
    tables: (ctx) => {
      const rows = liveDecisionRows(ctx.lob, ctx.days).filter((r) => !ctx.dimension || ctx.dimension === ALL || r.serviceType === ctx.dimension);
      const outcome = (ctx.dimension2 || 'Denied') as 'Denied' | 'Partial' | 'Approved';
      const mix = liveDeterminationMix(outcome, ctx.lob, ctx.days);
      return [
        { title: 'Headline Decision Stats', columns: ['Metric', 'Value'], rows: liveDecisionStats(ctx.lob, ctx.days).map((s) => [s.label, s.value]) },
        { title: 'Decisions by Procedure', columns: ['Procedure', 'Service Type', 'Guideline', 'Approval Rate %', 'Volume', 'Below 80% Benchmark'],
          rows: rows.map((r) => [r.procedure, r.serviceType, r.guideline, r.approvalRate, r.volume, r.approvalRate < 80 ? 'Yes' : 'No']) },
        { title: `Reason Codes — ${outcome}`, columns: ['Code', 'Reason', 'Category', 'Count', '% of Outcome'],
          rows: mix.map((m) => [m.code, m.label, m.category, m.count, `${m.pct}%`]) },
      ];
    },
  },
  {
    id: 'um-risk', module: 'um', group: 'Clinical & Utilization', title: 'Risk & Escalation Worklist',
    description: 'Headline risk tiles plus the full high-risk/high-acuity authorization worklist, sorted by risk score.',
    staticNote: 'The Authorizations Requiring Attention worklist is a fixed illustrative seed list — see the field guide (not yet a live risk calculation). High-Dollar is a real CASE_POOL query; High-Acuity/Escalated Today read the live riskCases()/history() signals.',
    tables: (ctx) => {
      const ACUITY_DRIVERS = ['High-acuity ICU', 'Transplant', 'Oncology'];
      const rows = [...ctx.data.riskCases()].sort((a, b) => b.score - a.score);
      const highDollar = CASE_POOL.filter((c) => c.cost >= 50000 && inScope(c, ctx.lob, ctx.days));
      const exposure = highDollar.reduce((s, c) => s + c.cost, 0);
      const acuityCases = ctx.data.riskCases().filter((r) => r.drivers.some((d) => ACUITY_DRIVERS.includes(d)));
      const escalations = ctx.data.history().filter((h) => h.icon === 'arrowup');
      return [
        {
          title: 'Headline Risk Tiles', columns: ['Metric', 'Value', 'Detail'],
          rows: [
            ['SLA Breach Risk', rows.filter((r) => r.risk === 'red').length, '—'],
            ['High-Dollar (>$50k)', highDollar.length, `$${(exposure / 1_000_000).toFixed(1)}M exposure`],
            ['High-Acuity', acuityCases.length, 'ICU / transplant / oncology'],
            ['Escalated Today', escalations.length, `${escalations.length} this session`],
          ],
        },
        { title: 'Authorizations Requiring Attention', columns: ['Auth ID', 'Member', 'Risk Drivers', 'Amount', 'Stage', 'Risk Score'],
          rows: rows.map((r) => [r.authId, r.member, r.drivers.join('; '), r.amount, r.stage, r.score]) },
        { title: 'High-Dollar Authorizations (>$50k)', columns: ['Auth ID', 'Member', 'Procedure', 'Provider', 'Cost'],
          rows: highDollar.map((c) => [c.authId, c.member, c.procedure, c.provider, `$${c.cost.toLocaleString()}`]) },
        { title: 'High-Acuity Authorizations', columns: ['Auth ID', 'Member', 'Risk Drivers', 'Amount', 'Stage', 'Risk Score'],
          rows: acuityCases.map((r) => [r.authId, r.member, r.drivers.join(', '), r.amount, r.stage, r.score]) },
        { title: 'Escalated Today', columns: ['Time', 'Action', 'Detail'],
          rows: escalations.map((h) => [h.time, h.action, h.detail]) },
      ];
    },
  },
  {
    id: 'um-concurrent', module: 'um', group: 'Clinical & Utilization', title: 'Concurrent Review Monitoring',
    description: 'Full inpatient continued-stay review list — filter by status, search by member/facility/reviewer.',
    dimension: { label: 'Status', options: [ALL, 'Uncertified Days', 'Extension Requested', 'Recert Due', 'Certified'] },
    memberSearchable: true,
    tables: (ctx) => {
      const allRows = liveConcurrentRows(ctx.lob, ctx.days);
      const search = ctx.memberSearch?.trim().toLowerCase();
      const rows = allRows.filter((r) => (!ctx.dimension || ctx.dimension === ALL || r.status === ctx.dimension)
        && (!search || r.member.toLowerCase().includes(search) || r.facility.toLowerCase().includes(search) || r.reviewer.toLowerCase().includes(search)));
      const of = (status: string) => allRows.filter((r) => r.status === status).length;
      return [
        {
          title: 'Concurrent Review Stats', columns: ['Metric', 'Value'],
          rows: [['Active Reviews', allRows.length], ['Uncertified Days', of('Uncertified Days')], ['Extension Requested', of('Extension Requested')], ['Recert Due', of('Recert Due')], ['Certified', of('Certified')]],
        },
        {
          title: 'Concurrent Review Detail',
          columns: ['Member', 'Facility', 'LOS', 'Total Certified Days', 'Certified Through', 'Days Remaining', 'Uncertified Days', 'Next Review Due', 'Requested/Approved', 'Status', 'Reviewer', 'Expected Discharge', 'Next Action'],
          rows: rows.map((r) => [r.member, r.facility, r.los, r.totalCertifiedDays, r.certifiedThrough, r.daysRemaining, r.uncertifiedDays, r.nextReview, `${r.daysRequested} / ${r.totalCertifiedDays}`, r.status, r.reviewer, r.expectedDischarge, r.nextAction]),
        },
      ];
    },
  },
  {
    id: 'um-intake', module: 'um', group: 'Clinical & Utilization', title: 'Intake & Documentation Quality',
    description: 'Full Intake & Documentation Quality breakdown — headline rates, channel mix, routing, duplicates, TAT/assignment risk, missing information, missing fields, review timing, provider issues, and auto-processing.',
    dimension: { label: 'Category', options: ['All', 'Medical', 'IP', 'OP', 'RX', 'Behavioral Health'] },
    tables: (ctx) => {
      const cat = ctx.dimension && ctx.dimension !== 'All' ? ctx.dimension : undefined;
      const byCategory = (cs: typeof CASE_POOL) => !cat ? cs
        : cat === 'Medical' ? cs.filter((c) => intakeCategoryOf(c) !== 'Behavioral Health')
        : cs.filter((c) => intakeCategoryOf(c) === cat);
      const pend = byCategory(CASE_POOL.filter((c) => c.phase === 'pending' && inScope(c, ctx.lob, ctx.days)));
      const deci = byCategory(CASE_POOL.filter((c) => c.phase === 'decided' && inScope(c, ctx.lob, ctx.days)));
      const pendTotal = pend.length || 1; const deciTotal = deci.length || 1;
      const complete = pend.filter((c) => !c.tags.includes('incompleteDoc')).length;
      const auto = deci.filter((c) => c.tags.includes('auto')).length;
      const rfiIntake = pend.filter((c) => c.tags.includes('rfi') && rfiOriginStageOf(c) === 'Intake').length;

      const channelMix = INTAKE_CHANNELS.map((channel) => {
        const count = pend.filter((c) => intakeChannelOf(c) === channel).length;
        return [channel, count, pct(count, pend.length)];
      }).sort((a, b) => (b[1] as number) - (a[1] as number));

      const routingRows = (['Smart', 'Manual', 'Late'] as const).map((status) => {
        const matched = pend.filter((c) => routingStatusOf(c) === status);
        return [status, matched.filter((c) => urgencyOf(c) === 'Standard').length, matched.filter((c) => urgencyOf(c) === 'Expedited').length, matched.length];
      });

      const dupCs = pend.filter((c) => isDuplicateOf(c));
      const dupResolved = dupCs.filter((c) => duplicateResolvedOf(c)).length;

      const approachingTat = pend.filter((c) => c.tags.includes('atRisk')).length;
      const unassigned = pend.filter((c) => c.tags.includes('unassigned')).length;

      const missingInfoCs = pend.filter((c) => c.tags.includes('incompleteDoc'));
      const missingInfoRows = (['Intake Form — Illegible', 'Intake Form — Missing Fields', 'Clinicals Missing', 'Provider Info Missing'] as const)
        .map((category) => [category, missingInfoCs.filter((c) => missingInfoCategoryOf(c) === category).length, pct(missingInfoCs.filter((c) => missingInfoCategoryOf(c) === category).length, missingInfoCs.length)])
        .filter((r) => (r[1] as number) > 0);

      const missingFieldRows = liveMissingFields(ctx.lob, ctx.days).sort((a, b) => b.pct - a.pct);

      const reviewTypeRows = (['Pre-Auth', 'Concurrent Review', 'Retro'] as const).map((type) => {
        const count = pend.filter((c) => reviewTypeOf(c) === type).length;
        return [type, count, pct(count, pend.length)];
      });

      const providerIssueRows = [
        ['Incomplete', pend.filter((c) => providerIssueOf(c) === 'Incomplete').length],
        ['Out of Network', pend.filter((c) => providerIssueOf(c) === 'Out of Network').length],
      ];

      const intakeCs = pend.filter((c) => c.tags.includes('intake'));
      const processingRows = (['Completed', 'Failed', 'No Shell Created'] as const).map((status) => [status, intakeCs.filter((c) => intakeProcessingStatusOf(c) === status).length]);

      return [
        { title: 'Headline Rates', columns: ['Metric', '% of Scope'],
          rows: [['Complete Submissions', `${pct(complete, pendTotal)}%`], ['Auto-Approved', `${pct(auto, deciTotal)}%`], ['Needing RFI (Intake)', `${pct(rfiIntake, pendTotal)}%`]] },
        { title: 'Intake Channel Mix', columns: ['Channel', 'Count', '% of Pending'], rows: channelMix },
        { title: 'Routing Status', columns: ['Routing', 'Standard', 'Expedited', 'Total'], rows: routingRows },
        { title: 'Duplicates', columns: ['Metric', 'Value'], rows: [['Resolved', dupResolved], ['Unresolved', dupCs.length - dupResolved]] },
        { title: 'TAT & Assignment Risk', columns: ['Metric', 'Value'], rows: [['Approaching TAT', approachingTat], ['Unassigned', unassigned]] },
        { title: 'Missing Information', columns: ['Category', 'Count', '% of Incomplete'], rows: missingInfoRows },
        { title: 'Top Missing Fields', columns: ['Field', 'Missing Count', '% of Submissions'], rows: missingFieldRows.map((f) => [f.field, f.count, f.pct]) },
        { title: 'Auth Type (Review Timing)', columns: ['Type', 'Count', '% of Pending'], rows: reviewTypeRows },
        { title: 'Provider Issues', columns: ['Metric', 'Value'], rows: providerIssueRows },
        { title: 'Intake Auto-Processing', columns: ['Status', 'Count'], rows: processingRows },
      ];
    },
  },
  {
    id: 'um-provider', module: 'um', group: 'Provider & Network', title: 'Provider & Network Insights',
    description: 'Full provider performance detail vs. peer average, with outlier flags, VIP/Gold Card designation, and a needs-attention summary.',
    dimension: { label: 'Provider', options: [ALL, ...PROVIDERS] },
    dimension2: { label: 'Designation', options: [ALL, 'Needs Attention Only', 'VIP', 'Gold Card'] },
    tables: (ctx) => {
      const all = liveProviderInsights(ctx.lob, ctx.days);
      const rows = all.filter((r) => !ctx.dimension || ctx.dimension === ALL || r.provider === ctx.dimension)
        .filter((r) => !ctx.dimension2 || ctx.dimension2 === ALL
          || (ctx.dimension2 === 'Needs Attention Only' && r.needsAttention)
          || (ctx.dimension2 === 'VIP' && r.vip)
          || (ctx.dimension2 === 'Gold Card' && r.goldCard));
      const flagCounts: [string, string][] = [
        ['oon', 'Out of Network'], ['missingClinicals', 'Missing Clinicals'], ['networkDiscrepancy', 'Network Discrepancy'],
        ['highIncomplete', 'High Incomplete Rate'], ['highDenialPartial', 'High Denial/Partial Rate'],
        ['unusualUtilization', 'Unusual Utilization'], ['tatDelay', 'TAT Delay'],
      ];
      const summaryRows = flagCounts.map(([flag, label]) => [label, all.filter((r) => (r.flags as string[]).includes(flag)).length]);
      return [
        {
          title: 'Provider Detail',
          columns: ['Provider', 'Specialty', 'Network Status', 'Total Requests', 'OON', 'Approval %', 'Denial %', 'Incomplete %', 'Expedited %', 'Avg Response (d)', 'VIP', 'Gold Card', 'Needs Attention', 'Primary Insight'],
          rows: rows.map((r) => [r.provider, r.specialty, r.networkStatus, r.totalRequests, r.oonRequests, r.approvalRate, r.denialRate, r.incompleteRate, r.expeditedRate, r.avgResponseDays, r.vip ? 'Yes' : '—', r.goldCard ? 'Yes' : '—', r.needsAttention ? 'Yes' : 'No', r.primaryInsight]),
        },
        { title: 'Needs-Attention Summary', columns: ['Outlier Flag', 'Provider Count'], rows: summaryRows },
      ];
    },
  },
  {
    id: 'um-irr', module: 'um', group: 'Audit & Compliance', title: 'IRR Agreement by Reviewer',
    description: 'Every sampled reviewer\'s agreement rate and sample adequacy, full list.',
    tables: (ctx) => {
      const rows = liveIrrByReviewer(ctx.lob, ctx.days);
      return [{ title: 'IRR Agreement by Reviewer', columns: ['Reviewer', 'Agreements', 'Sampled', 'Agreement %', 'Adequate Sample', `Below ${IRR_TARGET_PCT}%`],
        rows: rows.map((r) => [r.reviewer, r.agree, r.sampled, r.pct, r.adequate ? 'Yes' : 'No', r.adequate && r.pct < IRR_TARGET_PCT ? 'Yes' : 'No']) }];
    },
  },
  {
    id: 'um-irr-actions', module: 'um', group: 'Audit & Compliance', title: 'IRR Corrective Actions',
    description: 'Every corrective action opened from an IRR disagreement, with reason and status.',
    dimension: { label: 'Status', options: [ALL, 'Open', 'Closed'] },
    tables: (ctx) => {
      const rows = liveIrrCorrectiveActions(ctx.lob, ctx.days).filter((a) => !ctx.dimension || ctx.dimension === ALL || a.correctiveActionStatus === ctx.dimension);
      return [{ title: 'IRR Corrective Actions', columns: ['Reviewer', 'Auth', 'Discrepancy Reason', 'Corrective Action', 'Status', 'Action Date'],
        rows: rows.map((a) => [a.reviewer, a.authId, a.discrepancyReason ?? '—', a.correctiveAction, a.correctiveActionStatus ?? '—', a.correctiveActionDate ?? '—']) }];
    },
  },
  {
    id: 'um-reg-tat', module: 'um', group: 'Audit & Compliance', title: 'Regulatory TAT Compliance by Program',
    description: 'Every program\'s compliance rate against its own statutory decision window.',
    tables: (ctx) => [{ title: 'Regulatory TAT Compliance by Program', columns: ['Program', 'Compliant', 'Total', 'Compliance %', 'Standard Window', 'Expedited Window', 'Citation'],
      rows: liveRegCompliance(ctx.days).map((r) => [r.lob, r.compliant, r.total, r.pct, `${r.standardDays}d`, `${r.expeditedHours}h`, r.citation]) }],
  },
  {
    id: 'um-internal-quality', module: 'um', group: 'Clinical & Utilization', title: 'Internal Quality',
    description: 'Documentation completeness, guideline adherence, and decision-rationale documentation rates.',
    tables: (ctx) => [{ title: 'Internal Quality', columns: ['Metric', '%'], rows: liveComplianceBars(ctx.lob, ctx.days).map((b) => [b.label, b.pct]) }],
  },
  {
    id: 'um-audit-flags', module: 'um', group: 'Audit & Compliance', title: 'Audit Flags',
    description: 'Every open audit flag — missing rationale, guideline deviation, documentation, and TAT compliance events.',
    dimension: { label: 'Severity', options: [ALL, 'High', 'Medium', 'Low'] },
    tables: (ctx) => {
      const rows = ctx.data.auditFlags().filter((f) => !ctx.dimension || ctx.dimension === ALL || f.severityLabel === ctx.dimension);
      return [{ title: 'Audit Flags', columns: ['ID', 'Type', 'Description', 'Date', 'Severity'],
        rows: rows.map((f) => [f.id, f.type, f.description, f.date, f.severityLabel]) }];
    },
  },
  {
    id: 'um-irr-discrepancy-reasons', module: 'um', group: 'Audit & Compliance', title: 'IRR Discrepancy Reasons',
    description: 'Every IRR disagreement, grouped by root-cause reason.',
    tables: (ctx) => [{ title: 'IRR Discrepancy Reasons', columns: ['Reason', 'Count'], rows: liveIrrDiscrepancyReasons(ctx.lob, ctx.days).map((r) => [r.reason, r.count]) }],
  },
];

export const CM_REPORTS: ReportDef[] = [];
export const APPEALS_REPORTS: ReportDef[] = [];

// ---- Generic (cross-module) reports — not scoped to a single business module, so these are
// always visible regardless of role. Starts with UM's activity log since UM is the only module
// with reports built out so far; once CM/Appeals reports exist, this should merge all three
// modules' history logs into one real cross-module feed instead of just UM's. ----
export const GENERIC_REPORTS: ReportDef[] = [
  {
    id: 'generic-user-activity', module: 'generic', group: 'General', title: 'User Activity Report',
    description: 'Every reassignment, balance, escalation, and PTO-driven move logged this session (UM only, for now — CM/Appeals activity joins once those reports are built).',
    noLobDays: true,
    tables: (ctx) => [{ title: 'User Activity', columns: ['Time', 'Action', 'Detail', 'By'],
      rows: ctx.data.history().map((h) => [h.time, h.action, h.detail, h.actor]) }],
  },
];
