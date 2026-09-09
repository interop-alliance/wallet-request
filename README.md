# Wallet Request _(@interop/wallet-request)_

[![Node.js CI](https://github.com/interop-alliance/wallet-request/workflows/CI/badge.svg)](https://github.com/interop-alliance/wallet-request/actions?query=workflow%3A%22CI%22)
[![NPM Version](https://img.shields.io/npm/v/@interop/wallet-request.svg)](https://npm.im/@interop/wallet-request)

> Wallet-request / exchange-protocol handling for the browser, Node.js, and
> React Native: input classification, VPR parsing, QueryByExample matching,
> cryptosuite negotiation, VP composition, and the VC-API / ephemeral-exchange
> clients.

## Table of Contents

- [Background](#background)
- [Security](#security)
- [Install](#install)
- [Usage](#usage)
- [Contribute](#contribute)
- [License](#license)

## Background

`@interop/wallet-request` is the wallet side of a Verifiable Presentation
Request exchange: everything between "the user scanned or pasted something" and
"here is the signed response". It covers:

- **Input classification** -- `classifyWalletInput` / `handleWalletInput`, one
  ordered discrimination for every place a wallet accepts arbitrary text (a QR
  scan, a paste box, a file drop, an opened deep link): a wallet-connection
  payload, a client-enrollment connect code, a legacy credential-request link, a
  VCALM interaction URL, a registered deep link, a wallet API message, or raw
  credential JSON. Classification does no fetch, navigation, or storage.
- **Parsing and classification of exchange messages** -- `parse.ts` turns deep
  links and JSON into typed messages, `classify.ts` turns CHAPI events and VPRs
  into typed requests, including the App Connect `AppConnectQuery` extension.
- **Matching** -- `matching.ts` filters stored credentials against a
  QueryByExample, with both wallets' matchers shipped side by side.
- **VP composition and cryptosuite negotiation** -- `composeVp.ts` builds the
  response presentation, embedding any grants before signing so the DIDAuth
  proof covers them; `presentationSuite.ts` negotiates the cryptosuite.
- **The App Connect app-key credential** -- `appKey.ts`: matching, minting, the
  store-time refusal policy.
- **The `WalletOnboardingQuery` transport vocabulary** -- `onboarding.ts`: the
  inviter's compose helper and the enrollee's classification, over a query
  carrying the account pointer and controller.
- **Exchange clients** -- `exchangeClient.ts` (VC-API, fetch-injectable),
  `interactionUrl.ts` / `interactionRequest.ts` (VCALM interaction URLs),
  `ephemeralExchange.ts` (the requester's side of a WAS server's ephemeral
  exchange), and `capabilityRequest.ts` (the zcap-only VPR a requester stores on
  one).
- **`processRequest.ts`** -- the pure request-to-response pipeline; consent and
  the response channel stay with the caller.

The package was extracted verbatim from `@interop/wallet-core`'s `request`
subpath. The Verifiable Presentation Request vocabulary is owned by
[`@interop/data-integrity-core`](https://npm.im/@interop/data-integrity-core)
and re-exported from the root here, so a consumer imports one package.

Two grammars this package classifies belong to a wallet's account convention
rather than to this package: the `was-link` wallet-connection payload and the
connect-code prefix are defined in `@interop/wallet-core` (`space` and
`enrollment`), beside the ceremonies that consume them. `classifyWalletInput`
and `handleWalletInput` take each as an injected `recognizers` predicate instead
of importing the convention. A wallet on a WAS account wires `isWasLinkPayload`
(from `@interop/wallet-core/space`) and `isConnectCode` (from
`@interop/wallet-core/enrollment`); a wallet holding no WAS account passes
neither, and those branches never match. This package depends on nothing in
`@interop/wallet-core`, and `@interop/wallet-core` imports nothing from here.

## Security

- **Classification does no I/O.** `classifyWalletInput`, `handleWalletInput`,
  `parse.ts`, and `classify.ts` never fetch, navigate, or write to storage. The
  one network seam in the package is the injected `FetchLike` the exchange
  clients take.
- **`processRequest` is pure.** Consent and the response channel stay with the
  caller; zcap and App Connect processing arrive as injected
  `RequestProcessors`.
- **The App Connect `appUrl` origin rule.** An `AppConnectQuery`'s `app.appUrl`
  must parse as an absolute URL, carry no fragment, and be same-origin with the
  attested requesting origin. An opaque origin serializes as `"null"` and is
  refused rather than compared as same-origin with itself.
- **Grants are signed inside the VP.** `composeVp.ts` embeds grants in the
  presentation before signing, so the DIDAuth proof covers them.
- **App keys are wallet-minted.** `appKey.ts`'s store-time refusal policy
  rejects an imported app-key credential; only a credential this package minted
  may be stored.
- **Every field is untrusted input.** VPRs, CHAPI events, and pasted or scanned
  text all come from outside the wallet. Helpers here validate shape and refuse
  malformed input rather than silently guessing at it.

## Install

- Node.js 24+ is recommended.

### PNPM

To install via PNPM:

```
pnpm install @interop/wallet-request
```

### Development

To install locally (for development):

```
git clone https://github.com/interop-alliance/wallet-request.git
cd wallet-request
pnpm install
```

## Usage

```ts
import {
  classifyWalletInput,
  handleWalletInput,
  classifyRequest,
  composeVp,
  processRequest
} from '@interop/wallet-request'
import { deepMatch } from '@interop/wallet-request/matching'
```

A wallet on a WAS account wires the two account-convention recognizers from
`@interop/wallet-core`:

```ts
import { handleWalletInput } from '@interop/wallet-request'
import { isWasLinkPayload } from '@interop/wallet-core/space'
import { isConnectCode } from '@interop/wallet-core/enrollment'

await handleWalletInput({
  text: scannedText,
  recognizers: { isWasLink: isWasLinkPayload, isConnectCode },
  handlers: {
    wasLink: input => joinWasAccount(input.text),
    connectCode: input => approveEnrollment(input.text),
    credentials: input => resolveCredentialsInput(input.text)
    // ... the remaining kinds an app implements
  }
})
```

The root exports every module. `./matching` is a separate leaf export: the
QueryByExample matchers alone, so a wallet's matching tests load without the
VP-signing and document-loader graph.

## Contribute

PRs accepted. See [CONTRIBUTING.md](CONTRIBUTING.md) for editor setup (Prettier,
ESLint, and EditorConfig) and how it maps to CI.

If editing the Readme, please conform to the
[standard-readme](https://github.com/RichardLitt/standard-readme) specification.

## License

[MIT License](LICENSE.md) © 2026 Interop Alliance.
