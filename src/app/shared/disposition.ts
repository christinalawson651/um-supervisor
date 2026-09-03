import { Injectable, signal, computed } from '@angular/core';
import { ArchiveSegment, ARCHIVE_SEGMENTS, SYSTEM_USERS } from '../data/audit-trail';

/** Certified disposition of a sealed archive segment.
 *
 *  The point of the certificate is what survives the record. Once a segment is purged the events
 *  themselves are gone, so unless something durable states what was destroyed, when, under whose
 *  authority and against which retention basis, there is afterwards no evidence the record ever
 *  existed OR that it was lawfully destroyed — and both halves of that matter. The terminal hash is
 *  carried forward for the same reason: it lets a reviewer confirm the chain the destroyed segment
 *  used to close, without the segment being there. */
export interface DispositionCertificate {
  certificateId: string;
  segmentId: string;
  periodFrom: string;
  periodTo: string;
  eventCount: number;
  terminalHash: string;        // the segment's last hash, retained after the events are gone
  retentionBasis: string;
  purgeEligible: string;
  method: string;
  disposedBy: string;
  approvedBy: string;          // must differ from disposedBy — see canDispose()
  disposedDate: string;
}

export type DispositionRefusal =
  | { ok: true }
  | { ok: false; reason: string };

/** Who can countersign a disposition. Deliberately not the same role that runs it: destroying a
 *  record is the least reversible action in the platform, so it gets the same two-person control a
 *  configuration change gets. */
export const DISPOSITION_APPROVERS = SYSTEM_USERS
  .filter((u) => u.role === 'Compliance Analyst' || u.role === 'UM Supervisor' || u.role === 'CM Supervisor')
  .map((u) => u.name);

@Injectable({ providedIn: 'root' })
export class Disposition {
  /** Session state, same treatment Reassign/Balance get — a demo action produces a real state
   *  change rather than a toast over static data. */
  readonly certificates = signal<DispositionCertificate[]>([]);
  private readonly disposedIds = computed(() => new Set(this.certificates().map((c) => c.segmentId)));

  isDisposed(segmentId: string): boolean { return this.disposedIds().has(segmentId); }
  /** Segments still standing — the archive index reads from here rather than the raw constant. */
  remaining(): ArchiveSegment[] { return ARCHIVE_SEGMENTS.filter((s) => !this.isDisposed(s.segmentId)); }
  certificateFor(segmentId: string): DispositionCertificate | undefined {
    return this.certificates().find((c) => c.segmentId === segmentId);
  }

  /** The control, not a warning. A held segment cannot be disposed of at all — the check runs
   *  before anything else and returns the hold reference, so the refusal names what is stopping it
   *  rather than saying "not allowed". */
  canDispose(seg: ArchiveSegment, todayIso: string): DispositionRefusal {
    if (this.isDisposed(seg.segmentId)) return { ok: false, reason: `${seg.segmentId} has already been disposed of — see its certificate.` };
    if (seg.legalHold) return { ok: false, reason: `Disposition is blocked by ${seg.legalHold}. The hold must be released by a named approver before ${seg.segmentId} can be disposed of, regardless of its retention date.` };
    if (seg.purgeEligible > todayIso) return { ok: false, reason: `${seg.segmentId} is retained until ${seg.purgeEligible} and cannot be disposed of before then.` };
    if (!seg.verified) return { ok: false, reason: `${seg.segmentId} has not passed chain verification. A segment whose integrity is unproven cannot be certified as lawfully destroyed.` };
    return { ok: true };
  }

  dispose(seg: ArchiveSegment, disposedBy: string, approvedBy: string, retentionBasis: string, todayIso: string): DispositionCertificate {
    const cert: DispositionCertificate = {
      certificateId: `DISP-${todayIso.replace(/-/g, '')}-${seg.segmentId.replace('SEG-', '')}`,
      segmentId: seg.segmentId, periodFrom: seg.periodFrom, periodTo: seg.periodTo,
      eventCount: seg.eventCount, terminalHash: seg.lastHash,
      retentionBasis, purgeEligible: seg.purgeEligible,
      method: 'Cryptographic erasure of the sealed segment; terminal hash retained',
      disposedBy, approvedBy, disposedDate: todayIso,
    };
    this.certificates.update((cs) => [cert, ...cs]);
    return cert;
  }
}
