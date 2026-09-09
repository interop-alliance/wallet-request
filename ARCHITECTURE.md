# Architecture

The current shape of this library, with the rationale inline: why each part is
shaped the way it is, stated where the shape is described. This file is kept
current in the same change set that alters the shape; it overwrites in place and
records no history. History lives elsewhere: CHANGELOG.md for what landed,
`decisions/` for durable decisions with their rejected alternatives and revisit
criteria, and the archived roadmap for the work items. Reference decision
records from here where the resulting shape is described, instead of re-arguing
them.

Several conventions lean on this file, so keep it accurate and current: the
design gate defines a cross-cutting item as one touching an invariant documented
here, a `touches:` entry names this file as a deliverable in its own right, and
the breaking-release audit checks its statements against the code.

## What this library is

`@interop/wallet-request` is the wallet side of a Verifiable Presentation
Request exchange, from "the user scanned or pasted something" to "here is the
signed response". It was extracted from `@interop/wallet-core`'s `request`
subpath and keeps that origin's dependency direction: this package depends on
nothing in `@interop/wallet-core`, and `@interop/wallet-core` imports nothing
from here.

Two properties hold everywhere in `src/`:

- **No I/O of its own, except where injected.** Classification (`walletInput`,
  `parse`, `classify`) never fetches, navigates, or stores. The exchange clients
  (`exchangeClient`, `interactionUrl`, `ephemeralExchange`) take an injected
  `FetchLike` rather than calling `fetch` directly.
- **Pure derivation out, consent and formatting in the caller.**
  `processRequest` is pure: consent and the response channel stay with the app,
  and zcap / App Connect processing arrive as injected `RequestProcessors`.

## Layer map

Every module's internal dependencies, so a reader can tell what a change to one
file can reach. `types.ts` and `log.ts` are the only leaves with no internal
dependencies; every other module imports from lower layers only, and there are
no cycles.

```
layer 0 (no internal deps):  types            log
layer 1:                     queryPredicates  (types)
layer 2:                     classify         (types, queryPredicates)
layer 3:                     parse            (log, classify, types)
                             presentationSuite (classify, types)
                             matching         (types, classify)
                             capabilityRequest (classify, types)
                             onboarding       (queryPredicates, types)
                             ephemeralExchange (log, types)
layer 4:                     composeVp        (presentationSuite, classify,
                                                types)
                             exchangeClient   (ephemeralExchange, types)
                             interactionUrl   (log, ephemeralExchange, types)
layer 5:                     appKey           (composeVp, types)
                             processRequest   (log, classify, composeVp,
                                                presentationSuite,
                                                queryPredicates, types)
                             interactionRequest (interactionUrl,
                                                exchangeClient, types)
layer 6:                     walletInput      (interactionUrl, parse, types)
root barrel:                 index.ts re-exports every module, plus
                             setLogger / Logger from log.ts
```

| File                    | Role                                                                                                                                                                                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `types.ts`              | The VPR vocabulary re-exported from `@interop/data-integrity-core`'s `/vpr` and `/guards` subpaths, plus the request-local types: CHAPI event shapes, the VC-API exchange reply shape, the classified-request profile, and the injection-seam types `PresentationSigner` / `FetchLike` / `RequestProcessors` |
| `log.ts`                | The logging port: a local `Logger` type, `setLogger`, and a console fallback prefixed `[wallet-request]`                                                                                                                                                                                                     |
| `queryPredicates.ts`    | Import-free helpers shared by the classifiers: `isZcapQuery`, the exclusive-query-type set, and `parsedAbsoluteUrl`, the parse-and-no-fragment core every URL validator layers on top of                                                                                                                     |
| `classify.ts`           | Turns a CHAPI event or a VPR's queries into typed requests; `appConnectRequestOf` validates the `AppConnectQuery`'s `app.appUrl` against the attested requesting origin                                                                                                                                      |
| `parse.ts`              | Turns deep links and JSON into typed wallet-API messages                                                                                                                                                                                                                                                     |
| `presentationSuite.ts`  | Cryptosuite negotiation for the response VP                                                                                                                                                                                                                                                                  |
| `matching.ts`           | The QueryByExample matchers: DCW's deep matcher and freewallet's type/issuer matcher, shipped side by side                                                                                                                                                                                                   |
| `capabilityRequest.ts`  | `composeCapabilityRequest`: the zcap-only VPR a requester stores on an ephemeral exchange                                                                                                                                                                                                                    |
| `onboarding.ts`         | The `WalletOnboardingQuery` transport vocabulary: compose and classification, plus the did:webvh `did` shape check                                                                                                                                                                                           |
| `ephemeralExchange.ts`  | The requester's side of a WAS server's ephemeral exchange: create one carrying a VPR, then poll until the wallet answers                                                                                                                                                                                     |
| `composeVp.ts`          | Builds the response VP, embedding grants before signing                                                                                                                                                                                                                                                      |
| `exchangeClient.ts`     | The VC-API exchange client over an injected `FetchLike`                                                                                                                                                                                                                                                      |
| `interactionUrl.ts`     | VCALM `interaction:` URL resolution                                                                                                                                                                                                                                                                          |
| `appKey.ts`             | The App Connect app-key credential: matching, minting, the store-time refusal policy, and the legacy re-issue path                                                                                                                                                                                           |
| `processRequest.ts`     | The pure request-to-response pipeline                                                                                                                                                                                                                                                                        |
| `interactionRequest.ts` | `openInteractionRequest`: the answering wallet's one-call entry point over an interaction URL                                                                                                                                                                                                                |
| `walletInput.ts`        | `classifyWalletInput` / `handleWalletInput`: the universal "scan or paste something" classifier                                                                                                                                                                                                              |
| `index.ts`              | The root barrel; re-exports every module plus `setLogger` / `Logger`                                                                                                                                                                                                                                         |
| `declarations.d.ts`     | Ambient module declaration for `jsonld`                                                                                                                                                                                                                                                                      |

