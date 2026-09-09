# @interop/wallet-request Changelog

## 0.1.0 - TBD

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
