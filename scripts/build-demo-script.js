const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, ShadingType, BorderStyle, AlignmentType, PageBreak, TableOfContents,
  VerticalAlign, convertInchesToTwip,
} = require('docx');

// ---------- palette ----------
const NAVY = '1F4E79';
const BLUE = '2E74B5';
const GREEN_FILL = 'C6E0B4';
const GREEN_TEXT = '375623';
const AMBER_FILL = 'FFE699';
const AMBER_TEXT = '7F6000';
const RED_FILL = 'F8CBAD';
const RED_TEXT = '833C0C';
const GRAY_TEXT = '595959';
const HEADER_FILL = '1F4E79';

// ---------- helpers ----------
function H1(text) {
  return new Paragraph({
    text, heading: HeadingLevel.HEADING_1,
    spacing: { before: 480, after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: NAVY, space: 4 } },
  });
}
function H2(text) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 360, after: 160 } });
}
function H3(text) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_3, spacing: { before: 220, after: 100 } });
}

// Runs can be a plain string, or an array of {text, bold, italic, color}
function runsFrom(content) {
  if (typeof content === 'string') return [new TextRun({ text: content })];
  return content.map((r) => new TextRun({ text: r.text, bold: !!r.bold, italics: !!r.italic, color: r.color }));
}
function P(content, opts = {}) {
  return new Paragraph({ children: runsFrom(content), spacing: { after: 140, ...opts.spacing }, alignment: opts.alignment });
}
function Bullet(content) {
  return new Paragraph({ children: runsFrom(content), bullet: { level: 0 }, spacing: { after: 80 } });
}

// A spoken-style presenter cue, set off in italics with a bold "SAY:" tag
function Say(text) {
  return new Paragraph({
    children: [
      new TextRun({ text: 'SAY: ', bold: true, color: BLUE }),
      new TextRun({ text, italics: true, color: '404040' }),
    ],
    spacing: { after: 200 },
    indent: { left: convertInchesToTwip(0.15) },
  });
}

// Status badge / callout paragraph. tone: 'live' | 'note' | 'static'
function Status(label, tone) {
  const fill = tone === 'static' ? RED_FILL : tone === 'note' ? AMBER_FILL : GREEN_FILL;
  const color = tone === 'static' ? RED_TEXT : tone === 'note' ? AMBER_TEXT : GREEN_TEXT;
  const tag = tone === 'static' ? 'STATIC / PLACEHOLDER — ' : tone === 'note' ? 'PRESENTER NOTE — ' : 'LIVE — ';
  return new Paragraph({
    shading: { type: ShadingType.CLEAR, color: 'auto', fill },
    children: [new TextRun({ text: tag, bold: true, color }), new TextRun({ text: label, color })],
    spacing: { before: 80, after: 200 },
    indent: { left: convertInchesToTwip(0.05), right: convertInchesToTwip(0.05) },
  });
}

function cellText(text, opts = {}) {
  return new TableCell({
    width: { size: opts.width || 2000, type: WidthType.DXA },
    shading: opts.header ? { type: ShadingType.CLEAR, color: 'auto', fill: HEADER_FILL } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({
      children: [new TextRun({ text, bold: !!opts.header, color: opts.header ? 'FFFFFF' : undefined })],
      spacing: { after: 0 },
    })],
  });
}

// rows: array of arrays of strings. widths: array of DXA widths (sum ~9000 for a full-width table)
function DataTable(headers, rows, widths) {
  const total = widths.reduce((a, b) => a + b, 0);
  return new Table({
    width: { size: total, type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((h, i) => cellText(h, { header: true, width: widths[i] })),
      }),
      ...rows.map((r) => new TableRow({ children: r.map((c, i) => cellText(String(c), { width: widths[i] })) })),
    ],
  });
}

function Spacer(h = 100) {
  return new Paragraph({ text: '', spacing: { after: h } });
}
function PageBreakPara() {
  return new Paragraph({ children: [new PageBreak()] });
}

// ============================================================================
// CONTENT
// ============================================================================
const children = [];

// ---------------- Cover page ----------------
children.push(
  new Paragraph({ text: '', spacing: { before: 2400 } }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Zyter/NextGen', size: 32, color: GRAY_TEXT })],
    spacing: { after: 200 },
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'UM & CM Supervisor Dashboard', bold: true, size: 56, color: NAVY })],
    spacing: { after: 100 },
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Demo Script', bold: true, size: 56, color: NAVY })],
    spacing: { after: 400 },
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Field & Calculation Reference for Live Presentation', size: 28, italics: true, color: GRAY_TEXT })],
    spacing: { after: 800 },
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Prepared for a knowledgeable audience — every figure on screen is labeled LIVE, LIVE ROLLUP*, or STATIC so nothing is presented as more real than it is.', size: 22, color: GRAY_TEXT })],
    spacing: { after: 1200 },
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Demo reference date: Friday, July 17, 2026', size: 22, color: GRAY_TEXT })],
  }),
  PageBreakPara(),
);

// ---------------- Table of contents ----------------
children.push(
  H1('Contents'),
  new TableOfContents('Table of Contents', { hyperlink: true, headingStyleRange: '1-2' }),
  P(['', { text: 'Right-click the contents above and choose “Update Field” (or press F9) after opening this document in Word, so the page numbers populate.', italic: true, color: GRAY_TEXT }]),
  PageBreakPara(),
);

// ================================================================
// PART 1 — CM
// ================================================================
children.push(H1('Part 1 — CM Supervisor Dashboard'));
children.push(Say('This is the Care Management Supervisor Dashboard — it\'s where a CM supervisor manages caseload, referral intake, care plans, and team performance in one place. I\'ll walk each tab in the order they appear, and I\'ll call out clearly anywhere a number is still a placeholder rather than a live calculation.'));
children.push(P('Scope note: Appeals shares the same Scheduling & Adherence / Demand & Forecasting design used here and in UM — a matching script section can be produced for it on request.'));

