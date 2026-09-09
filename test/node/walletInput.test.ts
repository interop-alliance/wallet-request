/**
 * Unit tests for the universal wallet-input classifier
 * (`src/walletInput.ts`): every grammar lands in its own branch, the order
 * holds where grammars overlap (a legacy request ahead of the generic deep
 * link, an interaction URL ahead of it too), the two account-convention
 * branches match only through their injected recognizers, and the handler
 * dispatch refuses a kind this wallet did not implement.
 */
import { describe, expect, it } from 'vitest'
import {
  classifyWalletInput,
  handleWalletInput
} from '../../src/walletInput.js'
import type { WalletInputRecognizers } from '../../src/walletInput.js'

const schemes = ['dccrequest://', 'https://lcw.app/']

/**
 * Stand-ins for the predicates `@interop/wallet-core` owns: the `was-link`
 * payload's structural check and the connect-code prefix check.
 */
const recognizers: WalletInputRecognizers = {
  isWasLink: text => {
    try {
      return (JSON.parse(text) as { t?: unknown }).t === 'was-link'
    } catch {
      return false
    }
  },
  isConnectCode: text => text.startsWith('freewallet-connect:')
}

const WAS_LINK =
  '{"v":1,"t":"was-link","serverUrl":"https://was.example","secret":"Y29ycmVjdCBob3JzZQ"}'

describe('classifyWalletInput', () => {
  it('recognizes a was-link connection payload ahead of raw JSON', () => {
    expect(classifyWalletInput(WAS_LINK, { recognizers }).kind).toBe('was-link')
  })

  it('leaves unrelated JSON to the credentials branch', () => {
    expect(
      classifyWalletInput('{"@context":[],"type":["VerifiableCredential"]}', {
        recognizers
      }).kind
    ).toBe('credentials')
  })

  it('recognizes a connect code by prefix', () => {
    expect(
      classifyWalletInput('  freewallet-connect:abc  ', { recognizers })
    ).toEqual({
      kind: 'connect-code',
      text: 'freewallet-connect:abc'
    })
  })

  it('never matches an account grammar without its recognizer', () => {
    expect(classifyWalletInput(WAS_LINK).kind).toBe('credentials')
    expect(classifyWalletInput('freewallet-connect:abc').kind).toBe(
      'credentials'
    )
    expect(
      classifyWalletInput('freewallet-connect:abc', {
        recognizers: { isWasLink: recognizers.isWasLink }
      }).kind
    ).toBe('credentials')
  })

  it('recognizes a legacy credential request ahead of the deep link', () => {
    const text =
      'dccrequest://request?vc_request_url=https%3A%2F%2Fissuer.example%2Freq' +
      '&issuer=did%3Aweb%3Aissuer.example&challenge=abc'
    const input = classifyWalletInput(text, { deepLinkSchemes: schemes })
    expect(input.kind).toBe('legacy-request')
    if (input.kind === 'legacy-request') {
      expect(input.params.issuer).toBe('did:web:issuer.example')
      expect(input.params.vc_request_url).toBe('https://issuer.example/req')
    }
  })

  it('recognizes an interaction URL in both spellings', () => {
    expect(
      classifyWalletInput('interaction:https://example.com/x?iuv=1').kind
    ).toBe('interaction-url')
    expect(classifyWalletInput('https://example.com/x?iuv=1').kind).toBe(
      'interaction-url'
    )
  })

  it('routes any other registered-scheme link as a deep link', () => {
    expect(
      classifyWalletInput('https://lcw.app/request?request=%7B%7D', {
        deepLinkSchemes: schemes
      }).kind
    ).toBe('deep-link')
  })

  it('anchors a bare-origin link prefix at a URL delimiter', () => {
    const deepLinkSchemes = ['https://wallet.example.com']
    expect(
      classifyWalletInput('https://wallet.example.com/x', { deepLinkSchemes })
        .kind
    ).toBe('deep-link')
    expect(
      classifyWalletInput('https://wallet.example.com?x=1', {
        deepLinkSchemes
      }).kind
    ).toBe('deep-link')
    expect(
      classifyWalletInput('https://wallet.example.com.evil.org/x', {
        deepLinkSchemes
      }).kind
    ).toBe('credentials')
  })

  it('does not throw on a request parameter that is a JSON primitive', () => {
    expect(classifyWalletInput('https://a.example/?request=5').kind).toBe(
      'credentials'
    )
    expect(classifyWalletInput('https://a.example/?request=true').kind).toBe(
      'credentials'
    )
    expect(classifyWalletInput('https://a.example/?request=abc').kind).toBe(
      'credentials'
    )
  })

  it('needs registered schemes for the deep-link branches', () => {
    const text = 'dccrequest://request?vc_request_url=x&issuer=y'
    expect(classifyWalletInput(text).kind).toBe('credentials')
  })

  it('parses a wallet API message carried in a request parameter', () => {
    const message = { protocols: { vcapi: 'https://example.com/exchange' } }
    const text =
      'https://resume.example/connect?request=' +
      encodeURIComponent(JSON.stringify(message))
    const input = classifyWalletInput(text)
    expect(input.kind).toBe('wallet-api-message')
    if (input.kind === 'wallet-api-message') {
      expect(input.message).toEqual(message)
    }
  })

  it('parses a wallet API message pasted as raw JSON', () => {
    const text = JSON.stringify({
      verifiablePresentationRequest: { query: [] }
    })
    const input = classifyWalletInput(text)
    expect(input.kind).toBe('wallet-api-message')
  })

  it('falls back to credentials for a plain URL or raw VC', () => {
    expect(
      classifyWalletInput('https://example.com/credential.json').kind
    ).toBe('credentials')
    expect(classifyWalletInput('not a url at all').kind).toBe('credentials')
  })
})

describe('handleWalletInput', () => {
  it('dispatches to the matching handler', async () => {
    const result = await handleWalletInput({
      text: 'freewallet-connect:abc',
      recognizers,
      handlers: {
        connectCode: ({ text }) => `connect:${text}`,
        credentials: () => 'credentials'
      }
    })
    expect(result).toBe('connect:freewallet-connect:abc')
  })

  it('refuses a kind this wallet does not implement', async () => {
    await expect(
      handleWalletInput({
        text: 'https://example.com/credential.json',
        handlers: { connectCode: () => 'nope' }
      })
    ).rejects.toThrow(/Unhandled wallet input of kind "credentials"/)
  })
})
