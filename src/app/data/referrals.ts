// Shared UM <-> CM referral list, surfaced on both the UM screen (outgoing)
// and the CM screen (incoming).

export interface Referral {
  authId: string;
  member: string;
  reason: string;
  fromStage: string;   // UM stage the referral originated from
  received: string;
  sla: string;
  slaTone: 'green' | 'amber' | 'red';
  status: string;
  assignedTo: string;
}

export const REFERRALS: Referral[] = [
  { authId: 'IP540088', member: 'George Pike',   reason: 'Transplant — complex care coordination', fromStage: 'UM · MD Review',       received: '2026-07-16', sla: 'Intake due 1d', slaTone: 'amber', status: 'Pending intake',       assignedTo: 'Unassigned' },
  { authId: 'IP539774', member: 'Nina Patel',    reason: 'Oncology — high-dollar, symptom mgmt',    fromStage: 'UM · Concurrent',      received: '2026-07-15', sla: 'Intake due 2d', slaTone: 'green', status: 'Pending intake',       assignedTo: 'Unassigned' },
  { authId: 'IP543902', member: 'Robert Hayes',  reason: 'ICU step-down — transitional care',       fromStage: 'UM · Clinical Review', received: '2026-07-15', sla: 'Overdue',       slaTone: 'red',   status: 'Assessment scheduled', assignedTo: 'Maria Torres, RN' },
  { authId: 'OP329910', member: 'Frank Doyle',   reason: 'Denied auth — appeal + CM support',       fromStage: 'UM · OON Review',      received: '2026-07-14', sla: 'Intake due 3d', slaTone: 'green', status: 'Pending intake',       assignedTo: 'Unassigned' },
  { authId: 'IP542119', member: 'Karen Wells',   reason: 'High-risk discharge — care mgmt referral', fromStage: 'UM · Clinical Review', received: '2026-07-13', sla: 'On track',      slaTone: 'green', status: 'Care plan active',     assignedTo: 'Sara Nguyen, RN' },
  { authId: 'IP523344', member: 'Marcus Webb',   reason: 'ESRD — complex care management',          fromStage: 'UM · Concurrent',      received: '2026-07-12', sla: 'On track',      slaTone: 'green', status: 'Care plan active',     assignedTo: 'Sara Nguyen, RN' },
];
