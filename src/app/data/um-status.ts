// Canonical UM Status -> Next Best Action (NBA) model, mirroring the real
// Zyter/NextGen UM app (single source used across the dashboard).

export const STATUS_NBA: Record<string, string> = {
  'Draft': 'Resume Intake',
  'Received': 'Validate Intake',
  'Ready for Review': 'Initial Review',
  'Concurrent Review': 'Concurrent Review',
  'Pending MD Review': 'MD Review',
  'Pending Information': 'Follow Up RFI',
  'Pending Peer-to-Peer': 'P2P',
  'Pending Review': 'Resume Review',
  'Pending OON Review': 'OON Provider Review',
  'Pending Notification': 'Generate Notification',
  'Pending Determination': 'Determination',
  'Pending Eligibility': 'Review Eligibility',
  'Approved': 'None – Completed',
  'Partially Approved': 'None – Completed',
  'Denied': 'None – Completed',
  'Discharged': 'None – Completed',
};

export function nbaFor(status: string): string {
  return STATUS_NBA[status] ?? '—';
}
