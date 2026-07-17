import { Injectable } from '@angular/core';
import {
  Kpi, QueueCard, NurseRow, TatBucket, TatStat, DecisionStat, DecisionRow,
  ConcurrentRow, QualityBar, MissingField, ProviderRow, HighDollarCase,
  AuditFlag, AiRecommendation, RiskCase,
} from './dashboard.models';

@Injectable({ providedIn: 'root' })
export class DashboardData {
  readonly today = 'Friday, July 17, 2026';

  readonly kpis: Kpi[] = [
    { icon: 'folder',   value: '247',   label: 'Pending Cases',     tone: 'green' },
    { icon: 'check',    value: '94.2%', label: 'TAT Compliance',    tone: 'green' },
    { icon: 'bolt',     value: '38%',   label: 'Auto-Approval Rate', tone: 'teal' },
    { icon: 'alert',    value: '12',    label: 'Cases at Risk',     tone: 'amber' },
    { icon: 'clock',    value: '2.4h',  label: 'Avg Handle Time',   tone: 'teal' },
    { icon: 'inbox',    value: '8',     label: 'Unassigned Queue',  tone: 'amber' },
    { icon: 'xcircle',  value: '3',     label: 'Breached SLAs',     tone: 'red' },
    { icon: 'users',    value: '87%',   label: 'Team Utilization',  tone: 'green' },
  ];

  // ---------- Workforce & Queue Management ----------
  readonly queues: QueueCard[] = [
    { name: 'Intake',          count: 42, buckets: { fresh: 45, day2: 30, over48: 18, breach: 7 } },
    { name: 'Clinical Review', count: 68, buckets: { fresh: 55, day2: 28, over48: 12, breach: 5 } },
    { name: 'MD Review',       count: 23, buckets: { fresh: 40, day2: 32, over48: 20, breach: 8 } },
    { name: 'RFI Pending',     count: 31, buckets: { fresh: 30, day2: 35, over48: 25, breach: 10 } },
    { name: 'OON Review',      count: 15, buckets: { fresh: 50, day2: 30, over48: 14, breach: 6 } },
    { name: 'Concurrent',      count: 38, buckets: { fresh: 52, day2: 30, over48: 13, breach: 5 } },
  ];

  readonly nurses: NurseRow[] = [
    { name: 'Maria Gonzalez, RN',  active: 32, pending: 8,  completed: 145, avgTat: '1.8h', utilization: 92 },
    { name: 'Jessica Williams, RN', active: 28, pending: 5,  completed: 132, avgTat: '2.1h', utilization: 85 },
    { name: 'Andrew Mitchell, RN', active: 35, pending: 12, completed: 128, avgTat: '2.6h', utilization: 96 },
    { name: 'Sarah Mitchell, RN',  active: 22, pending: 3,  completed: 156, avgTat: '1.5h', utilization: 72 },
    { name: 'Emily Chen, RN',      active: 30, pending: 7,  completed: 141, avgTat: '2.0h', utilization: 88 },
    { name: 'Robert Kim, RN',      active: 26, pending: 4,  completed: 138, avgTat: '1.9h', utilization: 80 },
  ];

  // ---------- TAT & SLA Compliance ----------
  readonly tatCompliance = 94;
  readonly tatBuckets: TatBucket[] = [
    { label: 'On Track', count: 186, tone: 'green' },
    { label: 'At Risk',  count: 42,  tone: 'amber' },
    { label: 'Breached', count: 19,  tone: 'red' },
  ];
  readonly tatStats: TatStat[] = [
    { value: '34',   label: 'Expedited' },
    { value: '213',  label: 'Standard' },
    { value: '8',    label: 'Paused' },
    { value: '1.8d', label: 'Avg Turnaround' },
  ];

  // ---------- Clinical Decision Insights ----------
  readonly decisionStats: DecisionStat[] = [
    { value: '62%', label: 'Approved',      icon: 'check',   tone: 'green' },
    { value: '18%', label: 'Denied',        icon: 'xcircle', tone: 'red' },
    { value: '20%', label: 'Partial',       icon: 'minus',   tone: 'amber' },
    { value: '38%', label: 'Auto-Approved', icon: 'bolt',    tone: 'teal' },
    { value: '15%', label: 'MD Review',     icon: 'user',    tone: 'blue' },
    { value: '7%',  label: 'P2P Rate',      icon: 'phone',   tone: 'purple' as any },
  ];
  readonly decisionRows: DecisionRow[] = [
    { procedure: 'Total Knee Replacement',   serviceType: 'Inpatient',  guideline: 'XYZ 2024',     approvalRate: 78, volume: 42 },
    { procedure: 'Lumbar Fusion',            serviceType: 'Inpatient',  guideline: 'ABCD A-0420',  approvalRate: 65, volume: 28 },
    { procedure: 'Cardiac Catheterization',  serviceType: 'Outpatient', guideline: 'XYZ 2024',     approvalRate: 82, volume: 35 },
    { procedure: 'MRI Brain w/ Contrast',    serviceType: 'Outpatient', guideline: 'AIM Guidelines', approvalRate: 91, volume: 56 },
    { procedure: 'Physical Therapy (12 visits)', serviceType: 'Outpatient', guideline: 'ABCD A-0103', approvalRate: 88, volume: 64 },
    { procedure: 'Behavioral Health IOP',    serviceType: 'Behavioral', guideline: 'LOCUS Criteria', approvalRate: 72, volume: 19 },
  ];

