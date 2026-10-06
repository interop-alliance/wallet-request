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
