const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, ShadingType, BorderStyle, AlignmentType, PageBreak, VerticalAlign, convertInchesToTwip,
} = require('docx');

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

function H1(text) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 480, after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: NAVY, space: 4 } } });
}
function H2(text) { return new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 360, after: 160 } }); }
function H3(text) { return new Paragraph({ text, heading: HeadingLevel.HEADING_3, spacing: { before: 220, after: 100 } }); }
function runsFrom(content) {
  if (typeof content === 'string') return [new TextRun({ text: content })];
  return content.map((r) => new TextRun({ text: r.text, bold: !!r.bold, italics: !!r.italic, color: r.color }));
}
function P(content, opts = {}) { return new Paragraph({ children: runsFrom(content), spacing: { after: 140, ...opts.spacing } }); }
function Bullet(content) { return new Paragraph({ children: runsFrom(content), bullet: { level: 0 }, spacing: { after: 80 } }); }
function Say(text) {
  return new Paragraph({
    children: [new TextRun({ text: 'SAY: ', bold: true, color: BLUE }), new TextRun({ text, italics: true, color: '404040' })],
    spacing: { after: 200 }, indent: { left: convertInchesToTwip(0.15) },
  });
}
function Status(label, tone) {
  const fill = tone === 'static' ? RED_FILL : tone === 'note' ? AMBER_FILL : GREEN_FILL;
  const color = tone === 'static' ? RED_TEXT : tone === 'note' ? AMBER_TEXT : GREEN_TEXT;
  const tag = tone === 'static' ? 'STATIC / PLACEHOLDER — ' : tone === 'note' ? 'PRESENTER NOTE — ' : 'LIVE — ';
  return new Paragraph({
    shading: { type: ShadingType.CLEAR, color: 'auto', fill },
    children: [new TextRun({ text: tag, bold: true, color }), new TextRun({ text: label, color })],
    spacing: { before: 80, after: 200 }, indent: { left: convertInchesToTwip(0.05), right: convertInchesToTwip(0.05) },
  });
}
function cellText(text, opts = {}) {
  return new TableCell({
    width: { size: opts.width || 2000, type: WidthType.DXA },
    shading: opts.header ? { type: ShadingType.CLEAR, color: 'auto', fill: HEADER_FILL } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ children: [new TextRun({ text, bold: !!opts.header, color: opts.header ? 'FFFFFF' : undefined })], spacing: { after: 0 } })],
  });
}
function DataTable(headers, rows, widths) {
  const total = widths.reduce((a, b) => a + b, 0);
  return new Table({
    width: { size: total, type: WidthType.DXA }, columnWidths: widths,
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((h, i) => cellText(h, { header: true, width: widths[i] })) }),
      ...rows.map((r) => new TableRow({ children: r.map((c, i) => cellText(String(c), { width: widths[i] })) })),
    ],
  });
}
function Spacer(h = 100) { return new Paragraph({ text: '', spacing: { after: h } }); }
function PageBreakPara() { return new Paragraph({ children: [new PageBreak()] }); }

const children = [];

// ---------------- Cover ----------------
children.push(
  new Paragraph({ text: '', spacing: { before: 2000 } }),
  new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Zyter/NextGen', size: 32, color: GRAY_TEXT })], spacing: { after: 200 } }),
  new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Workforce, Scheduling & Demand', bold: true, size: 52, color: NAVY })], spacing: { after: 100 } }),
  new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Demo Guide — UM & CM', bold: true, size: 52, color: NAVY })], spacing: { after: 400 } }),
  new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Workforce/Queue Management, Scheduling & Adherence, and Demand & Forecasting — both modules', size: 26, italics: true, color: GRAY_TEXT })], spacing: { after: 800 } }),
  new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Demo reference date: Friday, July 17, 2026', size: 22, color: GRAY_TEXT })] }),
  PageBreakPara(),
);

// ================================================================
// PART 1 — UM
// ================================================================
children.push(H1('Part 1 — UM: Workforce, Scheduling & Demand'));
children.push(Say('Here on the UM side, these three tabs cover staffing, attendance, and pipeline pressure — who\'s carrying what, whether the team is showing up as scheduled, and whether next week\'s volume fits inside our capacity.'));