children.push(H2('Shared Controls'));
children.push(P('Two controls apply across (almost) every tab:'));
children.push(DataTable(
  ['Control', 'Effect'],
  [
    ['LOB filter (All / Medicaid / Medicare Advantage / Commercial PPO / ACA Exchange)', 'Narrows the active caseload and every steady-state panel (queues, workload, case type, consent, assessments, outreach, care plans, scheduling) to members in that line of business. Does not narrow the referral funnel or Demand & Forecasting — those use Lookback instead.'],
    ['Lookback (Today / 7 days / 30 days / QTD)', 'Narrows the referral funnel (received-date window) and any metric explicitly labeled with the lookback period (e.g. "Due for Review (30 days)", "Closure Rate (30 days)"). Does not narrow the active caseload — a mature member\'s enrollment date can be months old by design.'],
  ],
  [4500, 5000],
));
children.push(Spacer());

children.push(H2('Top KPI Strip'));
children.push(Say('Before we go tab by tab, this strip up top is always visible — it\'s the at-a-glance pulse of the whole caseload.'));
children.push(P(['Scoped by the LOB filter; ', { text: '"New Referrals"', bold: true }, ' is also scoped by Lookback.']));
children.push(DataTable(
  ['KPI', 'Formula'],
  [
    ['High-Risk Members', 'Count of caseload members flagged highRisk (Risk Level = High or Critical at generation).'],
    ['High-Acuity', 'Count flagged highAcuity (Acuity = High).'],
    ['High-Cost (>$100k)', 'Count flagged highCost (annualized cost estimate ≥ $100,000).'],
    ['SLA At-Risk', 'Count flagged slaAtRisk (past their next SLA milestone).'],
    ['Active Care Plans', 'Count of caseload members whose care plan status = Open.'],
    ['New Referrals', 'Count of referrals received within the selected Lookback window (any status).'],
    ['Members Managed', 'Total caseload size (all members in the current LOB scope).'],
    ['Intake SLA', '(Members Managed − SLA At-Risk) ÷ Members Managed, as a % — the inverse of the SLA-At-Risk rate.'],
  ],
  [2500, 7000],
));
children.push(Spacer());

// --- Tab: Workforce & Caseload
children.push(H2('Tab: Workforce & Caseload'));
children.push(Status('computed from the active caseload.', 'live'));
children.push(Say('This tab answers "who\'s carrying what, right now." Let\'s start with the queues.'));
children.push(H3('Queues (6 cards: New Referral, Outreach, Reassessment, Escalation, Discharge Follow-Up, Documentation)'));
children.push(Bullet('Count = members currently sitting in that operational queue (a member has at most one queue at a time, or none if nothing\'s actionable right now).'));
children.push(Bullet('Age bands (0–24h / 24–48h / >48h / Breach), shown as a % split within the card: Breach = flagged as past its SLA while queued; 0–24h = queue age < 24 hours; 24–48h = 24–48 hours; >48h = ≥ 48 hours (and not breached).'));
children.push(H3('Cases by Case Type'));
children.push(P('Count of members by their intake wizard\'s Case Type field (Care Coordination / Case Management / Disability / Disease Management), optionally filtered to one team.'));
children.push(H3('Workload — by Care Manager / by Team'));
children.push(DataTable(
  ['Column', 'Formula'],
  [
    ['Active', 'Count of members currently assigned to this care manager (or summed across the team).'],
    ['High Risk / High Acuity / High Cost / SLA At-Risk', 'Same flags as the KPI strip, counted within this care manager\'s (or team\'s) caseload.'],
    ['Utilization %', 'Active ÷ 40 (capacity per care manager), capped at 100%. Team utilization is the average of its members\' utilization %, not a re-derived team-level ratio.'],
  ],
  [3200, 6300],
));
children.push(H3('How Members Were Assigned'));
children.push(P('Count of members by how their current care manager came to own them — independent of whether they have a queue item right now:'));
children.push(Bullet('Queue Draw — pulled from the shared unclaimed pool.'));
children.push(Bullet('Direct — Smart — placed by the system\'s proficiency-matching rule (see Automated Routing under Intake & Referral).'));
children.push(Bullet('Direct — Manual — hand-assigned by a supervisor or intake coordinator.'));
children.push(Spacer());

// --- Tab: Scheduling & Adherence (CM)
children.push(H2('Tab: Scheduling & Adherence'));
children.push(Status('live calculation, over illustrative shift/attendance data. The underlying weekly shift patterns and clock-in/out records are generated for this demo (no live HRIS/timeclock integration behind it), but every rate, count, and rollup shown is a real aggregation of that data — the same math a production integration would run.', 'note'));
children.push(Say('This is the team\'s scheduling and attendance picture. Toggle Period and Team here as we look at it.'));
children.push(P('Period toggle (Daily / Weekly / Rolling 4 Weeks / Monthly) changes the underlying window every metric is computed over. "Monthly" is a rolling ~5-week window, not a calendar-month cut. Team filter narrows everything to one of the three CM teams.'));
children.push(DataTable(
  ['Tile', 'Formula'],
  [
    ['Adherence Rate', 'On-Time shifts ÷ Total scheduled shifts in the selected period/team. Off and PTO days don\'t count.'],
    ['Exceptions', 'Count of scheduled shifts in the period that were not On Time (Late Start, Early Leave, Overtime, or Absence).'],
    ['Care Managers Scheduled', 'Count of care managers with a shift schedule in scope (team-filtered headcount).'],
    ['PTO Days', 'Count of PTO-type shift-days in the period/team.'],
    ['Upcoming PTO', 'Count of PTO days scheduled in the next 3 weeks from today (forward-looking, independent of the period toggle).'],
  ],
  [2600, 6900],
));
children.push(P('Adherence Breakdown (donut): every scheduled shift in the period, split into On Time / Late Start / Early Leave / Overtime / Absence. Clicking a segment drills into that exact population.'));
children.push(P('Adherence & PTO by Care Manager (table): per-person adherence rate (same formula as the tile) alongside PTO Accrued (YTD, prorated by day-of-year against a 20-day annual grant), PTO Used, and PTO Remaining. Row color thresholds: Adherence Rate red <70%, amber 70–89%, green ≥90%; PTO Remaining red ≤2 days, amber 3–5 days, green >5 days.'));
children.push(Spacer());

