# Centene Auth Orchestrator — architecture of record

Captured 16 September 2026 from Centene's integration slides (Auth Orchestrator, Auth RTR).
This is **Centene's design, not ours** — recorded here because it determines what Zyter can and
cannot claim about authorization data, and every reporting conversation depends on it.

## Shape

    Cohere ─┐                    ┌─ Membership & Eligibility
    Zyter  ─┼─▶ Submit Auth API ─┼─ Provider Wrapper          ─▶ Publish Auth ─▶ Kafka ─┐
    Legacy ─┘        │           └─ Rules Engine                                        │
                     │                                                                  │
                     └────────────── Auth RTR (repository) ─────────────────────────────┘
                                                                                        │
                            ┌───────────────────────────────────────────────────────────┘
                            ▼
                Routing consumers → per-vendor adapters → Cohere · Zyter · Legacy Vendor

**Three submitters, not two.** Cohere, Zyter and a legacy vendor all submit through the same API.
Zyter is a peer on this bus, not the hub.

**Centene owns the middle.** The orchestrator, the rules engine, the membership/eligibility and
provider services, and the Auth RTR repository are all Centene's. Publication is event-driven over
Kafka, with a consumer and an adapter per vendor.

**The loop closes.** Zyter saves changes back to the orchestrator (`Save Changes` on the
Auth Orchestrator slide), so our determinations return to Centene's record.

## Integration facts

| | Auth Orchestrator | Auth RTR |
| --- | --- | --- |
| Integration name | Authorization Router | Authorization Data |
| Description | Event-driven intake and router | Authorization data lookup and submission within the RTR repository |
| Source → target | Multiple → Cohere, Zyter | Auth RTR → Cohere, Zyter |
| Directionality | Outbound from Centene | *(blank on the slide)* |
| Service provider | Centene | Centene |
| Type / format | REST / JSON | REST / JSON |
| Performance | Millisecond | Millisecond |
| Connection path | Axway | Axway |
| Security | HTTP over SSL | HTTP over SSL |
| Auditing and logging | Dynatrace | Dynatrace |
| Error and exception | Kafka | **TBD** |
| Reconciliation | **TBD** | **TBD, on Vendor** |
| Notes | Auths can contain notes and documents | "Zyter Temp Member Auths" |

The Auth RTR exposes a CRUD API to multiple clients (Client 1, Client 2, …) — it is a shared
repository, not a Zyter-specific store.

## What this means for reporting

**The Auth RTR is the system of record for authorizations. TruCare holds a complete copy.**
Those are different claims and the difference matters in front of a client:

- *Can* say: we see every authorization, including those Cohere auto-decided, and we can report
  across the whole population.
- *Cannot* say: we are the source of truth for Centene's authorization numbers. If our figure and
  the RTR's figure disagree, the RTR wins.

That splits reporting into two scopes, and they should be labelled differently on every artefact:

1. **Enterprise authorization reporting** — the full population, all submitters. The authoritative
   source is the RTR, reachable through its CRUD API.
2. **Zyter workflow reporting** — what our users did: reviews, our determinations, workload,
   our handling time, appeals, the clinical audit trail. Unambiguously ours, and this is where the
   ~70 report definitions live.

### Five things the slides expose

**1. Reconciliation is TBD in both documents — and "on Vendor" in one.** With Kafka between the
repository and our copy, divergence is not hypothetical: consumer lag, a failed adapter, a replayed
event. Reporting from a diverged copy is exactly how two numbers appear. Control totals per publish
batch, plus a periodic count-and-checksum against the RTR, is the whole fix and it is cheap now.
Note that "TBD, on Vendor" reads as Centene expecting *us* to own it — accept that knowingly or
push back, but do not discover it later.

**2. Dynatrace is observability, not a business audit trail.** It records that an API call happened
and how long it took. It does not record who changed which clinical field, what it said before, what
the AI proposed, or what the clinician submitted instead. **That is our audit trail, and it is not
duplicated anywhere in this architecture.** Worth saying plainly — it is a genuine gap that we
already fill.

**3. Errors route to Kafka — so failed publishes are auths that exist in the RTR and never reached a
vendor.** They are invisible to vendor-side reporting and nobody is working them. That needs a
report, and an owner, and it is a compliance exposure rather than an ops nicety.

**4. The authoritative receipt timestamp belongs to the orchestrator, not to any submitter.** The
regulatory clock runs from plan receipt, which is `Submit Auth API`. Ask for that timestamp on the
published payload — it applies to all three lanes, not just Cohere's.

**5. "Zyter Temp Member Auths."** Unexplained on the slide. Ask what a temporary member auth is,
whether it is counted, and whether it is later promoted or reconciled — it is the kind of thing that
silently distorts a denominator.

### Still needed on the published payload

Unchanged by this architecture, and now askable of Centene rather than of Cohere:

- a marker distinguishing a machine-made decision from a human one
- the basis for that decision — rule, criterion or reason code
- the orchestrator's receipt timestamp

Without the first, there is no auto-decision rate. Without the second, no oversight reporting on
machine decision-making. Without the third, every turnaround figure starts from the wrong moment.

## Open questions to put back to Centene

1. Does the published auth carry the submitting system, so we can distinguish Cohere-originated,
   Zyter-originated and legacy-originated volume?
2. Who owns reconciliation between the RTR and each vendor copy, and at what cadence?
3. What is the Kafka DLQ policy, and who reports on it?
4. What is a "temp member auth" and how does it behave in counts?
5. Does reporting run against the RTR CRUD API, against Centene's warehouse, or against our own
   copy? Each gives a different answer to who owns the numbers.
