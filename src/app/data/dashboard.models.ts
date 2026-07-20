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
  member: string;
  facility: string;
  admit: string;
  nextReview: string;
  los: string;
  losFlag: boolean;
  expectedLos: string;
  daysApproved: number;
  daysRequested: number;
  overstayRisk: Tone; // green/amber/red
  overstayLabel: string;
}

export interface QualityBar { label: string; pct: number; tone: Tone; icon: string; }
export interface MissingField { field: string; count: number; pct: number; }

export interface ProviderRow {
  provider: string;
  npi: string;
  requests: number;
  approvalRate: number;
  rfiRate: number;
  rfiHigh: boolean;
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