// --- Tab: Demand & Forecasting (CM)
children.push(H2('Tab: Demand & Forecasting'));
children.push(Status('bucketed from each referral\'s actual received date (real data, not fabricated) — the only fabricated part is the demo\'s underlying referral dataset itself, same as every other tab.', 'live'));
children.push(Say('This tells us whether intake capacity keeps pace with what\'s coming in.'));
children.push(P('Team filter: a referral has no team of its own before it\'s accepted, so it\'s attributed to the team whose discipline its clinical reason maps to (the same rule "Direct — Smart" routing uses).'));
children.push(DataTable(
  ['Tile', 'Formula'],
  [
    ['Referrals This Week (to date)', 'Count of referrals received since the Monday of the current week — a partial week, since today sits mid-week.'],
    ['Projected Next Week', 'Average of the 4 most recently completed weeks (current partial week excluded). Deliberately a simple trailing average, not a statistical forecasting model.'],
    ['Team Intake Capacity (All Teams)', 'Intake Coordinators (5) × nominal capacity (15 referrals each) = 75.'],
    ['Caseload Headroom (one team selected)', '(Care managers on that team × 40 capacity) − that team\'s current active caseload — how many more active cases the team could take on right now.'],
    ['Coverage Outlook', '"At Risk" if Projected Next Week > the capacity figure above; "Adequate" otherwise.'],
  ],
  [2800, 6700],
));
children.push(P('The 8-week trend chart plots real weekly volume; clicking any tile drills into the underlying referrals, the forecast\'s 4-week basis, or the capacity roster behind the number.'));
children.push(Spacer());

// --- Tab: Intake & Referral (CM)
children.push(H2('Tab: Intake & Referral'));
children.push(Status('live calculation.', 'live'));
children.push(Say('This is the full referral funnel, from first contact through acceptance.'));
children.push(H3('Lifecycle Stage cards (Newly Accepted → Assessment Scheduled → Care Plan Development → Active Monitoring → Care Plan Review Due)'));
children.push(Bullet('Count = members currently in that stage.'));
children.push(Bullet('On Track / Due Soon / Overdue split: Overdue = flagged at risk of missing its SLA milestone; Due Soon = SLA milestone due within 3 days (live date check); On Track = everything else.'));
children.push(H3('Referrals section'));
children.push(Bullet('View Referrals (N) — opens the full referral list, filterable by Care Manager and scoped by LOB/Lookback.'));
children.push(Bullet('New Referrals (N) — count of currently-Pending referrals within the Lookback window.'));
children.push(Bullet('Assign Referral — hands a Pending referral to an Intake Coordinator (completeness work) or a Care Manager who does their own intake; this is not the clinical accept/decline decision.'));
children.push(Bullet('Intake Coordinator Workload — count of Pending referrals currently sitting with each coordinator (+ "Unclaimed"), optionally filtered to one intake channel/modality.'));
children.push(Bullet('By Source — referral count by intake channel (Fax / Provider Portal / Call / UM Referral), over the Lookback window.'));
children.push(Bullet('Accepted by Care Manager — count of Accepted referrals currently routed to each care manager; bar width = that count ÷ total accepted.'));
children.push(Bullet('By Status — count by Pending / Accepted / CM Declined / Member Declined, over the Lookback window.'));
children.push(Bullet('Pending — Blocked By — of currently-Pending referrals, how many are blocked by "Pending Intake", "Missing Information", or "Missing Eligibility".'));
children.push(Bullet('Referral TAT — Pending referrals banded by age-since-received against a 3-day intake window: On Track / Due Soon (2 days old) / Overdue (≥3 days old).'));
children.push(Bullet('By Referral Reason — count by the clinical/programmatic reason for referral (6 categories); bar width = count ÷ total.'));
children.push(Bullet('Automated routing ("Direct — Smart") — a referral\'s clinical reason maps to a target CM discipline, and the system suggests the least-utilized care manager in that discipline. This is a suggestion a supervisor confirms, not an automatic silent assignment.'));
children.push(H3('Consent / Assessments / Outreach'));
children.push(DataTable(
  ['Panel', 'Formula'],
  [
    ['Consent (by type)', 'Count on file per consent type; "At Risk of Expiring" = expires within 30 days (or already past).'],
    ['Assessments (by type)', 'Count per assessment type; "TAT Adherent" = completed within 5 days of assignment.'],
    ['Outreach Success Rate', 'Members reached ≤3 attempts ÷ Total members.'],
    ['Avg Attempts per Member', 'Mean outreach attempts across the caseload.'],
    ['UTR Letters Sent', 'Count of members with an "Unable to Reach" letter on file (sent after repeated failed outreach).'],
  ],
  [2800, 6700],
));
children.push(Spacer());

