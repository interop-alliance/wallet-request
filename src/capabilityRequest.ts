/*!
 * Copyright (c) 2026 Interop Alliance. All rights reserved.
 */
/**
 * The zcap-only Verifiable Presentation Request: the request a requester (an
 * app, service, or agent) stores on an ephemeral exchange (`ephemeralExchange.ts`) when all it wants
 * from the wallet is delegated capabilities on the user's Space. One
 * `AuthorizationCapabilityQuery` (the canonical VCALM type string; the wallet
 * side's `zcapQueriesOf` reads it back) carrying the requested capability
 * details verbatim. Deliberately no `DIDAuthentication` query and no
 * `domain`: the requester is asking for authority, not proving who it is to a
 * verifier, and a requester without an attested origin (a CLI) has no domain
 * a wallet could check.
 *
 * A requester may also sign the request. The signed connection request
 * carries one `eddsa-jcs-2022` proof made with the key of the `controller`
 * the capability queries name. That controller is a did:key, so verifying
 * the proof resolves the key locally and performs no network fetch on an
 * untrusted request. The proof purpose is `authentication`. Its
 * `challenge` equals the VPR-root `challenge`, and it has no `domain`. JCS
 * covers the whole request, so a change to any member after signing breaks
 * the proof. The wallet side runs `verifyCapabilityRequest` before acting on
 * a signed request. It checks the proof shape, checks that the proof's key
 * belongs to the named `controller`, and then checks the signature. This way
 * a wallet does not mint a key toward a party that never asked.
 */
import { purposes, sign, verify } from '@interop/jsonld-signatures'
import { DataIntegrityProof } from '@interop/data-integrity-proof'
import {
  createVerifyCryptosuite,
  EddsaJcs2022
} from '@interop/ed25519-signature/eddsa-jcs-2022'
import type {
  IDocumentLoader,
  IProofDescription,
  ISigner
} from '@interop/data-integrity-core'
import type {
  ICapabilityQueryDetail,
  IVPRDetails,
  IVPRQuery,
  IZcapQuery
} from './types.js'
import { normalizeAgentName, queriesOf, zcapQueriesOf } from './classify.js'
import { documentLoader as defaultDocumentLoader } from './documentLoader.js'

// The purpose classes are reachable at runtime only through `purposes`.
const { AuthenticationProofPurpose } = purposes

/**
 * A capability request carrying the requester's `eddsa-jcs-2022`
 * authentication proof. Signing adds the Data Integrity v2 `@context`.
 */
export type ISignedCapabilityRequest = IVPRDetails & {
  '@context': string[]
  proof: IProofDescription
}

/**
 * REQUESTER: builds the zcap-only VPR details for a set of capability
 * requests. Each detail must name its `controller` (the grantee DID) and its
 * `invocationTarget` (a URL under the user's Space, or a wallet-defined
 * descriptor object); an empty set, or a detail missing either, throws --
 * there would be nothing for the wallet to ask consent for.
 *
 * @param options {object}
 * @param options.capabilityQueries {ICapabilityQueryDetail[]}
 * @param [options.challenge] {string}   a requester-chosen nonce the wallet
 *   echoes in its response presentation. It is placed at the VPR root (where
 *   the wallet reads it) and inside the `AuthorizationCapabilityQuery`.
 * @param [options.agent] {{ name: string }}   the requester's self-declared
 *   display name, carried as the VPR's root `agent` member; shown at consent
 *   as what the requester calls itself, not as verified identity. Validated by
 *   `normalizeAgentName` (trimmed, 1 to 64 characters, no control
 *   characters), so a name the wallet would refuse fails here first.
 * @returns {IVPRDetails}
 */
