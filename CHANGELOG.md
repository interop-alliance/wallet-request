# @interop/wallet-request Changelog

## 0.2.0 - TBD

### Fixed

- `sendToExchanger` now shares `postToExchange`: a `404` throws
  `EphemeralExchangeGoneError`, any other non-2xx status throws instead of
  returning the error body as the peer's reply, malformed JSON is wrapped, and
  an empty body yields `{}` (was `null`).
- `classifyWalletInput` no longer throws when a URL's `request` parameter is a
  JSON primitive; a non-JSON `request` parameter is logged at debug level
  without the raw value.
- `isDIDAuthOnlyRequest` returns `false` for a non-object
  `verifiablePresentationRequest` instead of throwing.
- `processRequest` refuses a `WalletOnboardingQuery` (and any exclusive query
  type it has no processor for) with `ExclusiveQueryUnsupportedError` (with a
  `queryType` property; dispatch on `err.name`) instead of returning `{}` or
  answering the generic half of a mixed request. New `exclusiveQueryTypeOf` in
  `queryPredicates`.
- `createEphemeralExchange` resolves a relative `Location` against the request
  URL and builds the interaction URL with the URL API.
- `fetchInteractionProtocols` reports a non-JSON or `null` body as an error
  instead of throwing a raw `TypeError` / `SyntaxError`.

### Changed

- **Breaking:** `handleWalletInput` throws `UnhandledWalletInputError` (with a
  `kind` property; dispatch on `err.name`) for an input kind with no handler,
  instead of a bare `Error` recognizable only by its message.
- **Breaking:** `deepLinkSchemes` prefixes are matched at a URL delimiter, so a
  bare-origin prefix no longer matches a lookalike host.
- `handleWalletInput` warns when a `wasLink` / `connectCode` handler is wired
  without its recognizer.
- `exclusiveQueryOf` takes a type parameter for the extension query shape it
  returns; the at-most-one-query rule lives in `singleQueryOfType`.
- ARCHITECTURE.md documents the signing path's document loader as a network seam
  outside the injected `FetchLike`.
- New `toArray` in `queryPredicates` is the one single-or-array normalizer
  behind `queriesOf`, `credentialsOf`, `credentialQueriesOf`, the zcap and App
  Connect `capabilityQuery` readers, the matchers, and the VP `@context`.
- New `assertExchangeResponseOk` in `ephemeralExchange` is the one 404 / non-2xx
  status rule shared by `postToExchange` and `fetchInteractionProtocols`; the
  latter's non-2xx message now reads
  `The interaction URL at <url> responded <status> <text>.`
- New `walletApiMessageObjectOf` returns the parsed wallet API message object;
  `isWalletApiMessage` wraps it, and `classifyWalletInput` parses raw JSON input
  once instead of twice.

### Removed

- **Breaking:** the legacy (pre-`appUrl`) app-key re-issue path:
  `findLegacyAppKeyCredential`, `reissueAppKeyCredential`, `appKeyCandidates`'
  undefined-`appUrl` selection, and `issueAppKeyCredential`'s `description`
  option. No wallet called it; its only importer was a was-react counterpart
  test.
- **Breaking:** the deprecated `composeVP` alias, the `IVpRequest` / `IVpOffer`
  / `IVprDetails` / `IVprQuery` / `IDidAuthenticationQuery` type aliases,
  `EPHEMERAL_EXCHANGE_INTERACTION_PATH`, `hasAppConnectQuery`,
  `isAppConnectQuery`, `isWalletOnboardingQuery`, and the empty
  `declarations.d.ts`.

## 0.1.0 - 2026-09-09

### Added

- Initial release: wallet-request / exchange-protocol handling extracted
  verbatim from `@interop/wallet-core`'s `request` subpath -- input
  classification and parsing (`walletInput`, `parse`, `classify`),
  QueryByExample matching (`matching`), cryptosuite negotiation
  (`presentationSuite`), VP composition (`composeVp`), the App Connect app-key
  credential (`appKey`), the `WalletOnboardingQuery` transport vocabulary
  (`onboarding`), the VC-API exchange client (`exchangeClient`), VCALM
  interaction URL handling (`interactionUrl`, `interactionRequest`), the
  requester's side of a WAS server's ephemeral exchange (`ephemeralExchange`),
  and the zcap-only VPR builder (`capabilityRequest`), with their test suite.
- `./matching` leaf export: the QueryByExample matchers alone, dependency-light
  for a wallet's matching tests.

### Changed

- `classifyWalletInput` and `handleWalletInput` take an optional
  `recognizers: WalletInputRecognizers` option (`isWasLink`, `isConnectCode`)
  instead of importing wallet-core's connect-code prefix and `was-link` payload
  shape directly. A wallet on a WAS account wires wallet-core's own predicates
  in.
- `setLogger` is this package's own logging port (`src/log.ts`), not
  wallet-core's.
