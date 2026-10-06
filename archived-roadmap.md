# Wallet Request Roadmap -- archived (completed) items

Completed items from [ROADMAP.md](ROADMAP.md), moved here verbatim when they
ship so that item-number references (WR-N) in the active roadmap, commit
messages, and design docs keep resolving. Append-only: newest at the bottom; do
not rewrite or summarize items on the way in. Ids remain permanent and are never
reused. CHANGELOG.md stays the record of _what_ landed; this file preserves each
item's acceptance criteria and context.

---

### WR-3: Sign a response with no DID Auth query, a VPR-root `challenge`, and the signed connection request

- status: done (2026-10-06)
- priority: high
- labels: request, app-connect, agents, cross-repo
- discovered-from: freewallet FW-478 (the cleartext audiences design,
  `designs/FW-478-cleartext-audiences.md`, approved 2026-10-05; section 3
  "wallet-request" and 5.4). The proof's normative shape is app-connect-spec
  ACS-21's.
- touches:
  - [x] freewallet: FW-478 (the connect sequence is the first caller of all
        three; its N9 text and decision 0016's amendment gain the signed
        request's Data Integrity v2 `@context`); freewallet: FW-665 (its
        `composeVP.ts` wrapper passes `composeVp`'s renamed `sign` option)
  - [x] dcw: DCW-94 (`present.ts` calls `composeVp` with the renamed `sign`
        option at two sites); the `processRequest` switch is additive and DCW-93
        consumes it with the connection request
  - [x] unaffected: was-react (a subscriber receives no wallet presentation); an
        agent built on the shared builder gains the VPR-root `challenge` and
        `signCapabilityRequest`
  - [x] app-connect-spec: ACS-21 (defines the proof; its "no `@context`" wording
        becomes "the signed request carries the Data Integrity v2 `@context`; no
        JSON-LD term mapping is needed", and no rule rests on
        `interact.service`, which the VPR spec is obsoleting)
  - [x] ARCHITECTURE.md: shipped here (invariant 7, "The connection request
        proof", glossary); unaffected: AGENTS.md (no convention changes)
- acceptance:
  - [x] `processRequest` gains a switch that signs the response with the
        existing `presentationSigner` (`{ signer, holder }`) when no
        DIDAuthentication query is present. It signs over the VPR-root
        `challenge` and sets no `domain`. Without the switch, behavior is
        unchanged, so dcw is unaffected. A second signer option is not added,
        since it would have no precedence rule
  - [x] `composeCapabilityRequest` puts a `challenge` at the VPR root, beside
        the one inside the `AuthorizationCapabilityQuery`, so an agent built
        with the shared builder is not refused for lacking one
  - [x] `composeCapabilityRequest` gains an option to sign the connection
        request with the named `controller`'s key (shipped as the sibling
        `signCapabilityRequest`, so the builder stays synchronous):
        `eddsa-jcs-2022`, purpose `authentication`, the proof's `challenge`
        equal to the VPR-root `challenge`, no `domain`. JCS covers the whole
        request: the `controller`, the capability queries, `agent.name`, and any
        endpoint member present. Decided 2026-10-06: no builder option and no
        verifier rule for the presentation endpoint or the exchange URL, since
        the VPR spec is obsoleting `interact.service` and an agent does not know
        the ephemeral exchange URL when it signs; the signed request carries the
        Data Integrity v2 `@context`
  - [x] A verifier for that proof (`verifyCapabilityRequest`), checked against
        the request's named `controller`, which refuses a proof whose signed
        content omits any of those members or whose `challenge` differs from the
        VPR root's
  - [x] `composeVp` is unchanged (amended 2026-10-06: its `didAuthRequested`
        option is renamed `sign` so `processRequest` can pass the signing
        decision as a plain input; freewallet FW-665 and dcw DCW-94 carry the
        rename)
  - [x] Tests: a response signed with no DID Auth query carries the VPR-root
        `challenge` and no `domain`; the unswitched path still signs only under
        DID Auth; the builder's request round-trips through the verifier; a
        request signed by a key other than the named `controller`, and one with
        the `challenge` moved out of the VPR root, are refused
  - [ ] Published as a release before freewallet takes it (0.5.0, pending the
        manual publish)

Context: FW-478's connect sequence answers a subscription agent's
interaction-URL request with a response presentation signed by the wallet's
pairwise did:key toward that agent, outside the DID Auth dispatch (freewallet
decision 0016's amendment). The agent verifies that proof against the `holder`
before delegating anything to that did:key. The request itself is signed by the
agent, so a wallet is not tricked into minting a pairwise key toward a party
that never asked. Today the response is signed only when a DIDAuthentication
query is present, the builder puts `challenge` inside the capability query where
the wallet's precheck does not read it, and no request proof exists.

---

### WR-1: sendToExchanger checks response.ok

- status: done (2026-10-06)
- priority: medium
- labels: request, correctness
- touches:
  - [x] dcw (three sendToExchanger call sites navigate on the result --
        navigationUtil.ts:106, ExchangeCredentials.tsx:137, exchanges.ts:269;
        each needs a user-facing failure path for the new non-ok throw) --
        already shipped: dcw pins `@interop/wallet-request` ^0.4.1, and every
        call site runs inside a catch handler that surfaces the throw
        (`redirectInteractionUrl` rethrows as `HumanReadableError`; the
        ExchangeCredentials confirm handler shows an "Unable to Complete
        Exchange" modal via `errorMessageFrom`, which also covers
        `processMessageChain`'s send)
  - [x] unaffected: dcw ARCHITECTURE.md / AGENTS.md (neither documents an
        exchange error discipline; the throw lands in the existing
        `HumanReadableError` / `errorMessageFrom` handlers, so there is no new
        rule to record)
  - [x] unaffected: freewallet (no sendToExchanger usage; it POSTs via
        submitPresentation)
- acceptance:
  - [x] `exchangeClient.ts:333-339` throws a descriptive error on `!response.ok`
        (matching `postToExchange`, lines 88-93) instead of returning null or a
        bare SyntaxError from an HTML error body
  - [x] Tests pin non-ok behavior (currently only 200 cases are covered)

CONFIRMED. A 403/500 with an empty body returns null indistinguishably from a
completed exchange, and DCW's callers treat that as delivery and navigate on it.

Re-homed from wallet-core's roadmap (WC-73) on 2026-09-09.

Shipped in 0.2.0 (2026-09-09): `sendToExchanger` shares `postToExchange`, whose
`assertExchangeResponseOk` reports a 404 as `EphemeralExchangeGoneError` and
throws on any other non-2xx status; `test/node/exchange.test.ts` pins the 404,
500, malformed-JSON, and empty-body cases. Closed 2026-10-06 once the dcw call
sites were confirmed to handle the throw.

---

### WR-2: classifyWalletInput never throws on hostile input

- status: done (2026-10-06)
- priority: medium
- labels: request, correctness
- touches:
  - [x] freewallet (handleWalletInput caller; the refusal it renders for a
        hostile paste/QR changes, and resolveWalletInput.ts:73 matches the
        dispatcher's message text) -- freewallet: FW-666 (wires a
        `malformedRequest` handler that renders the refusal from `cause`)
  - [x] freewallet ARCHITECTURE.md / AGENTS.md (the one-door wallet-input
        classification described for the paste box / scanner) -- freewallet:
        FW-666 (neither file describes the classification today; the item adds
        it with the eight kinds)
  - [x] dcw (handleWalletInput caller in AddScreen; also calls
        isDIDAuthOnlyRequest directly on a possibly-null exchanger response) --
        dcw: DCW-96 (wires a `malformedRequest` handler in AddScreen and checks
        the direct `isDIDAuthOnlyRequest` callers; the null-response guard
        already ships in `isDIDAuthOnlyRequest`)
  - [x] dcw ARCHITECTURE.md / AGENTS.md (scan/paste routing) -- dcw: DCW-96
  - [x] Decide and record whether the classifier gains a new WalletInput kind (a
        handler-map change in both apps) or routes to `credentials` -- decided:
        a new kind, `malformed-request` (`{ kind, text, cause }`, handler slot
        `malformedRequest`), not routed to `credentials`. The text is a request,
        and the credentials resolver's error would misdescribe it and lose the
        reason. Recorded in ARCHITECTURE.md (the classifier section, invariant
        12, the glossary)
- acceptance:
  - [x] `parse.ts:176`: `isDIDAuthOnlyRequest` guards a null/non-object
        `verifiablePresentationRequest` (returns false) instead of throwing a
        destructuring TypeError
  - [x] `walletInput.ts:160`: a throw from `parseWalletApiMessage` (e.g.
        `assertSingleDIDAuthQuery` on duplicate DIDAuthentication queries,
        `classify.ts:186-188`) is normalized at the classifier boundary into the
        malformed-request refusal, preserving the module header's "nothing is
        classified as unrecognized" invariant
  - [x] Tests: `{"verifiablePresentationRequest": null}` and a VPR with two
        DIDAuthentication queries, both via `classifyWalletInput`

CONFIRMED (both; the null destructure verified by execution). A hostile QR or
paste reaches both paths through the wallet-api-message branch and today escapes
with raw developer-facing errors before any handler runs.

Re-homed from wallet-core's roadmap (WC-74) on 2026-09-09.

---
