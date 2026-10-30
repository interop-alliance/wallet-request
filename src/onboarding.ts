/*!
 * Copyright (c) 2026 Interop Alliance. All rights reserved.
 */
/**
 * The `WalletOnboardingQuery` transport vocabulary: the VPR half of "connect a
 * new wallet client over an exchange". An already-enrolled client (the
 * inviter) composes a request body carrying the query and stores it on an
 * ephemeral exchange; a fresh wallet (the enrollee) scans the exchange's
 * interaction URL, classifies the query here, and answers with the onboarding
 * response envelope (`@interop/wallet-core`'s `enrollment` subpath).
 *
 * Vocabulary only -- the enrollment ceremony itself is untouched, and nothing
 * secret crosses the channel: connect-code public halves travel one way, the
 * account pointer and controller the other. The query carries the account's
 * did:webvh `did` (the pointer: the DID alone resolves to the account's log,
 * its Space URL and its server's base server URL), the account controller
 * did:key, and optionally the `baseServerUrl` as a convenience that saves the
 * reader one DID inverse. The inviter already holds all three values.
 *
 * The query names the account but authorizes nothing. A holder of the QR or
 * capability URL gains a world-readable DID log and nothing else; every act on
 * the Space still requires zcaps they do not have, and the rendezvous server
 * that sees the pointer is the same PWS server that hosts the Space and
 * already knows the account DID. Injection by a URL holder remains the real
 * threat, and remains covered by the ceremony's fingerprint / confirmation-
 * code comparison: nothing is authorized before that human check.
 *
 * A wallet that predates the query type finds nothing it can satisfy in such a
 * request (`classifyRequest` reports no DID Auth, no credential queries, and
 * no capability requests) and refuses, rather than degrading into a partial
 * generic flow.
 */
import { canonicalBaseServerUrl } from '@interop/pws-client/paths/layout'

import { exclusiveQueryOf } from './queryPredicates.js'
import type {
  IVPRDetails,
  IVPRQuery,
  IWalletOnboardingQuery,
  IWalletOnboardingRequest
} from './types.js'

/**
 * Whether a query's `did` member is a did:webvh id. The prefix is the DID
 * method's own (the did:webvh specification), not a wallet convention, so the
 * query vocabulary carries the one-line shape check itself rather than taking
 * it as an injected recognizer.
 *
 * @param did {string | undefined}
 * @returns {boolean}
 */
function isWebvhDid(did: string | undefined): did is string {
  return typeof did === 'string' && did.startsWith('did:webvh:')
}

/**
 * Validates a wallet-onboarding `baseServerUrl` and returns its serialized
 * form: `@interop/pws-client`'s canonical base server URL, the rule the
 * enrollee's `PwsClient` constructor applies to the same value. Compose and
 * classification share that one rule, so a base the inviter publishes is one
 * the enrollee's client accepts, and URLs differing only in a default port,
 * percent-encoding case, dot segments, or the trailing slash do not name
 * distinct servers. A violation throws, naming the field and carrying
 * pws-client's refusal as the message and the `cause`.
 *
 * There is no attested origin to compare against here (an exchange has no
 * CHAPI requesting origin), so unlike an App Connect `appUrl` the check is
 * shape only. The channel's trust comes from the point-to-point fingerprint
 * comparison of the enrollment ceremony, not from this value. Whether the
 * `did` actually resolves under this base is not checked here either: the
 * did:webvh inverse is wallet-core's, and so is any comparison of the two.
 *
 * @param options {object}
 * @param options.baseServerUrl {string} - The query's `baseServerUrl`.
 * @returns {string} The canonical base server URL, ending in one slash.
 */
export function serializedBaseServerUrl({
  baseServerUrl
}: {
  baseServerUrl: string
}): string {
  try {
    return canonicalBaseServerUrl(baseServerUrl)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new Error(
      'A WalletOnboardingQuery "baseServerUrl" is not a valid base server ' +
        `URL (got "${baseServerUrl}"): ${reason}`,
      { cause: err }
    )
  }
}

