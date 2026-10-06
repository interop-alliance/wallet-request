/*!
 * Copyright (c) 2026 Interop Alliance. All rights reserved.
 */
/**
 * Framework-agnostic request processing: turns a classified VPR body plus the
 * user's VC selection into a {@link WalletResponse} (a possibly-signed VP, plus
 * any delegated zcaps). The response channel (CHAPI `respondWith`, an
 * exchange-URL POST) stays with the caller -- this function only returns data,
 * and assumes the user has already consented and picked which credentials to
 * send.
 *
 * Ported from Freewallet's `src/lib/walletRequest/processRequest.ts` (the pure
 * shape). The two app-specific side effects -- capability delegation and the App
 * Connect branch -- are injected as {@link RequestProcessors} rather than
 * imported, so this layer carries no session / grant-resolution machinery. The
 * signer and holder DID are injected as a {@link PresentationSigner}.
 *
 * The response VP is signed when the request carries a DIDAuthentication
 * query. A caller may also set `signWithoutDidAuth` to sign a response to a
 * request with no such query. That proof covers the VPR-root `challenge` and
 * names no `domain`. The App Connect branch is outside the switch: its
 * processor owns that response, including whether and how it is signed.
 */
import { log } from './log.js'
import { appConnectRequestOf, classifyRequest, queriesOf } from './classify.js'
import { composeVp } from './composeVp.js'
import { negotiateCryptosuite } from './presentationSuite.js'
import { exclusiveQueryTypeOf } from './queryPredicates.js'
import type { ExclusiveQueryType } from './queryPredicates.js'
import type {
  IVerifiableCredential,
  IVPRDetails,
  IZcap,
  PresentationSigner,
  RequestProcessors,
  WalletResponse
} from './types.js'

/**
 * Extracts the host (`host:port`) from a value that may be a full URL or a bare
 * host / host:port. Returns undefined if it cannot be parsed.
 */
function hostOf(value: string): string | undefined {
  try {
    const url = value.includes('://')
      ? new URL(value)
      : new URL(`https://${value}`)
    return url.host
  } catch (err) {
    log.warn('Could not parse host', { value, err })
    return undefined
  }
}

/**
 * Domain-binding check (VCALM section 3.4.3 advisement): a DID-Auth `domain` MUST match
 * the channel the request arrived on, otherwise a dishonest verifier could relay
 * the challenge from another origin and replay the response.
 *
 * @param options {object}
 * @param options.domain {string} - The `domain` from the request.
 * @param [options.origin] {string} - The channel origin (for CHAPI,
 *   `event.credentialRequestOrigin`).
 * @returns {boolean}
 */
export function domainMatchesOrigin({
  domain,
  origin
}: {
  domain: string
  origin?: string
}): boolean {
  if (!origin) {
    return false
  }
  const originHost = hostOf(origin)
  const domainHost = hostOf(domain)
  return !!originHost && originHost === domainHost
}

/**
 * Raised by {@link processRequest} when the request carries an exclusive query
 * type it has no processor for (today the `WalletOnboardingQuery`, which a
 * wallet routes to its own flow before calling in). The `queryType` rides
 * along so a caller can dispatch to that flow. Dispatch on `err.name` rather
 * than `instanceof`, as with the package's other errors: the caller may hold a
 * different copy of this package, which makes the name the stable contract.
 */
export class ExclusiveQueryUnsupportedError extends Error {
  readonly queryType: ExclusiveQueryType

  constructor({ queryType }: { queryType: ExclusiveQueryType }) {
    super(
      `A ${queryType} request has no processor in processRequest; ` +
        'the wallet handles it in its own flow.'
    )
    this.name = 'ExclusiveQueryUnsupportedError'
    this.queryType = queryType
  }
}

/**
 * Processes a Verifiable Presentation Request and composes the wallet's
 * response. Assumes the user has already consented and (for VC sharing) picked
 * which credentials to send.
 *
 * @param options {object}
 * @param options.request {IVPRDetails} - The VPR body.
 * @param options.presentationSigner {PresentationSigner} - Authentication signer
 *   and holder DID.
 * @param [options.selectedVCs] {IVerifiableCredential[]} - VCs the user chose to
 *   share (empty for a DID-Auth-only or zcap-only response).
 * @param [options.credentialRequestOrigin] {string} - Channel origin, used for
 *   the domain-binding check and required by the App Connect branch.
 * @param [options.processors] {RequestProcessors} - App-side capability /
 *   App Connect processors.
 * @param [options.cryptosuite] {string} - Cryptosuite override; when absent it
 *   is negotiated from the request's `acceptedCryptosuites`.
 * @param [options.signWithoutDidAuth] {boolean} - Sign the response VP with
 *   `presentationSigner` even when the request has no DIDAuthentication
 *   query. The proof covers the VPR-root `challenge` (required; its absence
 *   throws) and names no `domain`, even when the request carries one. The
 *   domain-binding check still runs first. Defaults to false, which signs
 *   only under DID Auth. A request with nothing to send still returns `{}`.
 *   Not consulted on the App Connect branch, whose `processAppConnect`
 *   processor composes and signs its own response.
 * @returns {Promise<WalletResponse>} The response VP (and any granted zcaps), or
 *   `{}` when there is nothing to send.
 */