## The wallet-input classifier (`walletInput.ts`)

`classifyWalletInput` is the universal entry point for "scan or paste
something": an ordered discrimination over seven input kinds, most-specific
first, because the grammars are subsets of one another:

1. `was-link` (non-URL JSON blob)
2. `connect-code` (an account convention's prefix)
3. `legacy-request` (deep link with both `vc_request_url` and `issuer`)
4. `interaction-url` (VCALM `interaction:` scheme or `iuv=1`)
5. `deep-link` (any other registered-scheme link)
6. `wallet-api-message` (raw JSON, or a `request` parameter on a non-registered
   link)
7. `credentials` (raw VC/VP JSON or a URL to fetch) -- last, since it cannot be
   recognized positively and there is no "unrecognized" state

Classification does no fetch, navigation, or storage. `handleWalletInput`
dispatches the classified result to caller-supplied handlers; a kind with no
handler throws, so a wallet that does not implement a grammar cannot silently
mishandle it.

### The wallet-core conventions the classifier recognizes

Two of the seven grammars belong to an account convention this package does not
own, and the move out of `@interop/wallet-core` changed how the classifier
reaches them.

**The `recognizers` option.** `classifyWalletInput` and `handleWalletInput` no
longer import wallet-core's connect-code prefix or `was-link` payload shape.
They take an optional `recognizers: WalletInputRecognizers` argument
(`isWasLink`, `isConnectCode`, each `(text: string) => boolean`). An absent
recognizer means that branch never matches, the same rule `deepLinkSchemes`
already followed when empty. A wallet on a WAS account passes wallet-core's own
predicates -- `isWasLinkPayload` from `@interop/wallet-core/space` and
`isConnectCode` from `@interop/wallet-core/enrollment`.

The reasoning: the grammar keeps its one form in the package that owns the
ceremony consuming it, the dependency direction stays free of wallet-core in
either direction, and a wallet holding no WAS account has no such grammar to
route. The rejected alternative was moving the constants into this package with
wallet-core importing them back, which would have made wallet-core depend on
this package.

**The did:webvh check stays local.** `onboarding.ts`'s `WalletOnboardingQuery`
validator checks that the query's `did` starts with `did:webvh:`. That check is
a private function (`isWebvhDid`) rather than an injected recognizer, because
the prefix is the did:webvh specification's own, not a wallet convention: every
`WalletOnboardingQuery` names a did:webvh account by definition, regardless of
which wallet is asking.

## Invariants

1. **Classification order.** `classifyWalletInput`'s seven-way discrimination
   runs most-specific first (see above); reordering it changes which grammar a
   piece of ambiguous text is read as.
2. **No fetch, navigate, or store during classification.** `walletInput.ts`,
   `parse.ts`, and `classify.ts` do none of the three. The one network seam in
   the package is the exchange clients' injected `FetchLike`.
3. **The App Connect `appUrl` origin rule.** An `AppConnectQuery`'s `app.appUrl`
   must parse as an absolute URL, carry no fragment, and be same-origin with the
   attested requesting origin. An opaque origin serializes as `"null"` and is
   refused rather than compared as same-origin with itself (`classify.ts`'s
   `appConnectRequestOf`).
4. **The onboarding `host` validator is the deliberate asymmetric mirror.**
   `onboarding.ts`'s `serializedOnboardingHost` checks the scheme (must be
   `http:` or `https:`) and carries no origin check, since an exchange has no
   attested requesting origin to compare against; `appConnectRequestOf` checks
   the origin and no scheme. Both run over the one shared parse-and-no-fragment
   core, `parsedAbsoluteUrl` in `queryPredicates.ts`.
5. **One mental model per exchange.** A `WalletOnboardingQuery` refuses to mix
   with `QueryByExample`, standalone capability queries, or an
   `AppConnectQuery`; `appConnectRequestOf` refuses the mixture from its own
   side too. `queryPredicates.ts`'s exclusive-query-type set is the one place
   that mutual exclusion is defined.
6. **Grants go inside the VP before signing.** `composeVp.ts` embeds grants in
   the presentation before it is signed, so the DIDAuth proof covers them.