// --- Tab: Care Plan & Outcomes (CM)
children.push(H2('Tab: Care Plan & Outcomes'));
children.push(Status('computed per the original 11-metric spec.', 'live'));
children.push(Say('This is the clinical-outcomes view of the caseload — how care plans are progressing, not just how many exist.'));
children.push(DataTable(
  ['Metric', 'Formula'],
  [
    ['Active Care Plans', 'Count of Open care plans.'],
    ['Due for Review (30 days)', 'Open plans whose review date falls within the Lookback window (0 to N days out).'],
    ['Overdue Review', 'Open plans whose review date has already passed.'],
    ['Without Goals', 'Open plans with zero documented goals.'],
    ['Without Interventions', 'Open plans with at least one goal whose intervention status = "None".'],
    ['Intervention Completion', 'Completed interventions ÷ interventions "due" (due = every goal whose intervention status isn\'t "None").'],
    ['Closure Rate (30 days)', 'Plans closed within the Lookback window ÷ total plan population (open + closed).'],
    ['Avg. Plan Duration', 'Mean days from opened to closed, over plans that have actually closed.'],
    ['Member Participation', 'Plans with documented member agreement/participation ÷ total plan population.'],
    ['Reopened Care Plans', 'Count (and %) of plans reopened at least once after a prior closure.'],
    ['SMART Language Usage', 'Plans whose goal/intervention language meets SMART criteria ÷ total plan population.'],
    ['Goal Progress (donut)', 'Every goal across open plans, split Not Started / In Progress / At Risk / Achieved.'],
    ['Care Plan Template (donut)', 'Count of plans built from each of 5 templates (4 condition-specific + "Custom / Other").'],
  ],
  [3200, 6300],
));
children.push(Spacer());

// --- CM static tabs
const cmStaticTabs = [
  ['Risk & Escalation', 'The four summary tiles (High-Risk Members: 23, High-Acuity: 14, High-Cost: 9, Escalated Today: 4) and the High-Priority Member Worklist table are all a fixed 6-row list, not derived from the live caseload.'],
  ['Program Management', 'Program Enrollment bars and the Program Outcomes table (enrolled/attainment/readmit reduction) are a fixed 4-program list.'],
  ['Documentation', 'HRA Completion (88%), SDOH Screening (76%), Care Plan Documented (94%), and the Overdue Assessments table are fixed values.'],
  ['Financial / Cost', 'Cost Avoided (MTD), High-Cost Exposure, and PMPM figures are fixed; Highest-Cost Members reuses the same static worklist as Risk & Escalation.'],
  ['Audit & Compliance', 'Care Plan Timeliness (92%), Assessment Compliance (85%), Consent on File (97%), and the Audit Flags table are a fixed 3-item list.'],
];
children.push(H2('Illustrative Placeholder Tabs'));
children.push(Status('the five tabs below currently show fixed demo values — useful for showing the intended layout, but none of the numbers recompute from the underlying case data yet. If asked, say so plainly rather than describing them as calculated.', 'static'));
children.push(Say('These next five are laid out the same way as the tabs we just walked, but I want to be upfront: they\'re showing fixed illustrative numbers today, not a live calculation. Here\'s what\'s in each.'));
cmStaticTabs.forEach(([tab, note]) => {
  children.push(H2(tab));
  children.push(Status('fixed demo values — not derived from the live caseload.', 'static'));
  children.push(P(note));
});
children.push(P('If any of these matter for the presentation, they\'re the natural next candidates to wire up to real formulas.'));
children.push(PageBreakPara());

// ================================================================
// PART 2 — UM
// ================================================================
children.push(H1('Part 2 — UM Supervisor Dashboard'));
children.push(Say('Now let\'s switch to the Utilization Management dashboard. Same idea — twelve tabs covering the full UM workflow from intake through audit. I dug deeper into this module\'s source, so I can be very specific about what\'s real versus illustrative here.'));
children.push(P('Every field below is tagged with how real it is:'));
children.push(DataTable(
  ['Tag', 'Meaning'],
  [
    ['LIVE', 'Computed in real time from the authorization pool\'s genuine, distinguishing attributes (decision, dollar amount, provider, submitted date, and tags like breached/atRisk/oon/expedited/concurrent). Reacts correctly to every filter.'],
    ['LIVE ROLLUP*', 'The aggregation, percentage, and filter-reactivity are all real — but the underlying per-case attribute being counted (which of 5 intake channels a case arrived through, etc.) is assigned by a deterministic formula keyed off the authorization ID rather than a genuinely distinct captured field. Marked with * throughout.'],
    ['STATIC', 'A fixed placeholder value or dataset, not derived from the authorization pool at all.'],
  ],
  [2200, 7300],
));
children.push(P('This distinction matters for a knowledgeable audience: LIVE numbers would survive a real data connection unchanged in logic; LIVE ROLLUP* numbers show the right shape of a real feature but would need the placeholder field swapped for a genuine source; STATIC sections are pure mockup.'));
children.push(P('All date examples reflect the demo\'s fixed "today" of Friday, July 17, 2026.'));

children.push(H2('Shared Controls'));
children.push(DataTable(
  ['Control', 'Effect'],
  [
    ['LOB filter (All / Medicaid / Medicare Advantage / Commercial PPO / ACA Exchange)', 'Narrows almost every tab\'s panels to that line of business. A case\'s LOB isn\'t a stored field — it\'s derived via a hash of the authorization ID (a LIVE ROLLUP* input used everywhere LOB appears).'],
    ['Lookback (Today / 7 days / 30 days / QTD, default 30 days)', 'Narrows every "in scope" calculation to cases submitted within that window.'],
  ],
  [4200, 5300],
));
children.push(Status('the top KPI strip only recomputes live when the Lookback period is changed away from its default (30 days) — changing the LOB filter alone, while Lookback stays at its default, does not re-filter the KPI strip. Every other tab already respects the LOB filter as soon as it\'s touched; the top strip is the one exception. Good to know before a live filter demo.', 'note'));

children.push(H2('Top KPI Strip'));
children.push(DataTable(
  ['KPI', 'Formula', 'Static baseline at rest'],
  [
    ['Pending Authorizations', 'Count of pending-phase cases (in the Lookback window, once one is applied)', '247'],
    ['TAT Compliance', 'On Track decided cases ÷ Total decided cases, %', '94.2%'],
    ['Auto-Approval Rate', 'Auto-approved decided cases ÷ Total decided cases, %', '38%'],
    ['At Risk', 'Count of pending cases tagged "at risk of breaching TAT"', '12'],
    ['AHT (Average Handle Time)', 'Mean tatH across decided cases, shown as hours', '2.4h'],
    ['Unassigned', 'Count of pending cases with no nurse owner', '39'],
    ['Breached TAT', 'Count of pending cases already past their TAT deadline', '3'],
    ['Team Utilization', 'Average of the per-nurse utilization values (several are themselves fixed baselines)', '87%'],
  ],
  [2600, 5000, 1900],
));
children.push(Spacer());