/**
 * Validates the account members a `WalletOnboardingQuery` carries and returns
 * them in the classified form: the account's did:webvh `did`, the account
 * controller did:key, and the serialized `baseServerUrl` when one is given.
 * Compose and classification share this one rule, so the two sides cannot
 * drift.
 *
 * The `did` must be a did:webvh id: only a promoted account (one whose Space
 * controller is its published did:webvh) has the world-readable log the
 * enrollee verifies its approval from. The `controller` check is shape only
 * (a non-empty `did:key:` string) -- it is a discovery value the enrollee
 * stores, and the channel's trust comes from the ceremony's confirmation-code
 * comparison, not from any member of the query. A `baseServerUrl` is
 * optional: the DID alone locates the account, and the base only saves the
 * reader one inverse.
 *
 * @param options {object}
 * @param options.did {string | undefined}         the account's did:webvh id.
 * @param [options.baseServerUrl] {string | undefined}  the PWS base server
 *   URL the DID resolves under.
 * @param options.controller {string | undefined}  the account controller
 *   did:key.
 * @returns {IWalletOnboardingRequest}
 */
export function validatedOnboardingAccount({
  did,
  baseServerUrl,
  controller
}: {
  did?: string | undefined
  baseServerUrl?: string | undefined
  controller?: string | undefined
}): IWalletOnboardingRequest {
  if (!isWebvhDid(did)) {
    throw new Error(
      'A WalletOnboardingQuery "did" must be the account\'s did:webvh id ' +
        `(got "${String(did)}") -- only a promoted account can onboard ` +
        'another wallet.'
    )
  }
  if (typeof controller !== 'string' || !controller.startsWith('did:key:')) {
    throw new Error(
      'A WalletOnboardingQuery "controller" must be a did:key string (got ' +
        `"${String(controller)}").`
    )
  }
  if (baseServerUrl !== undefined && typeof baseServerUrl !== 'string') {
    throw new Error(
      'A WalletOnboardingQuery "baseServerUrl", when present, must be a ' +
        `string (got "${String(baseServerUrl)}").`
    )
  }
  return {
    did,
    ...(baseServerUrl === undefined
      ? {}
      : { baseServerUrl: serializedBaseServerUrl({ baseServerUrl }) }),
    controller
  }
}

/**
 * INVITER: the VPR details body to store on the ephemeral exchange -- one
 * `WalletOnboardingQuery` and nothing else, since the query is one mental
 * model per exchange. The account members are validated by
 * {@link validatedOnboardingAccount} and the `baseServerUrl`, when given, is
 * stored in its serialized form ({@link serializedBaseServerUrl}).
 *
 * @param options {object}
 * @param options.did {string}  the account's promoted did:webvh id.
 * @param [options.baseServerUrl] {string}  the PWS base server URL the DID
 *   resolves under; a convenience for the reader, omitted when the inviter
 *   does not hold it.
 * @param options.controller {string}  the account controller did:key.
 * @returns {IVPRDetails}
 */
export function composeWalletOnboardingRequest({
  did,
  baseServerUrl,
  controller
}: {
  did: string
  baseServerUrl?: string
  controller: string
}): IVPRDetails {
  const query: IWalletOnboardingQuery = {
    type: 'WalletOnboardingQuery',
    ...validatedOnboardingAccount({ did, baseServerUrl, controller })
  }
  return { query: [query as unknown as IVPRQuery] }
}

/**
 * ENROLLEE: extracts the wallet-onboarding request from a query set, when one
 * is present. Like an `AppConnectQuery`, a `WalletOnboardingQuery` is one
 * mental model per exchange: at most one may appear, and it must not be
 * combined with `QueryByExample`, standalone capability queries, or an
 * `AppConnectQuery` (a screen that asks the person to connect a wallet must
 * not simultaneously ask them to share credentials or grant capabilities).
 * Its account members must satisfy {@link validatedOnboardingAccount} (so a
 * query missing the `did` or the `controller` is malformed), and its
 * `baseServerUrl`, when present, is rewritten to its serialized form.
 * Violations throw; classification-time callers surface the throw as a
 * malformed-request state.
 *
 * @param options {object}
 * @param options.queries {IVPRQuery[]}
 * @returns {IWalletOnboardingRequest | null}
 */
export function walletOnboardingRequestOf({
  queries
}: {
  queries: IVPRQuery[]
}): IWalletOnboardingRequest | null {
  const onboardingQuery = exclusiveQueryOf<IWalletOnboardingQuery>({
    queries,
    typeName: 'WalletOnboardingQuery'
  })
  if (onboardingQuery === null) {
    return null
  }
  const { did, baseServerUrl, controller } = onboardingQuery
  return validatedOnboardingAccount({ did, baseServerUrl, controller })
}