export async function processRequest({
  request,
  presentationSigner,
  selectedVCs = [],
  credentialRequestOrigin,
  processors,
  cryptosuite,
  signWithoutDidAuth = false
}: {
  request: IVPRDetails
  presentationSigner: PresentationSigner
  selectedVCs?: IVerifiableCredential[]
  credentialRequestOrigin?: string
  processors?: RequestProcessors
  cryptosuite?: string
  signWithoutDidAuth?: boolean
}): Promise<WalletResponse> {
  const { didAuth, zcapRequests } = classifyRequest(request)
  const queries = queriesOf(request)
  const { challenge, domain } = request
  // Honor any cryptosuite the verifier asks for (VCALM `acceptedCryptosuites`),
  // unless the caller pinned one.
  const negotiatedCryptosuite = cryptosuite ?? negotiateCryptosuite(queries)

  // Security: never sign an authentication proof bound to a domain the request
  // did not actually arrive from. Enforced whenever a `domain` is present,
  // including a zcap-only request whose (unsigned) VP still names an origin.
  if (
    domain &&
    !domainMatchesOrigin({ domain, origin: credentialRequestOrigin })
  ) {
    throw new Error(
      `DID Auth domain "${domain}" does not match request origin ` +
        `"${credentialRequestOrigin}".`
    )
  }

  // An exclusive query type stands alone in a request (`exclusiveQueryTypeOf`
  // throws on a mixture). App Connect is the one this function has a processor
  // for; any other (a `WalletOnboardingQuery`) is routed by the wallet to its
  // own flow before it gets here, so reaching this point with one is a refusal,
  // not an empty generic response.
  const exclusiveType = exclusiveQueryTypeOf(queries)
  if (exclusiveType !== undefined && exclusiveType !== 'AppConnectQuery') {
    throw new ExclusiveQueryUnsupportedError({ queryType: exclusiveType })
  }

  // An App Connect request takes its own single-round branch, handled by the
  // injected processor. The requesting origin is what the app key is bound to
  // (and what the query's `appUrl` is validated against), so it is required;
  // the query itself is validated here (`appConnectRequestOf` throws on a
  // malformed `app` block), so the processor only ever sees a well-formed
  // request whose `appUrl` is already in serialized form.
  if (exclusiveType === 'AppConnectQuery') {
    if (!processors?.processAppConnect) {
      throw new Error(
        'An App Connect request was received but no processAppConnect ' +
          'processor was provided.'
      )
    }
    if (!credentialRequestOrigin) {
      throw new Error('An App Connect request requires a requesting origin.')
    }
    const appConnect = appConnectRequestOf({
      queries,
      origin: credentialRequestOrigin
    })
    if (!appConnect) {
      throw new Error('An AppConnectQuery could not be classified.')
    }
    return processors.processAppConnect({
      request,
      appConnect,
      origin: credentialRequestOrigin,
      challenge,
      domain,
      didAuthRequested: didAuth,
      cryptosuite: negotiatedCryptosuite
    })
  }

  // The response is signed under a DID Auth query, or when the caller asks
  // for it. A proof made without a DID Auth query binds only the VPR-root
  // `challenge` and names no `domain`, whatever the request carries. The
  // challenge guard mirrors composeVp's and runs before any capability is
  // delegated, so a refused request mints nothing.
  const sign = didAuth || signWithoutDidAuth
  const proofDomain = didAuth ? domain : undefined
  if (sign && !challenge) {
    throw new Error('A "challenge" is required to sign a VP.')
  }

  // Delegate the approved capabilities first, then embed them in the VP.
  const zcaps: IZcap[] =
    zcapRequests.length > 0 && processors?.processZcaps
      ? await processors.processZcaps({ zcapRequests })
      : []

  if (!didAuth && selectedVCs.length === 0 && zcaps.length === 0) {
    // Nothing to send: no DID Auth, no VCs, and no satisfiable grants.
    return {}
  }

  const verifiablePresentation = await composeVp({
    presentationSigner,
    selectedVcs: selectedVCs,
    challenge,
    domain: proofDomain,
    sign,
    cryptosuite: negotiatedCryptosuite,
    zcaps
  })
  // Return the delegated capabilities alongside the VP so the caller can log
  // exactly what was granted from these objects, rather than reading them back
  // off the composed VP.
  return { verifiablePresentation, zcaps }
}