// --- Tab: Workforce & Queue Management
children.push(H2('Tab: Workforce & Queue Management'));
children.push(Status('with a few named static exceptions below.', 'live'));
children.push(Say('This is the nurse-level operational view — queues, workload, and how work got assigned.'));
children.push(H3('Queue cards (7 queues: Intake, Clinical Review, MD Review, RFI Pending, OON Review, Concurrent Review, Pending P2P)'));
children.push(Bullet('Count = unclaimed pending cases in that queue (nurse = "—"), scoped by LOB/Lookback.'));
children.push(Bullet('Age bands (0–24h / 24–48h / >48h / Breach): Breach = tagged as past TAT. The other three bands come from a deterministic "hours since submitted" stand-in (LIVE ROLLUP*), not a real elapsed-time clock.'));
children.push(Bullet('Split by LOB toggle re-slices each queue card into per-LOB counts.'));
children.push(H3('Workload table — by Nurse'));
children.push(DataTable(
  ['Column', 'Formula'],
  [
    ['Active Authorizations', 'Pending cases owned by this nurse, in scope.'],
    ['Pending', 'Of Active, the subset waiting on an external response (tagged RFI or P2P).'],
    ['Completed (labeled "MTD")', 'Decided cases owned by this nurse, in scope — bounded by the shared Lookback window (30 days by default), not an actual calendar-month cutoff despite the label.'],
    ['Avg TAT', 'Mean tatH of this nurse\'s completed cases.'],
    ['Utilization', 'Static baseline per nurse (92% / 96% / 85% / 72% / 88% / 80%, plus 55% for Rachel Foster) — does not recompute from LOB/Lookback scope. Only changes via a supervisor action (Reassign / Balance / Redistribute for PTO).'],
  ],
  [2800, 6700],
));
children.push(Status('Rachel Foster\'s entire row is static — hand-entered, not derived from the case pool (she isn\'t part of the underlying nurse roster the generator assigns work from).', 'static'));
children.push(H3('Workload table — by Team'));
children.push(P('Simple sums/averages of the member nurses\' own numbers (Avg TAT is an average-of-averages, not re-derived from raw case data).'));
children.push(H3('Actions'));
children.push(Bullet('Reassign — moves a case\'s queue or owner; recalculates the receiving/losing nurse\'s utilization proportionally.'));
children.push(Bullet('Balance — moves one case at a time from the highest- to the lowest-utilization nurse.'));
children.push(Bullet('Escalate — pulls candidates from the same static seed list used by the Risk & Escalation tab — not a live risk calculation.'));
children.push(Bullet('Redistribute for PTO — greedily reassigns a departing nurse\'s cases one at a time, each time to whichever remaining nurse currently has the lowest utilization.'));
children.push(Spacer());

// --- Tab: Scheduling & Adherence (UM)
children.push(H2('Tab: Scheduling & Adherence'));
children.push(Status('over a deterministic, seeded shift/attendance dataset — same honesty note as CM\'s version of this tab: there\'s no real HRIS/timeclock behind it, but every rate/count shown is a genuine aggregation of the generated data.', 'note'));
children.push(Say('Same design as CM\'s Scheduling tab, adapted to the UM nurse roster — 7 nurses across 3 teams.'));
children.push(DataTable(
  ['Tile', 'Formula'],
  [
    ['Adherence Rate', 'On-Time shifts ÷ Total scheduled shifts for the selected Team + Period.'],
    ['Exceptions', 'Count of shifts in period that were not On Time.'],
    ['Nurses Scheduled', 'Static headcount of the 7-person roster filtered by team — does not vary by Period (Daily/Weekly/Rolling4/Monthly all show the same number).'],
    ['PTO Days', 'Sum of PTO shift-days in the period — cumulative across every week in the window for Rolling 4 Weeks/Monthly, not a daily rate.'],
    ['Upcoming PTO (Next 3 Weeks)', 'PTO days across the current week plus the next two (weeks 0–2, so it includes some of "this week") where the date is today or later.'],
  ],
  [2800, 6700],
));
children.push(P('Adherence Breakdown (donut): every scheduled shift-day split On Time / Late Start / Early Leave / Overtime / Absence, from the same generator as CM\'s version (~79% On Time / 7% Late / 6% Early / 4% Overtime / 4% Absence by construction).'));
children.push(P('Adherence & PTO by Nurse (table): per-nurse adherence rate (defaults to 100% rather than "—" if that nurse has zero shifts in the current scope); PTO Accrued (YTD) is a flat, identical value for every nurse prorated by calendar day; PTO Used is a deterministic pseudo-random fraction (10–64%) of accrued days per nurse — neither is drawn from real leave records.'));
children.push(Spacer());

// --- Tab: Demand & Forecasting (UM)
children.push(H2('Tab: Demand & Forecasting'));
children.push(Status('bucketed from each authorization\'s real submitted date (the fabrication is in the underlying case-pool dataset, not in this tab\'s math).', 'live'));
children.push(Say('Same forecasting logic as CM, scaled to the UM nurse roster.'));
children.push(DataTable(
  ['Tile', 'Formula'],
  [
    ['Submissions This Week (to date)', 'Count since Monday of the current (partial) week.'],
    ['Projected Next Week', 'Trailing average of the 4 most recently completed weeks (current partial week excluded).'],
    ['Total Nurse Capacity (All Teams)', '7 nurses × 25 (nominal active-authorization capacity each) = 175.'],
    ['Caseload Headroom (one team selected)', '(nurses on that team × 25) − that team\'s current active caseload.'],
    ['Coverage Outlook', '"At Risk" if Projected Next Week > the capacity figure shown; "Adequate" otherwise.'],
  ],
  [2800, 6700],
));
children.push(Spacer());

