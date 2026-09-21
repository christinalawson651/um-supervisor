import { Injectable, inject } from '@angular/core';
import { Interaction } from './interaction';
import { Members } from './members';
import { CASE_POOL } from '../data/case-pool';
import { CM_CASE_POOL } from '../data/cm-case-pool';
import { CM_REFERRAL_INTAKE } from '../data/cm-intake';
import { COLUMNS, toRow } from './metrics';

/** Opens whatever an Assignment History row points at.
 *
 *  One history list carries UM and CM activity together, so a reference can be an authorization, a
 *  CM case, or a referral for a member who has been referred but has no case yet. Rather than each
 *  surface guessing, every reference is self-identifying by prefix and this resolver routes it:
 *
 *    AUTH-…  an authorization        → the shared case drilldown
 *    CM-…    a care-management case  → the case, with its member and care manager
 *    REF-…   a referral              → the referral, which is what exists before a case does
 *
 *  Referrals matter here precisely because they are the gap: reassigning intake work moves
 *  something real that has no case number yet, and recording only the member would lose which
 *  referral was handed over. */
@Injectable({ providedIn: 'root' })
export class HistoryRefs {
  private ix = inject(Interaction);
  private members = inject(Members);

  /** @param closeDrawerFirst set when called from inside a drawer, so the drawer does not sit over
   *  whatever is opened next. */
  open(ref: string, closeDrawerFirst = true) {
    if (closeDrawerFirst) this.ix.closeDrawer();
    if (ref.startsWith('AUTH-')) return this.openAuth(ref);
    if (ref.startsWith('CM-')) return this.openCmCase(ref);
    if (ref.startsWith('REF-')) return this.openReferral(ref);
    this.ix.toast(`${ref} is not a reference this view can open.`, 'info');
  }

  openMember(name: string, closeDrawerFirst = true) {
    if (closeDrawerFirst) this.ix.closeDrawer();
    this.members.openByName(name);
  }

  private openAuth(authId: string) {
    const c = CASE_POOL.find((x) => x.authId === authId);
    if (!c) return this.notFound(authId);
    this.ix.openExplorer({
      title: authId,
      context: `${c.member} · ${c.procedure} · ${c.status}`,
      columns: COLUMNS, rows: [toRow(c)],
      exportName: `auth-${authId}`, memberColumn: COLUMNS.indexOf('Member'),
    });
  }

  private openCmCase(caseNumber: string) {
    const c = CM_CASE_POOL.find((x) => x.caseNumber === caseNumber);
    if (!c) return this.notFound(caseNumber);
    this.ix.openDrawer({
      title: caseNumber,
      subtitle: `${c.member} · ${c.program}`,
      badge: { text: c.stage, tone: c.queueBreached ? 'red' : 'blue' },
      fields: [
        { label: 'Member', value: c.member },
        { label: 'Member ID', value: c.memberId },
        { label: 'Case type', value: c.caseType },
        { label: 'Care manager', value: c.careManager },
        { label: 'Programme', value: c.program },
        { label: 'Lifecycle stage', value: c.stage },
        { label: 'Queue', value: c.queue ?? 'Not queued' },
        { label: 'Risk', value: `${c.riskScore} · ${c.riskLevel}` },
        { label: 'Care plan', value: c.carePlanStatus },
        { label: 'Next SLA milestone', value: c.slaDueDate, tone: c.queueBreached ? 'red' : undefined },
      ],
      actions: [{ label: 'Open member chart', tone: 'teal', run: () => this.members.openByName(c.member) }],
    });
  }

  private openReferral(referralId: string) {
    const r = CM_REFERRAL_INTAKE.find((x) => x.id === referralId);
    if (!r) return this.notFound(referralId);
    this.ix.openDrawer({
      title: referralId,
      subtitle: `${r.member} · referred via ${r.source}`,
      badge: { text: r.status, tone: r.status === 'Accepted' ? 'green' : r.status === 'Pending' ? 'amber' : 'red' },
      fields: [
        { label: 'Member', value: r.member },
        { label: 'Status', value: r.status },
        { label: 'Referral reason', value: r.reason },
        { label: 'Case type at intake', value: r.caseType },
        { label: 'Source', value: r.source },
        { label: 'Received', value: r.received },
        { label: 'Line of business', value: r.lob },
        { label: 'Working this referral', value: r.intakeCoordinator ?? 'Unassigned' },
        // Only set once the clinical accept decision is made, so its absence is information.
        { label: 'Care manager', value: r.careManager ?? 'Not yet accepted — no case opened' },
        ...(r.pendReason ? [{ label: 'Pending because', value: r.pendReason, tone: 'amber' as const }] : []),
      ],
      note: r.careManager
        ? undefined
        : 'This referral has not been accepted, so no care-management case exists for it yet. That is why history recorded the referral rather than a case number.',
      actions: [{ label: 'Open member chart', tone: 'teal', run: () => this.members.openByName(r.member) }],
    });
  }

  private notFound(ref: string) {
    this.ix.toast(`${ref} is not in the current data set.`, 'info');
  }
}
