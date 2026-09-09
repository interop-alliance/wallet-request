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
  serializedOnboardingHost,
  walletOnboardingRequestOf
} from '../../src/index.js'
import type { IVPRQuery } from '../../src/index.js'
import { appConnectRequestOf } from '../../src/index.js'

/** The account the inviter is onboarding another wallet onto. */
const ACCOUNT_DID = 'did:webvh:QmZ4tDuvesekSs4qM5JBGwjJHfxpTBEjLE:was.example'
const SPACE_ID = 'urn:uuid:8f2c1d9a-3b6e-4a1f-9d0c-52b7e6a1c4d3'
const CONTROLLER = 'did:key:z6Mkon3Necd6NkkyfoGoHxid2znGc59LU3K7mubaRcFbLfLX'

const POINTER = {
  did: ACCOUNT_DID,
  spaceId: SPACE_ID,
  host: 'https://was.example'
}

const onboardingQuery = (members: Record<string, unknown>) =>
  ({
    type: 'WalletOnboardingQuery',
    did: ACCOUNT_DID,
    spaceId: SPACE_ID,
    controller: CONTROLLER,
    host: 'https://was.example',
    ...members
  }) as never as IVPRQuery

describe('composeWalletOnboardingRequest', () => {
  it('composes a single-query VPR body', () => {
    expect(
      composeWalletOnboardingRequest({
        pointer: POINTER,
        controller: CONTROLLER
      })
    ).toEqual({
      query: [
        {
          type: 'WalletOnboardingQuery',
          host: 'https://was.example/',
          did: ACCOUNT_DID,
          spaceId: SPACE_ID,
          controller: CONTROLLER
        }
      ]
    })
  })

  it('stores the serialized host', () => {
    const request = composeWalletOnboardingRequest({
      pointer: { ...POINTER, host: 'https://was.example:443/a/../storage' },
      controller: CONTROLLER
    })
    expect(queriesOf(request)).toEqual([
      {
        type: 'WalletOnboardingQuery',
        host: 'https://was.example/storage',
        did: ACCOUNT_DID,
        spaceId: SPACE_ID,
        controller: CONTROLLER
      }
    ])
  })

  it('round-trips the pointer and controller through classification', () => {
    const request = composeWalletOnboardingRequest({
      pointer: POINTER,
      controller: CONTROLLER
    })
    expect(walletOnboardingRequestOf({ queries: queriesOf(request) })).toEqual({
      host: 'https://was.example/',
      did: ACCOUNT_DID,
      spaceId: SPACE_ID,
      controller: CONTROLLER
    })
  })

  it('throws on a pointer carrying no did, or a non-webvh one', () => {
    for (const did of [undefined, '', CONTROLLER, 'did:web:was.example']) {
      expect(() =>
        composeWalletOnboardingRequest({
          pointer: { ...POINTER, did },
          controller: CONTROLLER
        })
      ).toThrow(/must be the account's did:webvh id/)
    }
  })

  it('throws on an empty spaceId', () => {
    expect(() =>
      composeWalletOnboardingRequest({
        pointer: { ...POINTER, spaceId: '' },
        controller: CONTROLLER
      })
    ).toThrow(/"spaceId" must be a non-empty string/)
  })

  it('throws on a missing or non-did:key controller', () => {
    for (const controller of ['', 'did:webvh:abc:was.example', 'nonsense']) {
      expect(() =>
        composeWalletOnboardingRequest({ pointer: POINTER, controller })
      ).toThrow(/"controller" must be a did:key string/)
    }
  })

  it('throws on a relative host', () => {
    expect(() =>
      composeWalletOnboardingRequest({
        pointer: { ...POINTER, host: '/storage' },
        controller: CONTROLLER
      })
    ).toThrow(/must be an absolute URL/)
  })

  it('throws on a non-http(s) host', () => {
    expect(() =>
      composeWalletOnboardingRequest({
        pointer: { ...POINTER, host: 'ftp://was.example' },
        controller: CONTROLLER
      })
    ).toThrow(/must be an http\(s\) URL/)
  })

  it('throws on a host carrying a fragment', () => {
    for (const host of ['https://was.example/#frag', 'https://was.example/#']) {
      expect(() =>
        composeWalletOnboardingRequest({
          pointer: { ...POINTER, host },
          controller: CONTROLLER
        })
      ).toThrow(/must not carry a fragment/)
    }
  })
})

describe('serializedOnboardingHost', () => {
  it('normalizes the default port, dot segments, and the empty path', () => {
    expect(serializedOnboardingHost({ host: 'https://was.example' })).toBe(
      'https://was.example/'
    )
    expect(
      serializedOnboardingHost({ host: 'http://was.example:80/a/./b/../c' })
    ).toBe('http://was.example/a/c')
  })

  it('rejects a relative or unparseable host', () => {
    expect(() => serializedOnboardingHost({ host: '/storage' })).toThrow(
      /absolute URL/
    )
    expect(() => serializedOnboardingHost({ host: 'not a url' })).toThrow(
      /absolute URL/
    )
  })

  it('rejects a host carrying a fragment, including a bare "#"', () => {
    expect(() =>
      serializedOnboardingHost({ host: 'https://was.example/#top' })
    ).toThrow(/fragment/)
    expect(() =>
      serializedOnboardingHost({ host: 'https://was.example/#' })
    ).toThrow(/fragment/)
  })

  it('checks the scheme and no origin: a non-http(s) host is refused', () => {
    // The mirror of serializedAppUrl, which checks the origin and no scheme.
    expect(() =>
      serializedOnboardingHost({ host: 'ws://was.example/' })
    ).toThrow(/http\(s\)/)
    expect(() =>
      serializedOnboardingHost({ host: 'chrome-extension://abcdef/' })
    ).toThrow(/http\(s\)/)
  })
})

describe('walletOnboardingRequestOf', () => {
  it('returns null when no WalletOnboardingQuery is present', () => {
    expect(
      walletOnboardingRequestOf({ queries: [{ type: 'DIDAuthentication' }] })
    ).toBeNull()
  })

  it('classifies a valid query, serializing the host', () => {
    expect(
      walletOnboardingRequestOf({
        queries: [onboardingQuery({ host: 'https://was.example:443/storage' })]
      })
    ).toEqual({
      host: 'https://was.example/storage',
      did: ACCOUNT_DID,
      spaceId: SPACE_ID,
      controller: CONTROLLER
    })
  })

  it('throws on a legacy host-only query', () => {
    expect(() =>
      walletOnboardingRequestOf({
        queries: [
          {
            type: 'WalletOnboardingQuery',
            host: 'https://was.example'
          } as never as IVPRQuery
        ]
      })
    ).toThrow(/must be the account's did:webvh id/)
  })

  it('throws on a missing or non-webvh did', () => {
    for (const did of [undefined, null, 42, CONTROLLER]) {
      expect(() =>
        walletOnboardingRequestOf({ queries: [onboardingQuery({ did })] })
      ).toThrow(/must be the account's did:webvh id/)
    }
  })

  it('throws on a missing or empty spaceId', () => {
    for (const spaceId of [undefined, null, '', 42]) {
      expect(() =>
        walletOnboardingRequestOf({ queries: [onboardingQuery({ spaceId })] })
      ).toThrow(/"spaceId" must be a non-empty string/)
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

  it('throws on a missing or non-string host', () => {
    for (const host of [undefined, null, 42, { href: 'https://was.example' }]) {
      expect(() =>
        walletOnboardingRequestOf({ queries: [onboardingQuery({ host })] })
      ).toThrow(/missing its host/)
    }
  })

  it('throws on a host violating the URL rules', () => {
    for (const host of [
      '/storage',
      'ftp://was.example',
      'https://was.example/#frag'
    ]) {
      expect(() =>
        walletOnboardingRequestOf({ queries: [onboardingQuery({ host })] })
      ).toThrow()
    }
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
        pointer: POINTER,
        controller: CONTROLLER
      })
    )
    expect(profile).toEqual({ didAuth: false, vcQueries: [], zcapRequests: [] })
  })
})
