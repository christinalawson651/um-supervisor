import { Injectable, inject } from '@angular/core';
import { Interaction } from './interaction';

export interface Dx { code: string; desc: string; primary: boolean; }
export interface Med { name: string; dose: string; freq: string; }
export interface Goal { desc: string; status: string; target: string; }

export interface MemberChart {
  memberId: string;
  name: string;                 // "First Last"
  dob: string;
  age: number;
  gender: string;
  address: string;
  phone: string;
  lob: string;
  planName: string;
  pcp: string;
  pcm: string;
  riskScore: number;            // 0–10
  riskLevel: 'Low' | 'Moderate' | 'High' | 'Critical';
  acuity: 'Low' | 'Medium' | 'High';
  carePlanStatus: string;
  openCases: number;
  diagnoses: Dx[];
  medications: Med[];
  goals: Goal[];
  utilization: { er12: number; adm12: number; lastAdmit: string; avgLos: string };
  alerts: string[];
  cmStatus: string;             // referral / enrollment status
  programs: string[];
}

// ---- a few fully-authored "hero" members for the demo money-shots ----
const HERO: Record<string, MemberChart> = {
  'james whitfield': {
    memberId: 'MBR000001', name: 'James Whitfield', dob: '1991-03-14', age: 34, gender: 'Male',
    address: '412 Maple Ave, Columbus, OH 43215', phone: '614-555-0142',
    lob: 'Commercial PPO', planName: 'BlueCross PPO Select', pcp: 'Dr. Michael Chen', pcm: 'Christina Lawson',
    riskScore: 3.2, riskLevel: 'Low', acuity: 'Low', carePlanStatus: 'In Progress', openCases: 1,
    diagnoses: [
      { code: 'I10', desc: 'Essential hypertension', primary: true },
      { code: 'R73.03', desc: 'Prediabetes', primary: false },
    ],
    medications: [{ name: 'Lisinopril', dose: '10 mg', freq: 'Daily' }, { name: 'Metformin', dose: '500 mg', freq: 'BID' }],
    goals: [{ desc: 'Reduce systolic BP below 130', status: 'In Progress', target: '2026-09-01' }],
    utilization: { er12: 0, adm12: 0, lastAdmit: '—', avgLos: '—' },
    alerts: ['Overdue for A1c screening'],
    cmStatus: 'Not referred', programs: [],
  },
  'kristina anderson': {
    memberId: 'MBR000003', name: 'Kristina Anderson', dob: '1943-05-09', age: 82, gender: 'Female',
    address: '88 Birch St, Cleveland, OH 44113', phone: '216-555-0188',
    lob: 'Medicaid', planName: 'Cigna Medicaid', pcp: 'Dr. Michael Chen', pcm: 'Christina Lawson',
    riskScore: 7.8, riskLevel: 'High', acuity: 'Medium', carePlanStatus: 'Active', openCases: 3,
    diagnoses: [
      { code: 'I50.9', desc: 'Congestive heart failure', primary: true },
      { code: 'E11.9', desc: 'Type 2 diabetes mellitus', primary: false },
      { code: 'N18.3', desc: 'Chronic kidney disease, stage 3', primary: false },
    ],
    medications: [
      { name: 'Furosemide', dose: '40 mg', freq: 'Daily' },
      { name: 'Carvedilol', dose: '12.5 mg', freq: 'BID' },
      { name: 'Insulin glargine', dose: '20 units', freq: 'Nightly' },
    ],
    goals: [
      { desc: 'Daily weight monitoring for CHF', status: 'In Progress', target: '2026-08-15' },
      { desc: 'A1c below 8.0', status: 'Not Started', target: '2026-10-01' },
    ],
    utilization: { er12: 4, adm12: 2, lastAdmit: '2026-06-02', avgLos: '4.5d' },
    alerts: ['2 ER visits in 90 days', 'CHF readmission risk', 'Polypharmacy (8+ meds)'],
    cmStatus: 'Care plan active', programs: ['CHF Disease Management', 'Diabetes Management'],
  },
};