7. **App keys are wallet-minted, not imported.** `appKey.ts`'s store-time
   refusal policy rejects an app-key credential the wallet did not mint itself.
8. **`processRequest` is pure.** Consent and the response channel stay with the
   caller; zcap and App Connect processing arrive as injected
   `RequestProcessors`, and the App Connect branch is validated through
   `appConnectRequestOf` before dispatch.
9. **Two matchers ship deliberately.** `matching.ts` carries DCW's deep matcher
   and freewallet's type/issuer matcher side by side, since each wallet matches
   only its own credential store and no cross-replica agreement is needed
   between them.
10. **The logging port carries no runtime reference to `@interop/logger`.**
    `log.ts` declares its own `Logger` type rather than importing it, even as a
    type-only import, so the emitted `dist/log.d.ts` names no specifier from
    that package; `test:dist` greps the built output for the string to enforce
    it. The mutual-assignability check against the sibling package's own
    `Logger` type lives in `test/node/log.test.ts` instead. Every other call
    site in `src/` may only take `@interop/logger` as a type-only import,
    enforced by an eslint `no-restricted-imports` rule.

## Ownership heuristics

- **The connect code and its envelope, the `was-link` payload, the enrollment
  ceremony, the onboarding invite TTL** -- `@interop/wallet-core` (`space`,
  `enrollment`). This package classifies those grammars through injected
  recognizers; it does not define them.
- **The VPR type vocabulary and the loose VC shape guards** --
  `@interop/data-integrity-core`. Import them from the `/vpr` and `/guards`
  subpaths, not the package root, since the root can dedupe onto an older cached
  build that predates the vocabulary.
- **VC display derivation** -- `@interop/vc-display`. This package hands a
  matched or requested credential to the app; rendering it is the app's or
  `vc-display`'s job, not this package's.
- **Consent UI, the response channel, and the concrete credential stores each
  matcher runs over** -- app-side. `processRequest` and `matching.ts` take these
  as parameters or injected functions; neither owns storage or a UI.
- **The App Connect exchange's specification** -- the App Connect companion spec
  (`app-connect-spec`). This package implements the wallet side of it; the wire
  contract for the `AppConnectQuery`, the app-key credential, and the response
  presentation's `zcap` / `appConnect` members is specified there.

## Glossary

The repo's domain vocabulary: one canonical term per concept, used the same way
in code, tests, docs, commit messages, and conversation.

- **Wallet input** -- the raw text a wallet accepts from a QR scan, a paste box,
  a file drop, or an opened deep link, before classification.
  `classifyWalletInput` turns it into one of the seven `WalletInput` kinds.
- **The seven input kinds** -- `was-link`, `connect-code`, `legacy-request`,
  `interaction-url`, `deep-link`, `wallet-api-message`, `credentials`; see "The
  wallet-input classifier" above. Avoid: input types, grammars (when a bare
  synonym would do; "grammar" is fine when discussing the discrimination
  itself).
- **VPR (Verifiable Presentation Request)** -- the VCALM query vocabulary a
  requester sends and a wallet answers. Defined in
  `@interop/data-integrity-core`, re-exported from `types.ts`.
- **QueryByExample** -- one VPR query type: a credential-shape template a wallet
  matches its store against. `matching.ts` implements two matchers over it.
- **App Connect query (`AppConnectQuery`)** -- the App Connect companion spec's
  VPR extension carrying `{ name, appUrl }`; validated by `appConnectRequestOf`
  against the attested requesting origin.
- **App key** -- the App Connect app-key credential, scoped to (user, origin,
  `appUrl`); wallet-minted rather than imported. Owned by `appKey.ts`.
- **`WalletOnboardingQuery`** -- the VPR query type carrying an account pointer
  (did:webvh `did`, `spaceId`, `host`) and the account controller did:key, so a
  fresh wallet can join an existing account over an exchange. Owned by
  `onboarding.ts`; the response envelope it carries back lives in
  `@interop/wallet-core`'s `enrollment` subpath.
- **Interaction URL** -- a VCALM `interaction:` URL, the indirection that
  resolves to a protocols map naming how to reach an exchange.
  `interactionUrl.ts` resolves it; `interactionRequest.ts`'s
  `openInteractionRequest` is the answering wallet's one-call entry point over
  one.
- **Ephemeral exchange** -- a WAS server's short-lived, unauthenticated exchange
  resource: a requester creates one carrying a VPR and polls it until the wallet
  answers. `ephemeralExchange.ts` is the requester's side.
- **Presentation suite** -- the cryptosuite negotiated for the response VP's
  proof. `presentationSuite.ts`'s `negotiateCryptosuite` /
  `presentationSuiteFor`.
- **Request processors (`RequestProcessors`)** -- the zcap and App Connect
  processing functions a caller injects into `processRequest`, since
  `processRequest` itself is pure and does not perform them.

## Current State labels

Nothing here is Transitional. The whole package is the extracted `request`
subpath, moved verbatim except for the recognizer injection and the logging port
described above.