// --- Tab: TAT Compliance
children.push(H2('Tab: TAT Compliance'));
children.push(Status('mostly live, with two panels that are explicitly static placeholders (flagged below). Filters: Auth Type (IP/OP/RX), Service Category, plus the shared LOB/Lookback.', 'note'));
children.push(Say('This is the compliance heartbeat of UM — how well we\'re holding to turnaround-time targets.'));
children.push(H3('Headline'));
children.push(Bullet('TAT Compliance (donut) = On Track decided cases ÷ Total decided cases, %.'));
children.push(Bullet('On Track / At Risk / Breached buckets — straight counts of each tag.'));
children.push(Bullet('Expedited / Standard / Paused stat boxes — tag counts (Paused pulls from pending cases only).'));
children.push(Bullet('Avg Turnaround — computed live (mean tatH) only once a filter is applied; in the default, unfiltered view it\'s a static "1.8d" string, not a calculation.'));
children.push(H3('Inpatient Concurrent Review sub-panel (shown when scope includes Inpatient)'));
children.push(P('Reuses the same per-case day-count math as the Concurrent Review Monitoring tab (LOS, expected LOS, certified/requested days) — see that tab below.'));
children.push(H3('TAT Compliance by Line of Business / by Service Category'));
children.push(P('Per group: Compliance % = On Track ÷ Total, sorted by volume. Color bands: teal ≥90%, red <85%.'));
children.push(H3('Notification Compliance panel'));
children.push(Status('"Member" and "provider" notice lateness is not a real date/deadline comparison — it\'s a fixed pattern (literally "every 31st adverse case" and "every 55th decided case," by array position). Avg Time to Notice is a hardcoded 0.7-day constant. The percentages shown react to filters, but the lateness determination itself is not a genuine calculation.', 'static'));
children.push(H3('Regulatory TAT by Urgency panel'));
children.push(P('Displays fixed regulatory-clock labels ("72 hours" for Expedited/Urgent, "14 calendar days" for Standard Pre-Service) alongside the same real On Track/At Risk/Breached tag counts used elsewhere — the clock labels are descriptive text, not independently validated against an hour-based field in this panel.'));
children.push(Spacer());

// --- Tab: Clinical Decision Insights
children.push(H2('Tab: Clinical Decision Insights'));
children.push(Status('with clearly-flagged synthetic sub-fields.', 'live'));
children.push(Say('This tab shows the clinical decision mix — approvals, denials, partials — and where they\'re coming from.'));
children.push(Bullet('Decision Mix (Approved/Denied/Partial %) — live, from each case\'s real decision field.'));
children.push(Bullet('6 headline stats (Approved / Denied / Partial / Auto-Approved / MD Review / P2P Rate, all % of decided cases in scope) — live.'));
children.push(Bullet('Reason Codes by Outcome (toggle Denied/Partial/Approved) — the % breakdown is live, but which specific reason code each case carries is a deterministic hash of the authorization ID (LIVE ROLLUP*), not a clinician\'s actual documented rationale.'));
children.push(Bullet('Decision Drilldown by Service (Approval Rate % / Volume by procedure) — live; the clinical guideline shown per procedure comes from a fixed lookup table (19 procedures).'));
children.push(Bullet('Row-drawer\'s "Denials (est.)" figure is a client-side estimate (Volume × (1 − Approval Rate)), not an actual denial count field.'));
children.push(Bullet('Row-drawer\'s MD reviewer name and criteria-met count are also authorization-ID hashes (LIVE ROLLUP*), not real reviewer/criteria-checklist data.'));
children.push(Spacer());

// --- Tab: Risk & Escalation Panel
children.push(H2('Tab: Risk & Escalation Panel'));
children.push(Status('the tab with the least real calculation behind it in the UM module. The "Authorizations Requiring Attention" table is a fixed, hand-authored 6-row list — not derived from the case pool at all. Risk score, dollar amount, drivers, and tone are pre-set per row, not the output of a scoring formula. If this needs to be a real capability, it\'s the top candidate to wire up next.', 'static'));
children.push(Say('I want to flag this one clearly before we look at it — it\'s the least "live" tab in UM.'));
children.push(DataTable(
  ['Tile', 'Status'],
  [
    ['SLA Breach Risk', 'Live (reads the shared "At Risk"/"Breached" KPI counts)'],
    ['High-Dollar (>$50k)', 'Live — count/exposure of in-scope pending cases costing ≥ $50,000'],
    ['High-Acuity', 'Live filter logic, applied over a static 6-row seed list'],
    ['Escalated Today', 'Live — count of this-session escalation actions from the shared activity log'],
  ],
  [2400, 6700],
));
children.push(P('Escalating a row removes it from the list (so the demo can show the worklist "clearing"), but nothing about which cases are risky is calculated.'));
children.push(Spacer());

// --- Tab: Concurrent Review Monitoring
children.push(H2('Tab: Concurrent Review Monitoring'));
children.push(Status('genuinely derived from the case pool (pending cases tagged "concurrent"), but every day-count field is a deterministic formula keyed off the authorization ID rather than a real admission/certification date.', 'note'));
children.push(Say('This is the inpatient continued-stay review workflow — LOS, certified days, next review due, and next-best-action, all in one table.'));
children.push(P('Per case (all Live rollup*, keyed off a 2-digit hash of the authorization ID): LOS (day of stay) = 3–12 days; Expected LOS = 3–10 days; Total Certified Days, Uncertified Days, Days Remaining, Days Requested all derive from LOS/Expected LOS via fixed rules; Certified Through, Next Review Due, and Expected Discharge are each "today" plus a deterministic day offset.'));
children.push(P('Status / Next Action is a priority chain: Uncertified Days present → "Uncertified Days" (red); else Days Requested > Certified → "Extension Requested" (amber); else Days Remaining ≤ 1 → "Recert Due" (amber); else "Certified" (green).'));
children.push(P('Headline stats (Active Reviews, Uncertified Days, Extension Requested, Recert Due, Certified) are live counts of the above. The Stay Timeline bar is a genuine visualization of the same fields. Balance-selected uses a simplified greedy simulation rather than a true capacity recalculation.'));
children.push(Spacer());

