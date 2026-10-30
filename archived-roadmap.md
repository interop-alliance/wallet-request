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

### WR-4: `WalletOnboardingQuery` carries the account DID, with the base server URL as an optional convenience

- status: done (2026-10-29)
- priority: medium
- labels: onboarding, wire-contract, breaking
- discovered-from: WCL-140 (was-client, 2026-10-28); re-scoped 2026-10-29 to
  was-client decision 0003, which superseded 0002
- blocked-by: WC-307 (wallet-core's port, whose `{ did, spaceUrl? }` pointer and
  DID inverse this query is read into)
- acceptance:
  - [x] `WalletOnboardingQuery` and the request shape
        `walletOnboardingRequestOf` builds carry `did` and an optional
        `baseServerUrl`, and no longer have `host` or `spaceId` (was-client
        decision 0003 rule 7, 2026-10-29). The member name `baseServerUrl`
        matches the spec's "base server URL" and the was-client constructor
        option
  - [x] `onboarding.ts` validates `baseServerUrl` the way it validates `host`
        today (an absolute http(s) URL; a missing trailing slash is accepted and
        serialized with one, as the client does) and the predicate in
        `queryPredicates.ts` follows; a query whose `did` does not resolve under
        the given base is a mismatch the reader reports, not a value the reader
        trusts
  - [x] `ephemeralExchange.ts` and its tests build and read the new shape;
        README documents it and says the base is a convenience (the DID alone
        locates the account; the base saves the reader one inverse)

The one consumer site in this package is `ephemeralExchange.ts`. On
implementation (2026-10-29) it turned out to be generic over the stored request
and to name the query only in its header comment and an opaque test fixture, so
the shape change touched `onboarding.ts`, `types.ts`, their tests, and the
`processRequest` fixture.

was-client decision 0003 (2026-10-29,
`decisions/0003-server-layout-is-fixed-under-a-base-server-url.md` in
was-client) superseded 0002 before this repo ported to it. The spec now fixes
the server-level layout under one base server URL (`{base}service`,
`{base}spaces/`, `{base}space/{space_id}/`), the client is built from
`{ baseServerUrl }`, and a did:webvh minted by wallet-core encodes the base's
path segments, so the DID resolves to its log, its Space URL and its base with
nothing else stored. The onboarding query therefore carries the DID as the
pointer. The base rides along only so a reader can build its client without
first inverting the DID; it is the same value `host` held when the server is
mounted at an origin root, and the full mount prefix otherwise. `spaceId` leaves
because the DID carries it.

---

### WR-5: The root entry pays for was-client's `paths` graph to validate one URL

- status: done (2026-10-30)
- priority: low
- labels: onboarding, dependencies, import-weight
- touches:
  - was-client: WCL-149 (done 2026-10-30; `@interop/was-client/paths/layout`,
    the dependency-free part of `./paths` carrying `canonicalBaseServerUrl`,
    ships in was-client 0.103.0 and is named in its ARCHITECTURE.md)
  - this repo's ARCHITECTURE.md: updated in this item (the `onboarding.ts` edge
    in the module graph and invariant 4 name `paths/layout`)
- acceptance:
  - [x] Importing this package's root entry under plain Node ESM no longer loads
        `@interop/storage-core` or `@interop/zcap` on behalf of
        `serializedBaseServerUrl`
  - [x] `onboarding.ts` imports `canonicalBaseServerUrl` from
        `@interop/was-client/paths/layout` (one rule, not a local copy), and the
        dependency range names a was-client that has it (0.103.0 or later)
  - [x] ARCHITECTURE.md names the subpath consumed and why it is the light one

Context: WR-4 made `onboarding.ts` import `canonicalBaseServerUrl` from
`@interop/was-client/paths`, so that the base server URL an inviter publishes is
validated by the same rule the enrollee's `WasClient` constructor applies. That
subpath is a leaf in was-client's export map and does not load the client
itself, but its own graph (`internal/paths`, `internal/reserved`,
`internal/rootCapability`, `errors`) imports `@interop/storage-core` for the
reserved-id lists and problem types, and `@interop/zcap` for the root-capability
helpers. was-client declares `sideEffects: false`, so a bundler shakes those
away, but under plain Node ESM the whole graph loads on first import of this
package's root entry, and every root consumer pays it whether or not it ever
composes or classifies a `WalletOnboardingQuery`. The `./matching` leaf is
unaffected: it does not import `onboarding.ts`.

Re-stating the rule locally is not an option (one rule, owned upstream). The
upstream half is done: was-client's WCL-149 (2026-10-30) split the layout
grammar out as `./paths/layout`, whose static closure holds no external package.
What remains here is to import from that subpath instead of `./paths` once
was-client 0.103.0 is published, and to update the module-graph note. Filed from
the /simplify pass of 2026-10-30 as a skipped efficiency finding;
discovered-from: WR-4.

### WR-6: Follow the Portable Web Spaces rename

- status: done (2026-10-30)
- priority: low
- labels: pws, deps, breaking
- discovered-from: dcw DCW-109 (2026-10-30)
- touches:
  - this repo: updated in this item (`package.json`, `src/onboarding.ts`,
    `src/walletInput.ts`, `test/node/walletInput.test.ts`, ARCHITECTURE.md; also
    AGENTS.md, README.md, ROADMAP.md, `test/node/onboarding.test.ts`, the
    `pws.example` test fixtures, and the WAS doc comments in
    `src/ephemeralExchange.ts`, `src/index.ts`, and `src/types.ts`)
  - dcw: DCW-112 (`app/screens/AddScreen/AddScreen.tsx`, `package.json`);
    ARCHITECTURE.md and AGENTS.md name none of the renamed items
  - freewallet: FW-700 (`src/lib/resolveWalletInput.ts`, `package.json`,
    ARCHITECTURE.md, AGENTS.md)
  - app-connect-spec: updated in this item (the wallet-core row of the parties
    registry in AGENTS.md); the encrypted-collections and PWS registries do not
    name this package
  - unaffected: was-react (uses none of the classifier API and already depends
    on `@interop/pws-client`, which satisfies the new peer range)
  - unaffected: did-cli-typescript (uses none of the classifier API and already
    depends on `@interop/pws-client`, which satisfies the new peer range)
- acceptance:
  - [x] `package.json` moves `@interop/was-client` to `@interop/pws-client`, and
        `onboarding.ts` imports `canonicalBaseServerUrl` from
        `@interop/pws-client/paths/layout`
  - [x] `WalletInputRecognizers.isWasLink` becomes `isPwsLink`, the `wasLink`
        handler becomes `pwsLink`, and the `was-link` classification kind
        becomes `pws-link`, with no alias kept
  - [x] The doc comments name wallet-core's `isPwsLinkPayload` in place of
        `isWasLinkPayload`, and ARCHITECTURE.md names the new subpath

Context: this package still carries the old Wallet Attached Storage names after
the rest of the ecosystem moved to Portable Web Spaces. It depends on
`@interop/was-client` for one function, so every wallet that takes it installs a
retired client package beside `@interop/pws-client`. Its input classifier still
offers `isWasLink`, `wasLink`, and `was-link`, while the predicate wallets
inject there is already wallet-core's `isPwsLinkPayload`, so both wallets write
`isWasLink: isPwsLinkPayload`. The renames are code-only and the classifier's
kinds reach no wire format, but they break consumers, so dcw and freewallet
follow in the same release train.