export function composeCapabilityRequest({
  capabilityQueries,
  challenge,
  agent
}: {
  capabilityQueries: ICapabilityQueryDetail[]
  challenge?: string
  agent?: { name: string }
}): IVPRDetails {
  if (capabilityQueries.length === 0) {
    throw new Error('A capability request must ask for at least one zcap.')
  }
  for (const detail of capabilityQueries) {
    if (typeof detail.controller !== 'string' || detail.controller === '') {
      throw new Error('A capability query must name its "controller".')
    }
    const target = detail.invocationTarget
    if (
      (typeof target !== 'string' || target === '') &&
      (typeof target !== 'object' || target === null)
    ) {
      throw new Error('A capability query must name its "invocationTarget".')
    }
  }
  const query: IZcapQuery = {
    type: 'AuthorizationCapabilityQuery',
    capabilityQuery: capabilityQueries,
    ...(challenge !== undefined && { challenge })
  }
  return {
    query: [query as IVPRQuery],
    ...(challenge !== undefined && { challenge }),
    ...(agent !== undefined && {
      agent: { name: normalizeAgentName({ name: agent.name }) }
    })
  }
}

/**
 * Reads what a signed capability request binds: the root `challenge` and the
 * one did:key `controller` every capability query names. Signer and verifier
 * both read the binding here, so the two sides cannot disagree on it.
 *
 * Throws when the challenge is missing or not a non-empty string, when the
 * request has no capability query, when the queries name different
 * controllers, or when the controller is not a did:key. The did:key rule is
 * what keeps verification local: any other method would send the verifier's
 * document loader to a URL the untrusted request chose.
 *
 * @param request {IVPRDetails}
 * @returns {{ challenge: string, controller: string }}
 */
function bindingOf(request: IVPRDetails): {
  challenge: string
  controller: string
} {
  const { challenge } = request
  if (typeof challenge !== 'string' || challenge === '') {
    throw new Error('A signed capability request requires a root "challenge".')
  }
  const details = zcapQueriesOf(queriesOf(request))
  if (details.length === 0) {
    throw new Error('A capability request must carry a capability query.')
  }
  const controllers = new Set<unknown>(details.map(detail => detail.controller))
  if (controllers.size !== 1) {
    throw new Error(
      'Every capability query in a signed request must name the same ' +
        '"controller".'
    )
  }
  const [controller] = controllers
  if (typeof controller !== 'string' || !controller.startsWith('did:key:')) {
    throw new Error(
      'A signed capability request must name a did:key "controller".'
    )
  }
  return { challenge, controller }
}

/**
 * Whether a key id is a verification method of the controller
 * (`<controller>#<fragment>`). The `#` keeps a DID that merely extends the
 * controller's string from passing.
 *
 * @param options {object}
 * @param options.controller {string}
 * @param options.keyId {unknown}
 * @returns {boolean}
 */
function keyBelongsTo({
  controller,
  keyId
}: {
  controller: string
  keyId: unknown
}): boolean {
  return typeof keyId === 'string' && keyId.startsWith(`${controller}#`)
}

/**
 * REQUESTER: signs a capability request with the key of the `controller` its
 * capability queries name. The proof is `eddsa-jcs-2022` with purpose
 * `authentication`. Its `challenge` is the VPR-root `challenge`, and it
 * carries no `domain`. The input request is left unchanged; a signed copy is
 * returned.
 *
 * Throws when the request has no root `challenge`, when its capability
 * queries do not all name one did:key `controller`, or when the signer's key
 * id does not belong to that controller.
 *
 * @param options {object}
 * @param options.request {IVPRDetails}   the request, as built by
 *   `composeCapabilityRequest` with a `challenge`.
 * @param options.signer {ISigner}   the controller's signer; its `id` must be
 *   a verification method of the controller (`<controller>#<fragment>`).
 * @returns {Promise<ISignedCapabilityRequest>}
 */