// --- Tab: Intake & Documentation Quality
children.push(H2('Tab: Intake & Documentation Quality'));
children.push(Status('every percentage is a genuine aggregation over the in-scope pending caseload, but most of the categorical fields being counted are authorization-ID hashes rather than real captured attributes. A few classifications are genuine tag-based facts: "Late" routing, "Concurrent Review" auth type, and "Out of Network" provider issues.', 'note'));
children.push(Say('This tab is about submission quality — what\'s missing, what channel it came through, how it got routed.'));
children.push(DataTable(
  ['Panel', 'What it shows'],
  [
    ['Complete Submissions / Auto-Approved / Needing RFI', '% of pending (or decided, for Auto-Approved) cases without the "incomplete doc" tag / with the "auto" tag / with an RFI raised at intake.'],
    ['Intake Channel Mix', '% split across 5 channels (Live rollup*).'],
    ['Routing Status', 'Smart / Manual / Late split, cross-tabbed by Standard/Expedited urgency.'],
    ['Duplicates', 'Unresolved vs. resolved count (both Live rollup*).'],
    ['TAT & Assignment Risk', 'Real counts of at-risk and unassigned pending cases.'],
    ['Missing Information', '% by category, of the incomplete-doc subset (Live rollup*).'],
    ['Top Missing Fields', 'Count and % (of all pending submissions, not just incomplete ones) per specific missing field (Live rollup*).'],
    ['Auth Type (Review Timing)', 'Pre-Auth / Concurrent Review / Retro split.'],
    ['Provider Issues', 'Incomplete vs. Out-of-Network counts.'],
    ['Intake Auto-Processing', 'Completed / Failed / "No Shell Created" outcome split for cases still in the Intake queue.'],
  ],
  [2600, 6900],
));
children.push(Spacer());

// --- Tab: Provider & Network Insights
children.push(H2('Tab: Provider & Network Insights'));
children.push(Status('with one clearly-flagged synthetic input. This is the tab built specifically around peer-relative outlier flagging rather than fixed magic-number thresholds.', 'live'));
children.push(Say('This tab is designed to answer "which providers need our attention" — relative to their peers, not just against an arbitrary bar.'));
children.push(P('Per provider/facility (6 in the demo): Total Requests, OON Requests, Approval/Denial/Partial-Approval Rate, Incomplete Rate, Expedited Rate — all live, from real decision/tag fields. Avg Response Time is a fixed value per provider name (1–4 days, from a name-hash) — a Live rollup* stand-in, since there\'s no real request/response timestamp pair to measure.'));
children.push(H3('Outlier flags (a provider can carry several at once), each compared to the peer average'));
children.push(DataTable(
  ['Flag', 'Trigger'],
  [
    ['OON Exceptions', 'Any OON activity at an In-Network/Delegated provider, or ≥3 OON requests regardless of status.'],
    ['Missing/Late Clinicals', '≥ the greater of 2, or 125% of the peer-average count.'],
    ['Network-Status Exceptions', 'Provider\'s network status is Out-of-Network or Exception.'],
    ['High Incomplete Rate', '≥ the greater of 10%, or 125% of peer average.'],
    ['High Denial/Partial Rate', '≥ the greater of 15%, or 125% of peer average.'],
    ['Unusual Utilization', 'Volume ≥ 140% of peer average, or Expedited Rate ≥ the greater of 15%, or 140% of peer average.'],
    ['Repeated TAT Delays', 'Avg Response Time ≥ the greater of 3 days, or 120% of peer average.'],
  ],
  [2600, 6900],
));
children.push(P('Gold Card designation (fixed, not peer-relative, by design): no flags and Approval Rate ≥ 60% and Total Requests ≥ 20 — modeled on real prior-authorization-exemption ("gold carding") programs, which use a statutory bar rather than a curve.'));
children.push(Spacer());

// --- Tab: Cost & Utilization Insights
children.push(H2('Tab: Cost & Utilization Insights'));
children.push(Status('over the pending (active) caseload, with one flagged synthetic input.', 'live'));
children.push(Say('This is the financial-exposure lens on the active caseload — where the dollars are at risk right now.'));
children.push(P('Per case: Requested Cost (real cost field); Approved Cost is Requested Cost × a modeled approval factor (mostly 85–100%, occasionally 50–65% for ~20% of cases) — a Live rollup* stand-in for a real adjudicated amount, since these cases haven\'t been decided yet. Cost Variance = Requested − Approved.'));
children.push(H3('Flags (a case can carry several)'));
children.push(Bullet('High-Cost (≥ $50,000)'));
children.push(Bullet('Out-of-Network Cost Exposure'));
children.push(Bullet('Uncertified Inpatient Days (reuses Concurrent Review math)'));
children.push(Bullet('Extended-Stay Exposure (actual LOS > expected LOS)'));
children.push(Bullet('High-Cost Drug/Procedure (Pharmacy or DME/Home Health service, ≥ $10,000)'));
children.push(Bullet('Requested-vs-Approved Variance (≥ the greater of $5,000, or 15% of requested cost)'));
children.push(Bullet('Potential Duplicate Service'));
children.push(P('Total Cost Exposure per case = the maximum (not the sum) of whichever applicable amounts apply — a case flagged both High-Cost and Uncertified Days doesn\'t double-count both dollar figures, it takes the larger one. The tile-level Total Cost Exposure (Estimate) sums this per-case figure across all in-scope cases. Avg Requested-vs-Approved Variance % is the mean of each case\'s own variance ratio. Breakdowns by Service Type and Network Status are both computed over the needs-attention subset only.'));
children.push(Spacer());

