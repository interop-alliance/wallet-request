/**
 * Unit tests for the wallet-onboarding transport vocabulary: the
 * `WalletOnboardingQuery` compose helper and its classification
 * (`src/onboarding.ts`) and the fail-closed behavior an older wallet exhibits
 * when it meets one. The onboarding-response envelope that answers the query
 * is `@interop/wallet-core`'s (`enrollment`), tested there.
 */
import { describe, expect, it } from 'vitest'
import {
  classifyRequest,
  composeWalletOnboardingRequest,
  queriesOf,
  serializedBaseServerUrl,
  walletOnboardingRequestOf
} from '../../src/index.js'
import type { IVPRQuery } from '../../src/index.js'
import { appConnectRequestOf } from '../../src/index.js'

/** The account the inviter is onboarding another wallet onto. */
const ACCOUNT_DID =
  'did:webvh:QmZ4tDuvesekSs4qM5JBGwjJHfxpTBEjLE:was.example:space:8f2c1d9a:id'
const CONTROLLER = 'did:key:z6Mkon3Necd6NkkyfoGoHxid2znGc59LU3K7mubaRcFbLfLX'
const BASE_SERVER_URL = 'https://was.example'

/**
 * The query as the wire delivers it without a base: the key absent, not
 * present with an undefined value (JSON cannot carry the latter).
 */
const QUERY_WITHOUT_BASE = {
  type: 'WalletOnboardingQuery',
  did: ACCOUNT_DID,
  controller: CONTROLLER
} as never as IVPRQuery

const onboardingQuery = (members: Record<string, unknown>) =>
  ({
    ...QUERY_WITHOUT_BASE,
    baseServerUrl: BASE_SERVER_URL,
    ...members
  }) as never as IVPRQuery

/**
 * Values the enrollee's `WasClient` constructor refuses, so the inviter must
 * too: relative or unparseable, a non-http(s) scheme, a fragment or query
 * string (a bare `#` or `?` counts), userinfo, an empty path segment.
 */
const REFUSED_BASE_SERVER_URLS = [
  '/storage',
  'not a url',
  'ftp://was.example',
  'ws://was.example/',
  'chrome-extension://abcdef/',
  'https://was.example/#top',
  'https://was.example/#',
  'https://was.example/?a=b',
  'https://was.example/?',
  'https://user:pw@was.example/',
  'https://user@was.example/storage',
  'https://was.example/a//b'
]
const REFUSED_BASE_SERVER_URL = /"baseServerUrl" is not a valid base server URL/