  // ---------- Concurrent Review Monitoring ----------
  readonly concurrentRows: ConcurrentRow[] = [
    { member: 'Adams, Patricia', facility: 'Memorial Hospital',  admit: '2026-03-10', nextReview: '2026-03-18', los: '7d', losFlag: true,  expectedLos: '5d', daysApproved: 5, daysRequested: 10, overstayRisk: 'red',   overstayLabel: 'High' },
    { member: 'Brown, Michael',  facility: 'St. Mary Medical',   admit: '2026-03-12', nextReview: '2026-03-19', los: '5d', losFlag: true,  expectedLos: '4d', daysApproved: 4, daysRequested: 7,  overstayRisk: 'amber', overstayLabel: 'Medium' },
    { member: 'Clark, Jennifer', facility: 'University Hospital', admit: '2026-03-14', nextReview: '2026-03-17', los: '3d', losFlag: false, expectedLos: '3d', daysApproved: 3, daysRequested: 5,  overstayRisk: 'green', overstayLabel: 'Low' },
    { member: 'Davis, Robert',   facility: 'Community General',  admit: '2026-03-08', nextReview: '2026-03-17', los: '9d', losFlag: true,  expectedLos: '6d', daysApproved: 6, daysRequested: 12, overstayRisk: 'red',   overstayLabel: 'High' },
    { member: 'Evans, Susan',    facility: 'Regional Medical',   admit: '2026-03-13', nextReview: '2026-03-20', los: '4d', losFlag: false, expectedLos: '5d', daysApproved: 5, daysRequested: 5,  overstayRisk: 'green', overstayLabel: 'Low' },
  ];

  // ---------- Intake & Documentation Quality ----------
  readonly qualityBars: QualityBar[] = [
    { label: 'Complete Submissions', pct: 87, tone: 'green', icon: 'check' },
    { label: 'Auto-Approved',        pct: 38, tone: 'teal',  icon: 'bolt' },
    { label: 'Needing RFI',          pct: 15, tone: 'amber', icon: 'mail' },
  ];
  readonly missingFields: MissingField[] = [
    { field: 'Clinical Justification',   count: 23, pct: 42 },
    { field: 'Provider NPI',             count: 18, pct: 33 },
    { field: 'Diagnosis Code (ICD-10)',  count: 14, pct: 25 },
    { field: 'Procedure Code (CPT)',     count: 11, pct: 20 },
    { field: 'Supporting Documentation', count: 9,  pct: 16 },
  ];

  // ---------- Provider & Network Insights ----------
  readonly oonRequests = 47;
  readonly providers: ProviderRow[] = [
    { provider: 'Dr. Sarah Mitchell',          npi: '1234567890', requests: 34, approvalRate: 82, rfiRate: 12, rfiHigh: false },
    { provider: 'Dr. James Parker',            npi: '0987654321', requests: 28, approvalRate: 75, rfiRate: 18, rfiHigh: false },
    { provider: 'Dr. Emily Chen',              npi: '1122334455', requests: 25, approvalRate: 91, rfiRate: 5,  rfiHigh: false },
    { provider: 'Memorial Orthopedic Group',   npi: '5544332211', requests: 22, approvalRate: 68, rfiRate: 24, rfiHigh: true },
    { provider: 'Regional Heart Center',       npi: '6677889900', requests: 19, approvalRate: 88, rfiRate: 8,  rfiHigh: false },
    { provider: 'Coastal Neurology Associates', npi: '1133557799', requests: 17, approvalRate: 71, rfiRate: 22, rfiHigh: true },
  ];

  // ---------- Financial / Cost Indicators ----------
  readonly financials = [
    { value: '$4.3M', label: 'Estimated Pending Cost', icon: 'dollar' },
    { value: '$1.8M', label: 'Cost Avoided (MTD)',     icon: 'shield' },
    { value: '+1.3d', label: 'LOS Variance',           icon: 'barchart' },
  ];
  readonly highDollarCases: HighDollarCase[] = [
    { authId: 'AUTH-4521', member: 'Johnson, Robert',  procedure: 'Cardiac Bypass (CABG)',     cost: '$285K', status: 'Pending Review' },
    { authId: 'AUTH-4498', member: 'Martinez, Carlos', procedure: 'Liver Transplant Evaluation', cost: '$142K', status: 'MD Review' },
    { authId: 'AUTH-4534', member: 'Williams, Sarah',  procedure: 'NICU Stay (21 days)',        cost: '$198K', status: 'Concurrent Review' },
    { authId: 'AUTH-4512', member: 'Thompson, James',  procedure: 'Spinal Fusion (3-level)',    cost: '$127K', status: 'Pending P2P' },
  ];

