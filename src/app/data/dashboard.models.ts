// Shared types for the UM Supervisor Dashboard mock data.

export type Tone = 'green' | 'amber' | 'red' | 'blue' | 'teal' | 'gray';

export interface Kpi {
  icon: string;        // inline svg path key
  value: string;
  label: string;
  tone: Tone;          // left accent + icon color
}

export interface QueueCard {
  name: string;
  count: number;
  // distribution across the SLA buckets (percentages, sum ~100)
  buckets: { fresh: number; day2: number; over48: number; breach: number };
}

export interface NurseRow {
  name: string;
  team: string;
  active: number;
  pending: number;
  completed: number;
  avgTat: string;
  utilization: number; // %
}

export interface TatBucket { label: string; count: number; tone: Tone; }
export interface TatStat { value: string; label: string; }

export interface DecisionStat { value: string; label: string; icon: string; tone: Tone; }
export interface DecisionRow {
  procedure: string;
  serviceType: 'Inpatient' | 'Outpatient' | 'Behavioral';
  guideline: string;
  approvalRate: number;
  volume: number;
}

export interface ConcurrentRow {
  authId: string;
  member: string;
  facility: string;
  admit: string;
  los: string;
  losFlag: boolean;
  totalCertifiedDays: number;
  certifiedThrough: string;
  daysRemaining: number;       // can be negative — certification already lapsed
  uncertifiedDays: number;     // LOS days beyond what's been certified so far
  nextReview: string;
  daysRequested: number;
  status: string;              // 'Certified' | 'Uncertified Days' | 'Extension Requested' | 'Recert Due'
  statusTone: Tone;
  reviewer: string;
  expectedDischarge: string;
  nextAction: string;
  nextActionShort: string;     // compact grid label; nextAction (full sentence) shows on hover
  expectedLos: string;         // internal — not its own grid column (superseded by Expected Discharge), kept for aggregation
  overstayRisk: Tone;          // green/amber/red — LOS vs. expected-LOS risk (kept for internal styling)
  overstayLabel: string;
}

export interface QualityBar { label: string; pct: number; tone: Tone; icon: string; }
export interface MissingField { field: string; count: number; pct: number; }

export type ProviderFlag = 'oon' | 'missingClinicals' | 'networkDiscrepancy' | 'highIncomplete' | 'highDenialPartial' | 'unusualUtilization' | 'tatDelay';

export interface ProviderInsightRow {
  provider: string;
  specialty: string;
  kind: 'Individual' | 'Facility';
  npi: string;
  networkStatus: string;
  totalRequests: number;
  oonRequests: number;
  approvalRate: number;
  denialRate: number;
  partialRate: number;
  incompleteRate: number;
  expeditedRate: number;
  avgResponseDays: number;
  clinicalsAwaiting: number;
  flags: ProviderFlag[];
  insights: string[];          // human-readable sentence per flag, same order as `flags`
  primaryInsight: string;      // insights[0], or a clean-bill message when no flags
  needsAttention: boolean;
}

export interface HighDollarCase {
  authId: string;
  member: string;
  procedure: string;
  cost: string;
  status: string;
}

export interface AuditFlag {
  id: string;
  type: string;
  description: string;
  date: string;
  severity: Tone; // low(green)/medium(amber)/high(red)
  severityLabel: string;
}

export interface AiRecommendation {
  icon: string;
  title: string;
  detail: string;
  confidence: number;
  action: string;
  tone: Tone; // left accent
}

export interface RiskCase {
  authId: string;
  member: string;
  drivers: string[];   // risk-driver chips
  amount: string;      // $ exposure
  stage: string;       // review stage
  score: number;       // risk score
  risk: Tone;          // red (>=90) / amber
}

export interface RiskTile {
  icon: string;
  label: string;
  value: string;
  footer: string;
  footerTone?: Tone;
  tone: Tone;          // left border
}