describe('composeWalletOnboardingRequest', () => {
  it('composes a single-query VPR body', () => {
    expect(
      composeWalletOnboardingRequest({
        did: ACCOUNT_DID,
        baseServerUrl: BASE_SERVER_URL,
        controller: CONTROLLER
      })
    ).toEqual({
      query: [
        {
          type: 'WalletOnboardingQuery',
          did: ACCOUNT_DID,
          baseServerUrl: 'https://was.example/',
          controller: CONTROLLER
        }
      ]
    })
  })

  it('omits baseServerUrl when the inviter passes none', () => {
    expect(
      composeWalletOnboardingRequest({
        did: ACCOUNT_DID,
        controller: CONTROLLER
      })
    ).toEqual({
      query: [
        {
          type: 'WalletOnboardingQuery',
          did: ACCOUNT_DID,
          controller: CONTROLLER
        }
      ]
    })
  })

  it('stores the serialized base server URL', () => {
    const request = composeWalletOnboardingRequest({
      did: ACCOUNT_DID,
      baseServerUrl: 'https://was.example:443/a/../storage',
      controller: CONTROLLER
    })
    expect(queriesOf(request)).toEqual([
      {
        type: 'WalletOnboardingQuery',
        did: ACCOUNT_DID,
        baseServerUrl: 'https://was.example/storage/',
        controller: CONTROLLER
      }
    ])
  })

  it('round-trips the account members through classification', () => {
    const request = composeWalletOnboardingRequest({
      did: ACCOUNT_DID,
      baseServerUrl: BASE_SERVER_URL,
      controller: CONTROLLER
    })
    expect(walletOnboardingRequestOf({ queries: queriesOf(request) })).toEqual({
      did: ACCOUNT_DID,
      baseServerUrl: 'https://was.example/',
      controller: CONTROLLER
    })
  })

  it('throws on an empty or non-webvh did', () => {
    for (const did of ['', CONTROLLER, 'did:web:was.example']) {
      expect(() =>
        composeWalletOnboardingRequest({ did, controller: CONTROLLER })
      ).toThrow(/must be the account's did:webvh id/)
    }
  })

  it('throws on a missing or non-did:key controller', () => {
    for (const controller of ['', 'did:webvh:abc:was.example', 'nonsense']) {
      expect(() =>
        composeWalletOnboardingRequest({ did: ACCOUNT_DID, controller })
      ).toThrow(/"controller" must be a did:key string/)
    }
  })

  it('refuses a base server URL the enrollee client would refuse', () => {
    expect(() =>
      composeWalletOnboardingRequest({
        did: ACCOUNT_DID,
        baseServerUrl: 'https://was.example/a//b',
        controller: CONTROLLER
      })
    ).toThrow(REFUSED_BASE_SERVER_URL)
  })
})

describe('serializedBaseServerUrl', () => {
  it.each([
    ['https://was.example', 'https://was.example/'],
    ['http://was.example:80/a/./b/../c', 'http://was.example/a/c/'],
    ['https://was.example/storage', 'https://was.example/storage/'],
    ['https://was.example/storage///', 'https://was.example/storage/']
  ])('normalizes %s to %s', (baseServerUrl, canonical) => {
    expect(serializedBaseServerUrl({ baseServerUrl })).toBe(canonical)
  })

  it('refuses every value the enrollee client would refuse', () => {
    // Shape only, with no origin to check: an exchange attests none.
    for (const baseServerUrl of REFUSED_BASE_SERVER_URLS) {
      expect(() => serializedBaseServerUrl({ baseServerUrl })).toThrow(
        REFUSED_BASE_SERVER_URL
      )
    }
  })

  it('carries the was-client refusal as the message and the cause', () => {
    expect(() =>
      serializedBaseServerUrl({ baseServerUrl: 'https://was.example/a//b' })
    ).toThrow(
      expect.objectContaining({
        message: expect.stringMatching(/empty segment/),
        cause: expect.any(Error)
      })
    )
  })
})

describe('walletOnboardingRequestOf', () => {
  it('returns null when no WalletOnboardingQuery is present', () => {
    expect(
      walletOnboardingRequestOf({ queries: [{ type: 'DIDAuthentication' }] })
    ).toBeNull()
  })

  it('classifies a valid query, serializing the base server URL', () => {
    expect(
      walletOnboardingRequestOf({
        queries: [
          onboardingQuery({ baseServerUrl: 'https://was.example:443/storage' })
        ]
      })
    ).toEqual({
      did: ACCOUNT_DID,
      baseServerUrl: 'https://was.example/storage/',
      controller: CONTROLLER
    })
  })

  it('classifies a query carrying no base server URL', () => {
    expect(
      walletOnboardingRequestOf({ queries: [QUERY_WITHOUT_BASE] })
    ).toEqual({ did: ACCOUNT_DID, controller: CONTROLLER })
  })

  it('throws on a missing or non-webvh did', () => {
    for (const did of [undefined, null, 42, CONTROLLER]) {
      expect(() =>
        walletOnboardingRequestOf({ queries: [onboardingQuery({ did })] })
      ).toThrow(/must be the account's did:webvh id/)
    }
  })

  it('throws on a missing or non-did:key controller', () => {
    for (const controller of [undefined, null, 42, ACCOUNT_DID]) {
      expect(() =>
        walletOnboardingRequestOf({
          queries: [onboardingQuery({ controller })]
        })
      ).toThrow(/"controller" must be a did:key string/)
    }
  })

  it('throws on more than one WalletOnboardingQuery', () => {
    const query = onboardingQuery({})
    expect(() =>
      walletOnboardingRequestOf({ queries: [query, query] })
    ).toThrow(/More than one WalletOnboardingQuery/)
  })

  it('throws on a present but non-string base server URL', () => {
    for (const baseServerUrl of [null, 42, { href: 'https://was.example' }]) {
      expect(() =>
        walletOnboardingRequestOf({
          queries: [onboardingQuery({ baseServerUrl })]
        })
      ).toThrow(/"baseServerUrl", when present, must be a string/)
    }
  })

  it('throws on a base server URL the enrollee client would refuse', () => {
    expect(() =>
      walletOnboardingRequestOf({
        queries: [
          onboardingQuery({ baseServerUrl: 'https://was.example/a//b' })
        ]
      })
    ).toThrow(REFUSED_BASE_SERVER_URL)
  })

  it('throws when combined with another consent-bearing query type', () => {
    const query = onboardingQuery({})
    const others: IVPRQuery[] = [
      { type: 'QueryByExample', credentialQuery: [] } as never as IVPRQuery,
      {
        type: 'AuthorizationCapabilityQuery',
        capabilityQuery: [{ invocationTarget: 'https://was.example/space/1' }]
      } as never as IVPRQuery,
      {
        type: 'AppConnectQuery',
        app: { name: 'Notes', appUrl: 'https://app.example/' }
      } as never as IVPRQuery
    ]
    for (const other of others) {
      expect(() =>
        walletOnboardingRequestOf({ queries: [query, other] })
      ).toThrow(/cannot be combined with/)
    }
  })
})

describe('appConnectRequestOf, meeting a WalletOnboardingQuery', () => {
  it('refuses the mixture from its own side too', () => {
    expect(() =>
      appConnectRequestOf({
        queries: [
          {
            type: 'AppConnectQuery',
            app: { name: 'Notes', appUrl: 'https://app.example/' }
          } as never as IVPRQuery,
          onboardingQuery({})
        ],
        origin: 'https://app.example'
      })
    ).toThrow(/cannot be combined with/)
  })
})

describe('a wallet that predates the query type', () => {
  it('finds nothing it can satisfy, and so refuses rather than degrading', () => {
    const profile = classifyRequest(
      composeWalletOnboardingRequest({
        did: ACCOUNT_DID,
        baseServerUrl: BASE_SERVER_URL,
        controller: CONTROLLER
      })
    )
    expect(profile).toEqual({ didAuth: false, vcQueries: [], zcapRequests: [] })
  })
})