// --- Tab: Audit & Compliance
children.push(H2('Tab: Audit & Compliance'));
children.push(Status('mixed — one Live rollup* section, one explicitly-modeled section, one real-reference-data section, and one fully static table. Walk this one carefully.', 'note'));
children.push(Say('This tab has the most moving pieces of any UM tab — worth being precise about which part is which.'));
children.push(H3('Internal Quality bars — Live rollup* (documented in source as "proxy metrics")'));
children.push(P('Documentation Completeness (% without the incomplete-doc tag), Guideline Adherence (% of decided cases not tagged "appeal" — a proxy for "was the guideline applied correctly"), Decision Rationale Documented (% of approved cases that weren\'t auto-approved and weren\'t incomplete) — all real aggregations, but explicitly proxy definitions rather than a literal "rationale documented" field.'));
children.push(H3('Inter-Rater Reliability (IRR)'));
children.push(Status('explicitly modeled, not real audit data. Which cases get "sampled" for IRR and whether the sampled reviewer "agreed" are both simulated: ~40% of Denied/Partial decisions and ~10% of others are sampled (weighted toward denials, as a real audit program would do), and agreement is modeled at ~95% for Denied/Partial and ~99% for others.', 'static'));
children.push(P('The IRR Agreement Rate, Reviewers Below 90% Threshold (reviewers with ≥3 sampled cases and <90% agreement), Denial/Partial Sample Coverage, and the by-Reviewer breakdown are all real aggregations of this simulated sample — useful for showing the shape of an IRR program, not yet real audit output.'));
children.push(H3('Regulatory TAT Compliance by Program'));
children.push(P('Per-LOB statutory windows are real reference values (flagged in source as "directional — validate exact citations with Compliance"): Medicaid 14 days / 72h expedited (42 CFR §438.210); Medicare Advantage 14 days / 72h (42 CFR §422.568); Commercial PPO 15 days / 72h (ERISA §2560.503-1); ACA Exchange 15 days / 72h (ACA §2719). Each case\'s own turnaround time (tested against those windows) is a deterministic authorization-ID hash, not a measured decision date — the thresholds are real, the data tested against them is a placeholder.'));
children.push(H3('Audit Flags table'));
children.push(Status('a fixed 4-row list (Missing Rationale, Guideline Deviation, Incomplete Documentation, TAT Compliance) with hand-set severity. Marking one resolved removes it from the list; nothing about which flags exist or their severity is calculated.', 'static'));
children.push(Spacer());

// --- Tab: CM Referrals
children.push(H2('Tab: CM Referrals'));
children.push(Status('this entire tab — the three summary cards (Referred to CM, Pending Intake, Care Plan Active) and the outgoing-referral table — reads a fixed 6-row dataset. The "MTD" label on the first card is descriptive text, not an actual month-to-date filter. SLA labels and their tone are hand-assigned per row, not computed from a date comparison.', 'static'));
children.push(Say('Last UM tab — and it\'s the simplest to describe honestly: everything here is a fixed dataset today.'));
children.push(Spacer());

// --- Notes for a knowledgeable audience
children.push(H2('Notes for a Knowledgeable Audience'));
children.push(Say('If someone in the room asks "is this real data," here\'s how I\'d answer.'));
children.push(Bullet('A recurring pattern worth naming once, up front: dozens of fields across Intake, Provider, Clinical, and Audit are assigned via a deterministic formula keyed off the authorization ID. This is intentional design for the demo — it keeps every number stable across reloads and internally consistent — but it means the field itself is a placeholder for something a real integration would need to supply, even though the math built on top of it is genuine and would carry over unchanged.'));
children.push(Bullet('Unit-label inconsistency worth resolving with engineering before a client-facing claim about turnaround time: the case pool\'s tatH field is rendered as hours in some places and as days in others (e.g. TAT Compliance tab\'s "Avg Turnaround," suffixed "d"). Worth confirming the intended unit before it\'s quoted in a presentation.'));
children.push(Bullet('Two tabs are the best candidates to "go live" next if this demo needs to look more complete: Risk & Escalation Panel (currently a static 6-row worklist) and the Audit Flags table (currently a static 4-row list) — both are small, self-contained, and have an obvious real formula to wire in.'));
children.push(Spacer());

// ---------------- Closing ----------------
children.push(H1('Closing & Next Steps'));
children.push(Say('That covers both modules. A few natural next steps if you want to keep building this out.'));
children.push(Bullet('Appeals shares the same Scheduling & Adherence / Demand & Forecasting design used in both CM and UM (adapted to its own roster — reviewers/roles rather than nurses or care managers). A matching field-and-calculation script section can be produced for Appeals on request.'));
children.push(Bullet('Appeals\' Demand tab is a partial exception worth knowing about: its 8 referenceable appeals are a curated worklist snapshot, not a real per-item history, so its weekly volume is a small deterministic series rather than bucketed real records.'));
children.push(Bullet('The CM and UM tabs flagged STATIC above (Risk & Escalation in both modules, Program Management, Documentation, Financial/Cost, Audit & Compliance in CM, the UM Audit Flags table, and CM Referrals) are the natural backlog for turning this from an illustrative demo into a fully live one.'));

// ---------------- Build document ----------------
const doc = new Document({
  styles: {
    default: {
      document: { run: { font: 'Calibri', size: 22 } },
    },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { bold: true, size: 32, color: NAVY, font: 'Calibri' } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { bold: true, size: 26, color: BLUE, font: 'Calibri' } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { bold: true, size: 22, color: '404040', font: 'Calibri' } },
    ],
  },
  sections: [
    {
      properties: {
        page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 } },
      },
      children,
    },
  ],
});

const outPath = 'C:\\Users\\Christina.Lawson\\Downloads\\zyter_appeals_demo (2)\\um-supervisor\\docs\\Zyter-UM-CM-Demo-Script.docx';
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(outPath, buf);
  console.log('Wrote', outPath, buf.length, 'bytes');
});
