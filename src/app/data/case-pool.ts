// A pool of representative authorization records that back every drill-down.
// Metric drawers filter/sample this pool so the numbers feel real and consistent.

export type Decision = 'Approved' | 'Denied' | 'Partial' | 'Pending';

export interface CaseRec {
  authId: string;
  member: string;
  procedure: string;
  serviceType: 'Inpatient' | 'Outpatient' | 'Behavioral';
  decision: Decision;
  status: string;
  nurse: string;
  submitted: string;
  tatH: number;      // handle time / turnaround in hours
  cost: number;      // estimated cost in USD
  tags: string[];    // e.g. auto, atRisk, breached, mdReview, p2p, rfi, unassigned, pending, onTrack, incompleteDoc, oon
}

export const CASE_POOL: CaseRec[] = [
  { authId: 'AUTH-4501', member: 'Adams, Patricia',   procedure: 'Total Knee Replacement',   serviceType: 'Inpatient',  decision: 'Approved', status: 'Approved',          nurse: 'Maria Gonzalez, RN',   submitted: '2026-07-10', tatH: 1.6, cost: 42000,  tags: ['onTrack'] },
  { authId: 'AUTH-4502', member: 'Brown, Michael',     procedure: 'Lumbar Fusion',            serviceType: 'Inpatient',  decision: 'Partial',  status: 'Partial Approval', nurse: 'Andrew Mitchell, RN',  submitted: '2026-07-11', tatH: 2.9, cost: 68000,  tags: ['mdReview','atRisk'] },
  { authId: 'AUTH-4503', member: 'Clark, Jennifer',    procedure: 'MRI Brain w/ Contrast',    serviceType: 'Outpatient', decision: 'Approved', status: 'Auto-Approved',     nurse: '—',                    submitted: '2026-07-12', tatH: 0.2, cost: 2400,   tags: ['auto','onTrack'] },
  { authId: 'AUTH-4504', member: 'Davis, Robert',      procedure: 'Cardiac Catheterization',  serviceType: 'Outpatient', decision: 'Approved', status: 'Approved',          nurse: 'Emily Chen, RN',       submitted: '2026-07-09', tatH: 1.9, cost: 18500,  tags: ['onTrack'] },
  { authId: 'AUTH-4505', member: 'Evans, Susan',       procedure: 'Physical Therapy (12v)',   serviceType: 'Outpatient', decision: 'Approved', status: 'Auto-Approved',     nurse: '—',                    submitted: '2026-07-12', tatH: 0.1, cost: 1800,   tags: ['auto','onTrack'] },
  { authId: 'AUTH-4506', member: 'Foster, Daniel',     procedure: 'Spinal Fusion (3-level)',  serviceType: 'Inpatient',  decision: 'Denied',   status: 'Denied',           nurse: 'Andrew Mitchell, RN',  submitted: '2026-07-06', tatH: 3.4, cost: 127000, tags: ['mdReview','breached'] },
  { authId: 'AUTH-4507', member: 'Garcia, Maria',      procedure: 'Behavioral Health IOP',    serviceType: 'Behavioral', decision: 'Partial',  status: 'Partial Approval', nurse: 'Robert Kim, RN',       submitted: '2026-07-10', tatH: 2.2, cost: 9600,   tags: ['atRisk'] },
  { authId: 'AUTH-4508', member: 'Harris, James',      procedure: 'CT Abdomen',               serviceType: 'Outpatient', decision: 'Pending',  status: 'RFI Pending',      nurse: 'Maria Gonzalez, RN',   submitted: '2026-07-11', tatH: 1.2, cost: 3200,   tags: ['rfi','pending','incompleteDoc'] },
  { authId: 'AUTH-4509', member: 'Ibrahim, Sana',      procedure: 'Knee Arthroscopy',         serviceType: 'Outpatient', decision: 'Approved', status: 'Approved',          nurse: 'Jessica Williams, RN', submitted: '2026-07-08', tatH: 1.7, cost: 12500,  tags: ['onTrack'] },
  { authId: 'AUTH-4510', member: 'Johnson, Robert',    procedure: 'Cardiac Bypass (CABG)',    serviceType: 'Inpatient',  decision: 'Pending',  status: 'Pending Review',   nurse: 'Emily Chen, RN',       submitted: '2026-07-09', tatH: 4.1, cost: 285000, tags: ['pending','mdReview','p2p','atRisk','incompleteDoc'] },
  { authId: 'AUTH-4511', member: 'Kim, Angela',        procedure: 'Colonoscopy',              serviceType: 'Outpatient', decision: 'Approved', status: 'Auto-Approved',     nurse: '—',                    submitted: '2026-07-12', tatH: 0.2, cost: 2100,   tags: ['auto','onTrack'] },
  { authId: 'AUTH-4512', member: 'Lopez, Carlos',      procedure: 'Liver Transplant Eval',    serviceType: 'Inpatient',  decision: 'Pending',  status: 'MD Review',        nurse: '—',                    submitted: '2026-07-07', tatH: 5.2, cost: 142000, tags: ['pending','mdReview','p2p','atRisk'] },
  { authId: 'AUTH-4513', member: 'Martin, Nicole',     procedure: 'Echocardiogram',           serviceType: 'Outpatient', decision: 'Approved', status: 'Approved',          nurse: 'Robert Kim, RN',       submitted: '2026-07-10', tatH: 1.4, cost: 2800,   tags: ['onTrack'] },
  { authId: 'AUTH-4514', member: 'Nguyen, Linda',      procedure: 'Hip Replacement',          serviceType: 'Inpatient',  decision: 'Pending',  status: 'Clinical Review',  nurse: 'Andrew Mitchell, RN',  submitted: '2026-07-11', tatH: 2.6, cost: 46000,  tags: ['pending','atRisk'] },
  { authId: 'AUTH-4515', member: 'O’Brien, Sean',      procedure: 'Sleep Study',              serviceType: 'Outpatient', decision: 'Denied',   status: 'Denied',           nurse: 'Jessica Williams, RN', submitted: '2026-07-08', tatH: 2.0, cost: 3600,   tags: ['incompleteDoc'] },
  { authId: 'AUTH-4516', member: 'Patel, Rina',        procedure: 'Bariatric Surgery',        serviceType: 'Inpatient',  decision: 'Partial',  status: 'Partial Approval', nurse: 'Emily Chen, RN',       submitted: '2026-07-09', tatH: 3.1, cost: 58000,  tags: ['mdReview'] },
  { authId: 'AUTH-4517', member: 'Quinn, Thomas',      procedure: 'Chemotherapy Cycle',       serviceType: 'Outpatient', decision: 'Approved', status: 'Approved',          nurse: 'Maria Gonzalez, RN',   submitted: '2026-07-10', tatH: 1.8, cost: 34000,  tags: ['onTrack'] },
  { authId: 'AUTH-4518', member: 'Reed, Katherine',    procedure: 'MRI Lumbar Spine',         serviceType: 'Outpatient', decision: 'Pending',  status: 'Intake',           nurse: '—',                    submitted: '2026-07-11', tatH: 0.8, cost: 2600,   tags: ['pending','unassigned'] },
  { authId: 'AUTH-4519', member: 'Silva, Antonio',     procedure: 'Cataract Surgery',         serviceType: 'Outpatient', decision: 'Approved', status: 'Auto-Approved',     nurse: '—',                    submitted: '2026-07-12', tatH: 0.2, cost: 4200,   tags: ['auto','onTrack'] },
  { authId: 'AUTH-4520', member: 'Thompson, James',    procedure: 'Spinal Fusion (2-level)',  serviceType: 'Inpatient',  decision: 'Pending',  status: 'Pending P2P',      nurse: 'Andrew Mitchell, RN',  submitted: '2026-07-08', tatH: 4.6, cost: 98000,  tags: ['pending','p2p','mdReview','atRisk'] },
  { authId: 'AUTH-4521', member: 'Underwood, Beth',    procedure: 'Wound Care (OON)',         serviceType: 'Outpatient', decision: 'Pending',  status: 'OON Review',       nurse: 'Robert Kim, RN',       submitted: '2026-07-11', tatH: 1.5, cost: 7400,   tags: ['pending','oon','rfi'] },
  { authId: 'AUTH-4522', member: 'Valdez, Hector',     procedure: 'Neurology Consult (OON)',  serviceType: 'Outpatient', decision: 'Pending',  status: 'OON Review',       nurse: 'Jessica Williams, RN', submitted: '2026-07-10', tatH: 1.9, cost: 5200,   tags: ['pending','oon'] },
  { authId: 'AUTH-4523', member: 'Williams, Sarah',    procedure: 'NICU Stay (21 days)',      serviceType: 'Inpatient',  decision: 'Pending',  status: 'Concurrent Review',nurse: 'Emily Chen, RN',       submitted: '2026-07-05', tatH: 6.0, cost: 198000, tags: ['pending','atRisk','mdReview'] },
  { authId: 'AUTH-4524', member: 'Young, Grace',       procedure: 'Diagnostic Mammogram',     serviceType: 'Outpatient', decision: 'Approved', status: 'Auto-Approved',     nurse: '—',                    submitted: '2026-07-12', tatH: 0.1, cost: 900,    tags: ['auto','onTrack'] },
];