children.push(H2('Shared Controls'));
children.push(DataTable(
  ['Control', 'Effect'],
  [
    ['LOB filter (All / Medicaid / Medicare Advantage / Commercial PPO / ACA Exchange)', 'Narrows almost every tab\'s panels to that line of business.'],
    ['Lookback (Today / 7 days / 30 days / QTD, default 30 days)', 'Narrows every "in scope" calculation to cases submitted within that window.'],
  ],
  [4200, 5300],
));
children.push(Status('the top KPI strip (not covered in this scoped guide) only recomputes on Lookback changes, not LOB alone — doesn\'t affect these three tabs, which already respect both filters.', 'note'));

children.push(H2('Tab: Workforce & Queue Management'));
children.push(Status('with a few named static exceptions below.', 'live'));
children.push(Say('This is the nurse-level operational view — what\'s sitting in each queue, and how the caseload is spread across the team.'));
children.push(H3('Queue cards (7 queues: Intake, Clinical Review, MD Review, RFI Pending, OON Review, Concurrent Review, Pending P2P)'));
children.push(Bullet('Count = unclaimed pending cases in that queue (nurse = "—"), scoped by LOB/Lookback.'));
children.push(Bullet('Age bands (0–24h / 24–48h / >48h / Breach): Breach = tagged as past TAT. The other three bands come from a deterministic "hours since submitted" stand-in (Live rollup*), not a real elapsed-time clock.'));
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

children.push(H2('Tab: Scheduling & Adherence'));
children.push(Status('over a deterministic, seeded shift/attendance dataset — there\'s no real HRIS/timeclock behind it, but every rate/count shown is a genuine aggregation of the generated data.', 'note'));
children.push(Say('Same idea as a real workforce-management adherence view: 7 nurses across 3 teams, and how closely their actual shifts matched what was scheduled.'));
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
children.push(P('Adherence Breakdown (donut): every scheduled shift-day split On Time / Late Start / Early Leave / Overtime / Absence (~79% On Time / 7% Late / 6% Early / 4% Overtime / 4% Absence by construction).'));
children.push(P('Adherence & PTO by Nurse (table): per-nurse adherence rate (defaults to 100% rather than "—" if that nurse has zero shifts in the current scope — worth knowing before a live filter demo); PTO Accrued (YTD) is a flat, identical value for every nurse prorated by calendar day; PTO Used is a deterministic pseudo-random fraction (10–64%) of accrued days per nurse — neither is drawn from real leave records.'));
children.push(Spacer());

children.push(H2('Tab: Demand & Forecasting'));
children.push(Status('bucketed from each authorization\'s real submitted date (the fabrication is in the underlying case-pool dataset, not in this tab\'s math).', 'live'));
children.push(Say('This tells us whether the team can absorb what\'s coming in next week, not just what\'s already on the desk.'));
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
children.push(PageBreakPara());

// ================================================================
// PART 2 — CM
// ================================================================
children.push(H1('Part 2 — CM: Workforce, Scheduling & Demand'));
children.push(Say('Same three-tab structure on the Care Management side, adapted to a care-manager roster and a referral pipeline instead of a nurse roster and an authorization pipeline.'));

children.push(H2('Shared Controls'));
children.push(DataTable(
  ['Control', 'Effect'],
  [
    ['LOB filter (All / Medicaid / Medicare Advantage / Commercial PPO / ACA Exchange)', 'Narrows the active caseload and every steady-state panel (queues, workload, scheduling) to members in that line of business. Does not narrow the referral funnel or Demand & Forecasting — those use Lookback instead.'],
    ['Lookback (Today / 7 days / 30 days / QTD)', 'Narrows the referral funnel and any metric explicitly labeled with the lookback period. Does not narrow the active caseload — a mature member\'s enrollment date can be months old by design.'],
  ],
  [4200, 5300],
));