export async function signCapabilityRequest({
  request,
  signer
}: {
  request: IVPRDetails
  signer: ISigner
}): Promise<ISignedCapabilityRequest> {
  const { challenge, controller } = bindingOf(request)
  if (!keyBelongsTo({ controller, keyId: signer.id })) {
    throw new Error(
      `The signer's key "${signer.id}" does not belong to the request's ` +
        `controller "${controller}".`
    )
  }
  // jsigs adds its proof (and the suite context) to the document it is given.
  const copy = structuredClone(request)
  return (await sign(copy, {
    suite: new EddsaJcs2022({ signer }),
    purpose: new AuthenticationProofPurpose({ challenge }),
    documentLoader: defaultDocumentLoader
  })) as ISignedCapabilityRequest
}

/**
 * WALLET: verifies a signed capability request against the `controller` its
 * capability queries name. The request arrives over the wire, so it is
 * treated as untrusted input. Resolves with that controller on success.
 *
 * Throws a plain `Error` saying why when any check fails:
 * - the request is not an object, is not plain JSON, or has no single `proof`
 *   object;
 * - the proof is not a `DataIntegrityProof` with cryptosuite
 *   `eddsa-jcs-2022` and purpose `authentication`;
 * - the proof carries a `domain`;
 * - the root `challenge` is missing, or the proof's `challenge` differs;
 * - the capability queries do not all name one did:key `controller`;
 * - the proof's `verificationMethod` does not belong to that controller;
 * - the signature does not verify (the verifier's error rides as `cause`).
 *
 * Every check above the signature runs before the document loader is called,
 * so an unsigned or malformed request never causes a fetch.
 *
 * @param options {object}
 * @param options.request {unknown}   the signed request as received.
 * @param [options.documentLoader] {IDocumentLoader}   resolves the
 *   controller's did:key verification method; defaults to the shared
 *   security loader.
 * @returns {Promise<{ controller: string }>}
 */
export async function verifyCapabilityRequest({
  request,
  documentLoader = defaultDocumentLoader
}: {
  request: unknown
  documentLoader?: IDocumentLoader
}): Promise<{ controller: string }> {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new Error('A capability request must be an object.')
  }
  // The request is wire JSON. A JSON round trip drops anything a deserializer
  // attached (prototypes, functions) and leaves the verifier a plain copy.
  let copy: { proof?: unknown }
  try {
    copy = JSON.parse(JSON.stringify(request))
  } catch (err) {
    throw new Error('A capability request must be plain JSON.', { cause: err })
  }
  const { proof } = copy
  if (!proof || typeof proof !== 'object') {
    throw new Error('The capability request carries no proof.')
  }
  if (Array.isArray(proof)) {
    throw new Error('The capability request must carry exactly one proof.')
  }
  const {
    type,
    cryptosuite,
    proofPurpose,
    domain,
    challenge: proofChallenge,
    verificationMethod
  } = proof as IProofDescription
  if (type !== 'DataIntegrityProof') {
    throw new Error(`Unsupported request proof type "${String(type)}".`)
  }
  if (cryptosuite !== 'eddsa-jcs-2022') {
    throw new Error(
      `Unsupported request proof cryptosuite "${String(cryptosuite)}".`
    )
  }
  if (proofPurpose !== 'authentication') {
    throw new Error(
      `The request proof purpose must be "authentication", ` +
        `not "${String(proofPurpose)}".`
    )
  }
  if (domain !== undefined) {
    throw new Error('The request proof must not carry a "domain".')
  }
  const { challenge, controller } = bindingOf(copy as IVPRDetails)
  if (proofChallenge !== challenge) {
    throw new Error(
      'The request proof "challenge" does not match the root "challenge".'
    )
  }
  if (!keyBelongsTo({ controller, keyId: verificationMethod })) {
    throw new Error(
      "The request proof was not made with a key of the request's " +
        `controller "${controller}".`
    )
  }

  const result = await verify(copy, {
    suite: new DataIntegrityProof({ cryptosuite: createVerifyCryptosuite() }),
    purpose: new AuthenticationProofPurpose({ challenge }),
    documentLoader
  })
  if (!result.verified) {
    throw new Error('The capability request signature did not verify.', {
      cause: result.error
    })
  }
  return { controller }
}
