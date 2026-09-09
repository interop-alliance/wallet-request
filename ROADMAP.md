# Wallet Request Roadmap (open items)

Status as of 2026-09-09. Uses the formalized item structure shared with the
freewallet and was-teaching-server roadmaps.

Scope: open work items only. This document tracks the **remaining** items;
completed items move verbatim to [archived-roadmap.md](archived-roadmap.md) as
they land, so WR-N references keep resolving (CHANGELOG.md remains the record of
what landed).

## Item format

Each work item is a `### WR-N: Title` heading followed by a field block and free
prose context. Ids are permanent and never reused; new items take the next
unused number regardless of section. Statuses: `todo`, `in-progress`, `draft`
(no actionable done-state yet -- blocked externally or a parking record); `done`
items move to [archived-roadmap.md](archived-roadmap.md) once shipped. Full
conventions live in [AGENTS.md](AGENTS.md) under "Roadmap & Task Conventions".

---

### WR-1: sendToExchanger checks response.ok

- status: todo
- priority: medium
- labels: request, correctness
- touches:
  - [ ] dcw (three sendToExchanger call sites navigate on the result --
        navigationUtil.ts:106, ExchangeCredentials.tsx:137, exchanges.ts:269;
        each needs a user-facing failure path for the new non-ok throw)
  - [ ] dcw ARCHITECTURE.md / AGENTS.md (exchange error discipline)
  - [ ] unaffected: freewallet (no sendToExchanger usage; it POSTs via
        submitPresentation)
- acceptance:
  - [ ] `exchangeClient.ts:333-339` throws a descriptive error on `!response.ok`
        (matching `postToExchange`, lines 88-93) instead of returning null or a
        bare SyntaxError from an HTML error body
  - [ ] Tests pin non-ok behavior (currently only 200 cases are covered)

CONFIRMED. A 403/500 with an empty body returns null indistinguishably from a
completed exchange, and DCW's callers treat that as delivery and navigate on it.

Re-homed from wallet-core's roadmap (WC-73) on 2026-09-09.

---

### WR-2: classifyWalletInput never throws on hostile input

- status: todo
- priority: medium
- labels: request, correctness
- touches:
  - [ ] freewallet (handleWalletInput caller; the refusal it renders for a
        hostile paste/QR changes, and resolveWalletInput.ts:73 matches the
        dispatcher's message text)
  - [ ] freewallet ARCHITECTURE.md / AGENTS.md (the one-door wallet-input
        classification described for the paste box / scanner)
  - [ ] dcw (handleWalletInput caller in AddScreen; also calls
        isDIDAuthOnlyRequest directly on a possibly-null exchanger response)
  - [ ] dcw ARCHITECTURE.md / AGENTS.md (scan/paste routing)
  - [ ] Decide and record whether the classifier gains a new WalletInput kind (a
        handler-map change in both apps) or routes to `credentials`
- acceptance:
  - [ ] `parse.ts:176`: `isDIDAuthOnlyRequest` guards a null/non-object
        `verifiablePresentationRequest` (returns false) instead of throwing a
        destructuring TypeError
  - [ ] `walletInput.ts:160`: a throw from `parseWalletApiMessage` (e.g.
        `assertSingleDIDAuthQuery` on duplicate DIDAuthentication queries,
        `classify.ts:186-188`) is normalized at the classifier boundary into the
        malformed-request refusal, preserving the module header's "nothing is
        classified as unrecognized" invariant
  - [ ] Tests: `{"verifiablePresentationRequest": null}` and a VPR with two
        DIDAuthentication queries, both via `classifyWalletInput`

CONFIRMED (both; the null destructure verified by execution). A hostile QR or
paste reaches both paths through the wallet-api-message branch and today escapes
with raw developer-facing errors before any handler runs.

Re-homed from wallet-core's roadmap (WC-74) on 2026-09-09.