  // ---------- Audit & Compliance ----------
  readonly complianceBars: QualityBar[] = [
    { label: 'Documentation Completeness', pct: 82, tone: 'teal', icon: '' },
    { label: 'Guideline Adherence',        pct: 94, tone: 'teal', icon: '' },
    { label: 'Decision Rationale Documented', pct: 89, tone: 'teal', icon: '' },
  ];
  readonly auditFlags: AuditFlag[] = [
    { id: 'AUD-201', type: 'Missing Rationale',       description: 'Decision rationale not documented for AUTH-4488', date: '2026-03-15', severity: 'amber', severityLabel: 'Medium' },
    { id: 'AUD-202', type: 'Guideline Deviation',     description: 'Approval without XYZ criteria match — AUTH-4501',  date: '2026-03-14', severity: 'red',   severityLabel: 'High' },
    { id: 'AUD-203', type: 'Incomplete Documentation', description: 'Clinical notes incomplete for concurrent review AUTH-4515', date: '2026-03-16', severity: 'green', severityLabel: 'Low' },
    { id: 'AUD-204', type: 'TAT Compliance',          description: 'Decision rendered after SLA deadline — AUTH-4473', date: '2026-03-13', severity: 'red',   severityLabel: 'High' },
  ];

  // ---------- AI / NextGen Intelligence ----------
  readonly aiRecommendations: AiRecommendation[] = [
    { icon: 'swap',   title: 'Reassign Case AUTH-4587', detail: 'Nurse Andrew Mitchell is at 96% capacity. Reassign to Sarah Mitchell (72%) to prevent TAT breach.', confidence: 94, action: 'Reassign Case', tone: 'red' },
    { icon: 'mail',   title: 'Send RFI for AUTH-4521', detail: 'Clinical justification missing for cardiac bypass request. Provider has 24h response history.', confidence: 89, action: 'Send RFI', tone: 'amber' },
    { icon: 'arrowup', title: 'Escalate AUTH-4498 to MD', detail: 'Liver transplant evaluation exceeds nurse review scope. Dr. Patel available for immediate review.', confidence: 97, action: 'Escalate to MD', tone: 'blue' },
  ];
  readonly riskGauges = [
    { value: 23, label: 'Denial Likelihood',  tone: 'red' as const },
    { value: 15, label: 'Appeal Likelihood',  tone: 'amber' as const },
    { value: 8,  label: 'TAT Breach Risk',    tone: 'amber' as const },
  ];
  readonly aiAutoApproved = 38;
  readonly aiConfidence = [
    { label: 'High (>90%)',    pct: 72, tone: 'teal' as const },
    { label: 'Medium (70-90%)', pct: 21, tone: 'amber' as const },
    { label: 'Low (<70%)',     pct: 7,  tone: 'red' as const },
  ];

  // ---------- Risk & Escalation Panel (inferred — no screenshot) ----------
  readonly riskSummary = [
    { value: '12', label: 'Cases at Risk',   tone: 'amber' as const },
    { value: '3',  label: 'Breached SLAs',   tone: 'red' as const },
    { value: '5',  label: 'Escalated Today', tone: 'blue' as const },
    { value: '2',  label: 'Awaiting P2P',    tone: 'amber' as const },
  ];
  readonly riskCases: RiskCase[] = [
    { authId: 'AUTH-4587', member: 'Nguyen, Linda',   type: 'Clinical Review', reason: 'Approaching TAT deadline', owner: 'Andrew Mitchell, RN', slaRemaining: '2h 15m', risk: 'red',   riskLabel: 'High' },
    { authId: 'AUTH-4473', member: 'Foster, Daniel',  type: 'MD Review',       reason: 'SLA breached — decision overdue', owner: 'MD Queue', slaRemaining: 'Overdue', risk: 'red',   riskLabel: 'Breached' },
    { authId: 'AUTH-4521', member: 'Johnson, Robert', type: 'RFI Pending',     reason: 'Awaiting provider documentation', owner: 'Maria Gonzalez, RN', slaRemaining: '6h 40m', risk: 'amber', riskLabel: 'Medium' },
    { authId: 'AUTH-4498', member: 'Martinez, Carlos', type: 'MD Review',      reason: 'High-dollar case pending escalation', owner: 'Dr. Patel', slaRemaining: '4h 05m', risk: 'amber', riskLabel: 'Medium' },
    { authId: 'AUTH-4534', member: 'Williams, Sarah',  type: 'Concurrent',     reason: 'Overstay risk — continued stay review', owner: 'Emily Chen, RN', slaRemaining: '1d 3h', risk: 'amber', riskLabel: 'Medium' },
    { authId: 'AUTH-4602', member: 'Reed, Katherine',  type: 'Intake',         reason: 'Unassigned > 24h', owner: 'Unassigned', slaRemaining: '8h 20m', risk: 'amber', riskLabel: 'Medium' },
  ];
}
