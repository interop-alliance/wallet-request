/*!
 * Copyright (c) 2026 Interop Alliance. All rights reserved.
 */
/**
 * Unit tests for the signed connection request (`src/capabilityRequest.ts`):
 * the VPR-root `challenge` the builder adds, the round trip through
 * `signCapabilityRequest` and `verifyCapabilityRequest`, the signer guards,
 * and the verifier's refusals (wrong key, a controller that is not a did:key,
 * moved or mismatched challenge, another cryptosuite or purpose, a domain,
 * non-JSON input, and tampering after signing).
 * Real Ed25519 did:key keys sign the requests.
 */
import { describe, expect, it, vi } from 'vitest'
import { purposes, sign } from '@interop/jsonld-signatures'
import type { AuthenticationProofPurposeOptions } from '@interop/jsonld-signatures'
import { EddsaJcs2022 } from '@interop/ed25519-signature/eddsa-jcs-2022'
import {
  composeCapabilityRequest,
  documentLoader,
  signCapabilityRequest,
  verifyCapabilityRequest
} from '../../src/index.js'
import type {
  ICapabilityQueryDetail,
  ISignedCapabilityRequest,
  IVPRDetails
} from '../../src/index.js'
import { makePresentationSigner } from './fixtures/signer.js'

const CHALLENGE = 'nonce-1'

function detailFor(controller: string): ICapabilityQueryDetail {
  return {
    controller,
    invocationTarget: 'https://was.example/space/abc/',
    allowedAction: ['GET']
  }
}

function requestFor(controller: string): IVPRDetails {
  return composeCapabilityRequest({
    capabilityQueries: [detailFor(controller)],
    challenge: CHALLENGE,
    agent: { name: 'research-bot' }
  })
}

/**
 * Generates a did:key signer and signs a request naming its own DID.
 */
async function signedRequest(): Promise<{
  holder: string
  signed: ISignedCapabilityRequest
}> {
  const { signer, holder } = await makePresentationSigner()
  const signed = await signCapabilityRequest({
    request: requestFor(holder),
    signer
  })
  return { holder, signed }
}

/**
 * The first capability query detail of a request, for tampering.
 */
function firstDetail(request: IVPRDetails): ICapabilityQueryDetail {
  const [query] = request.query as Array<{
    capabilityQuery: ICapabilityQueryDetail[]
  }>
  return query!.capabilityQuery[0]!
}

describe('composeCapabilityRequest', () => {
  it('puts a given challenge at the root and inside the query', () => {
    const request = requestFor('did:key:z6MkrequesterExample')
    expect(request.challenge).toBe(CHALLENGE)
    expect(request.query).toEqual([
      expect.objectContaining({ challenge: CHALLENGE })
    ])
  })

  it('carries no challenge when not given one', () => {
    const request = composeCapabilityRequest({
      capabilityQueries: [detailFor('did:key:z6MkrequesterExample')]
    })
    expect(request).not.toHaveProperty('challenge')
    expect(request.query).toEqual([
      expect.not.objectContaining({ challenge: expect.anything() })
    ])
  })
})

