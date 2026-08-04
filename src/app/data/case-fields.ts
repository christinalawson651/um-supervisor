// Shared, derived case attributes used across every tab's tables and drill-downs
// (single source of truth so "LOB", "Program", and "Urgency" mean the same thing everywhere).
import { CaseRec } from './case-pool';

export const LOBS = ['Medicaid', 'Medicare Advantage', 'Commercial PPO', 'ACA Exchange'];
export function lobOf(authId: string): string { return LOBS[Number(authId.slice(-2)) % LOBS.length]; }

export const PROGRAMS = ['Inpatient', 'Outpatient', 'Behavioral Health', 'Pharmacy', 'DME / Home Health'];
export function programOf(c: CaseRec): string {
  if (c.serviceType === 'Inpatient') return 'Inpatient';
  if (c.serviceType === 'Behavioral') return 'Behavioral Health';
  const h = Number(c.authId.slice(-1)) % 3;
  return h === 0 ? 'Pharmacy' : h === 1 ? 'DME / Home Health' : 'Outpatient';
}

export type AuthType = 'IP' | 'OP' | 'RX';
export function authTypeOf(c: CaseRec): AuthType {
  if (c.serviceType === 'Inpatient') return 'IP';
  if (programOf(c) === 'Pharmacy') return 'RX';
  return 'OP';
}

export function tatStatus(c: CaseRec): 'On Track' | 'At Risk' | 'Breached' {
  return c.tags.includes('onTrack') ? 'On Track' : c.tags.includes('atRisk') ? 'At Risk' : c.tags.includes('breached') ? 'Breached' : 'On Track';
}

export function urgencyOf(c: CaseRec): 'Expedited' | 'Standard' {
  return c.tags.includes('expedited') ? 'Expedited' : 'Standard';
}

/** Composite score for the Case Explorer's "Sort: Urgency" control — expedited & SLA-risk float to the top. */
export function urgencyScore(c: CaseRec): number {
  let score = 0;
  if (c.tags.includes('expedited')) score += 1000;
  if (c.tags.includes('breached')) score += 500;
  else if (c.tags.includes('atRisk')) score += 250;
  if (c.phase === 'pending' && c.tags.includes('unassigned')) score += 100;
  return score + c.tatH;
}

// ---- Age in queue (shared by Workforce's age bars and the case pool's own return-to-queue logic) ----
export function ageH(authId: string): number { return 6 + (Number(authId.slice(-2)) % 90); }
export function bandOf(authId: string, breached: boolean): 'fresh' | 'day2' | 'over48' | 'breach' {
  if (breached) return 'breach';
  const h = ageH(authId);
  return h < 24 ? 'fresh' : h < 48 ? 'day2' : 'over48';
}

// ---- Shared "now" for every lookback/date calculation, so the case pool's dates and the
// Lookback filter always agree on what "today" means (matches DashboardData.today). ----
export const TODAY = new Date(2026, 6, 17); // Friday, July 17, 2026
export function daysAgo(dateStr: string): number {
  const d = new Date(`${dateStr}T00:00:00`);
  return Math.round((TODAY.getTime() - d.getTime()) / 86400000);
}