children.push(H2('Tab: Workforce & Caseload'));
children.push(Status('computed from the active caseload.', 'live'));
children.push(Say('This is the CM equivalent of the UM workforce view — six operational queues plus workload by care manager and by team.'));
children.push(H3('Queues (6 cards: New Referral, Outreach, Reassessment, Escalation, Discharge Follow-Up, Documentation)'));
children.push(Bullet('Count = members currently sitting in that operational queue (a member has at most one queue at a time, or none if nothing\'s actionable right now).'));
children.push(Bullet('Age bands (0–24h / 24–48h / >48h / Breach), shown as a % split within the card: Breach = flagged as past its SLA while queued; 0–24h = queue age < 24 hours; 24–48h = 24–48 hours; >48h = ≥ 48 hours (and not breached).'));
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
children.push(Bullet('Queue Draw — pulled from the shared unclaimed pool.'));
children.push(Bullet('Direct — Smart — placed by the system\'s proficiency-matching rule (a referral\'s clinical reason is matched to the least-utilized care manager in that discipline).'));
children.push(Bullet('Direct — Manual — hand-assigned by a supervisor or intake coordinator.'));
children.push(Spacer());

children.push(H2('Tab: Scheduling & Adherence'));
children.push(Status('live calculation, over illustrative shift/attendance data. The underlying weekly shift patterns and clock-in/out records are generated for this demo (no live HRIS/timeclock integration behind it), but every rate, count, and rollup shown is a real aggregation of that data.', 'note'));
children.push(Say('Same scheduling/adherence design as UM, run against the three CM teams instead of nurse teams.'));
children.push(P('Period toggle (Daily / Weekly / Rolling 4 Weeks / Monthly) changes the underlying window every metric is computed over. "Monthly" is a rolling ~5-week window, not a calendar-month cut. Team filter narrows everything to one of the three CM teams.'));
children.push(DataTable(
  ['Tile', 'Formula'],
  [
    ['Adherence Rate', 'On-Time shifts ÷ Total scheduled shifts in the selected period/team.'],
    ['Exceptions', 'Count of scheduled shifts in the period that were not On Time (Late Start, Early Leave, Overtime, or Absence).'],
    ['Care Managers Scheduled', 'Count of care managers with a shift schedule in scope (team-filtered headcount).'],
    ['PTO Days', 'Count of PTO-type shift-days in the period/team.'],
    ['Upcoming PTO', 'Count of PTO days scheduled in the next 3 weeks from today (forward-looking, independent of the period toggle).'],
  ],
  [2600, 6900],
));
children.push(P('Adherence Breakdown (donut): every scheduled shift in the period, split into On Time / Late Start / Early Leave / Overtime / Absence.'));
children.push(P('Adherence & PTO by Care Manager (table): per-person adherence rate alongside PTO Accrued (YTD, prorated by day-of-year against a 20-day annual grant), PTO Used, and PTO Remaining. Row color thresholds: Adherence Rate red <70%, amber 70–89%, green ≥90%; PTO Remaining red ≤2 days, amber 3–5 days, green >5 days.'));
children.push(Spacer());

children.push(H2('Tab: Demand & Forecasting'));
children.push(Status('bucketed from each referral\'s actual received date (real data, not fabricated) — the only fabricated part is the demo\'s underlying referral dataset itself.', 'live'));
children.push(Say('This is the intake-side version of the same question: is the referral pipeline outrunning the team\'s capacity to take on new members?'));
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

const doc = new Document({
  styles: {
    default: { document: { run: { font: 'Calibri', size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { bold: true, size: 32, color: NAVY, font: 'Calibri' } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { bold: true, size: 26, color: BLUE, font: 'Calibri' } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { bold: true, size: 22, color: '404040', font: 'Calibri' } },
    ],
  },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 } } },
    children,
  }],
});

const outPath = 'C:\\Users\\Christina.Lawson\\Downloads\\zyter_appeals_demo (2)\\um-supervisor\\docs\\UM-CM-Workforce-Schedule-Demand-Demo-Guide.docx';
Packer.toBuffer(doc).then((buf) => { fs.writeFileSync(outPath, buf); console.log('Wrote', outPath, buf.length, 'bytes'); });