describe('signCapabilityRequest', () => {
  it('round-trips through verifyCapabilityRequest', async () => {
    const { signer, holder } = await makePresentationSigner()
    const request = requestFor(holder)
    const snapshot = structuredClone(request)
    const signed = await signCapabilityRequest({ request, signer })

    expect(request).toEqual(snapshot)
    expect(signed['@context']).toEqual([
      'https://w3id.org/security/data-integrity/v2'
    ])
    expect(signed.proof).toMatchObject({
      type: 'DataIntegrityProof',
      cryptosuite: 'eddsa-jcs-2022',
      proofPurpose: 'authentication',
      challenge: CHALLENGE,
      verificationMethod: signer.id
    })
    expect(signed.proof.domain).toBeUndefined()

    await expect(verifyCapabilityRequest({ request: signed })).resolves.toEqual(
      { controller: holder }
    )
  })

  it('refuses a request with no root challenge', async () => {
    const { signer, holder } = await makePresentationSigner()
    const request = composeCapabilityRequest({
      capabilityQueries: [detailFor(holder)]
    })
    await expect(signCapabilityRequest({ request, signer })).rejects.toThrow(
      /requires a root "challenge"/
    )
  })

  it("refuses a signer whose key does not belong to the request's controller", async () => {
    const { signer } = await makePresentationSigner()
    const { holder: other } = await makePresentationSigner()
    await expect(
      signCapabilityRequest({ request: requestFor(other), signer })
    ).rejects.toThrow(/does not belong to the request's controller/)
  })

  it('refuses capability queries naming different controllers', async () => {
    const { signer, holder } = await makePresentationSigner()
    const request = composeCapabilityRequest({
      capabilityQueries: [detailFor(holder), detailFor('did:key:z6Mkother')],
      challenge: CHALLENGE
    })
    await expect(signCapabilityRequest({ request, signer })).rejects.toThrow(
      /must name the same "controller"/
    )
  })
})

describe('verifyCapabilityRequest', () => {
  it('refuses a non-object request', async () => {
    await expect(verifyCapabilityRequest({ request: 'x' })).rejects.toThrow(
      /must be an object/
    )
  })

  it('refuses an unsigned request', async () => {
    await expect(
      verifyCapabilityRequest({
        request: requestFor('did:key:z6MkrequesterExample')
      })
    ).rejects.toThrow(/carries no proof/)
  })

  it('refuses a request that is not plain JSON', async () => {
    const { signed } = await signedRequest()
    await expect(
      verifyCapabilityRequest({ request: { ...signed, agent: 1n } })
    ).rejects.toThrow(/must be plain JSON/)
  })

  it('refuses a controller that is not a did:key before any resolution', async () => {
    const { signed, holder } = await signedRequest()
    const fragment = (signed.proof.verificationMethod as string).slice(
      holder.length
    )
    const controller = 'https://attacker.example/beacon'
    firstDetail(signed).controller = controller
    signed.proof.verificationMethod = `${controller}${fragment}`
    const documentLoader = vi.fn()
    await expect(
      verifyCapabilityRequest({ request: signed, documentLoader })
    ).rejects.toThrow(/must name a did:key "controller"/)
    expect(documentLoader).not.toHaveBeenCalled()
  })

  it('refuses a request carrying several proofs', async () => {
    const { signed } = await signedRequest()
    await expect(
      verifyCapabilityRequest({
        request: { ...signed, proof: [signed.proof, signed.proof] }
      })
    ).rejects.toThrow(/exactly one proof/)
  })

  it('refuses a request signed by a key of another controller', async () => {
    const { signer } = await makePresentationSigner()
    const { holder: other } = await makePresentationSigner()
    // Sign directly, past the builder's guard: the request names `other`,
    // the key belongs to the signer's own DID.
    const signed = await sign(structuredClone(requestFor(other)), {
      suite: new EddsaJcs2022({ signer }),
      purpose: new purposes.AuthenticationProofPurpose({
        challenge: CHALLENGE
      } as AuthenticationProofPurposeOptions),
      documentLoader
    })
    await expect(verifyCapabilityRequest({ request: signed })).rejects.toThrow(
      /not made with a key of the request's controller/
    )
  })

  it('refuses a signed request whose controller was changed after signing', async () => {
    const { signed } = await signedRequest()
    const { holder: other } = await makePresentationSigner()
    firstDetail(signed).controller = other
    await expect(verifyCapabilityRequest({ request: signed })).rejects.toThrow(
      /not made with a key of the request's controller/
    )
  })

  it('refuses a key id that claims the controller but resolves elsewhere', async () => {
    const { signer, holder } = await makePresentationSigner()
    const { holder: other } = await makePresentationSigner()
    const fragment = signer.id!.slice(holder.length)
    signer.id = `${other}${fragment}`
    const signed = await signCapabilityRequest({
      request: requestFor(other),
      signer
    })
    await expect(verifyCapabilityRequest({ request: signed })).rejects.toThrow(
      /did not verify/
    )
  })

  it('refuses a challenge moved out of the root after signing', async () => {
    const { signed } = await signedRequest()
    delete signed.challenge
    await expect(verifyCapabilityRequest({ request: signed })).rejects.toThrow(
      /requires a root "challenge"/
    )
  })

  it('refuses a proof challenge that differs from the root one', async () => {
    const { signed } = await signedRequest()
    signed.proof.challenge = 'nonce-2'
    await expect(verifyCapabilityRequest({ request: signed })).rejects.toThrow(
      /does not match the root "challenge"/
    )
  })

  it('refuses another cryptosuite', async () => {
    const { signed } = await signedRequest()
    signed.proof.cryptosuite = 'eddsa-rdfc-2022'
    await expect(verifyCapabilityRequest({ request: signed })).rejects.toThrow(
      /Unsupported request proof cryptosuite/
    )
  })

  it('refuses the assertionMethod proof purpose', async () => {
    const { signed } = await signedRequest()
    signed.proof.proofPurpose = 'assertionMethod'
    await expect(verifyCapabilityRequest({ request: signed })).rejects.toThrow(
      /must be "authentication"/
    )
  })

  it('refuses a proof carrying a domain', async () => {
    const { signed } = await signedRequest()
    signed.proof.domain = 'app.example'
    await expect(verifyCapabilityRequest({ request: signed })).rejects.toThrow(
      /must not carry a "domain"/
    )
  })

  it('refuses a capability query tampered after signing', async () => {
    const { signed } = await signedRequest()
    firstDetail(signed).allowedAction = ['GET', 'PUT']
    await expect(
      verifyCapabilityRequest({ request: signed })
    ).rejects.toMatchObject({
      message: expect.stringMatching(/did not verify/),
      cause: expect.anything()
    })
  })

  it('refuses an agent name tampered after signing', async () => {
    const { signed } = await signedRequest()
    signed.agent = { name: 'trusted-bank' }
    await expect(verifyCapabilityRequest({ request: signed })).rejects.toThrow(
      /did not verify/
    )
  })
})