// ---- synthesis pools for any other member ----
const DX_SETS: Dx[][] = [
  [{ code: 'E11.9', desc: 'Type 2 diabetes mellitus', primary: true }, { code: 'E78.5', desc: 'Hyperlipidemia', primary: false }],
  [{ code: 'J44.9', desc: 'COPD', primary: true }, { code: 'I10', desc: 'Essential hypertension', primary: false }],
  [{ code: 'F33.1', desc: 'Major depressive disorder, recurrent', primary: true }, { code: 'F41.1', desc: 'Generalized anxiety disorder', primary: false }],
  [{ code: 'M17.11', desc: 'Osteoarthritis, right knee', primary: true }],
  [{ code: 'I48.91', desc: 'Atrial fibrillation', primary: true }, { code: 'I50.9', desc: 'Congestive heart failure', primary: false }],
  [{ code: 'C50.911', desc: 'Malignant neoplasm of breast', primary: true }],
];
const MED_SETS: Med[][] = [
  [{ name: 'Metformin', dose: '500 mg', freq: 'BID' }, { name: 'Atorvastatin', dose: '20 mg', freq: 'Daily' }],
  [{ name: 'Albuterol', dose: '90 mcg', freq: 'PRN' }, { name: 'Lisinopril', dose: '10 mg', freq: 'Daily' }],
  [{ name: 'Sertraline', dose: '50 mg', freq: 'Daily' }],
  [{ name: 'Ibuprofen', dose: '600 mg', freq: 'TID' }],
  [{ name: 'Apixaban', dose: '5 mg', freq: 'BID' }, { name: 'Carvedilol', dose: '12.5 mg', freq: 'BID' }],
];
const PROGRAMS = ['Complex Care Management', 'Diabetes Management', 'CHF Disease Management', 'Behavioral Health Integration', 'Transitional Care'];
const STREETS = ['Oak St', 'Elm Ave', 'Cedar Ln', 'Pine Rd', 'Walnut Dr', 'Chestnut Way'];
const CITIES = ['Columbus, OH', 'Cleveland, OH', 'Cincinnati, OH', 'Toledo, OH', 'Akron, OH'];
const LOBS = ['Medicaid', 'Medicare Advantage', 'Commercial PPO', 'ACA Exchange'];
const PLANS = ['Cigna Medicaid', 'Humana Gold Plus', 'BlueCross PPO Select', 'Ambetter Balanced'];
const PCPS = ['Dr. Michael Chen', 'Dr. Sarah Rivera', 'Dr. Amanda Smith', 'Dr. David Park', 'Dr. Lisa Nguyen'];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0x7fffffff;
  return h;
}

function synth(name: string): MemberChart {
  const h = hash(name);
  const age = 28 + (h % 60);
  const dxIdx = h % DX_SETS.length;
  const riskScore = Math.round((2 + (h % 80) / 10) * 10) / 10; // 2.0–9.9
  const level = riskScore >= 8 ? 'Critical' : riskScore >= 6 ? 'High' : riskScore >= 4 ? 'Moderate' : 'Low';
  const acuity = riskScore >= 7 ? 'High' : riskScore >= 4 ? 'Medium' : 'Low';
  const referred = riskScore >= 6;
  const er = h % 5, adm = h % 3;
  return {
    memberId: `MBR${String(100000 + (h % 899999)).slice(0, 6)}`,
    name, dob: `19${40 + (h % 55)}-0${1 + (h % 9)}-1${h % 9}`, age,
    gender: h % 2 ? 'Female' : 'Male',
    address: `${100 + (h % 900)} ${STREETS[h % STREETS.length]}, ${CITIES[h % CITIES.length]}`,
    phone: `614-555-0${100 + (h % 899)}`,
    lob: LOBS[h % LOBS.length], planName: PLANS[h % PLANS.length],
    pcp: PCPS[h % PCPS.length], pcm: 'Christina Lawson',
    riskScore, riskLevel: level as MemberChart['riskLevel'], acuity: acuity as MemberChart['acuity'],
    carePlanStatus: referred ? (riskScore >= 8 ? 'Active' : 'In Progress') : 'Not Started',
    openCases: 1 + (h % 4),
    diagnoses: DX_SETS[dxIdx],
    medications: MED_SETS[h % MED_SETS.length],
    goals: referred ? [{ desc: 'Improve medication adherence', status: 'In Progress', target: '2026-09-30' }] : [],
    utilization: { er12: er, adm12: adm, lastAdmit: adm ? '2026-05-1' + (h % 9) : '—', avgLos: adm ? `${2 + (h % 5)}.${h % 9}d` : '—' },
    alerts: [
      ...(er >= 3 ? ['Frequent ER utilization'] : []),
      ...(adm >= 2 ? ['Readmission risk'] : []),
      ...(riskScore >= 8 ? ['Rising-risk member'] : []),
    ],
    cmStatus: referred ? 'CM referral active' : 'Not referred',
    programs: referred ? [PROGRAMS[h % PROGRAMS.length]] : [],
  };
}

@Injectable({ providedIn: 'root' })
export class Members {
  private ix = inject(Interaction);

  /** Accepts "Last, First" or "First Last" and opens that member's chart. */
  openByName(raw: string) {
    const name = raw.includes(',')
      ? raw.split(',').map((s) => s.trim()).reverse().join(' ')
      : raw.trim();
    const key = name.toLowerCase();
    const chart = HERO[key] ?? synth(name);
    this.ix.openMemberChart(chart);
  }
}
