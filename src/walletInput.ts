/*!
 * Copyright (c) 2026 Interop Alliance. All rights reserved.
 */
/**
 * The universal wallet-input classifier: one ordered discrimination for every
 * place a wallet accepts arbitrary text -- a QR scan, a paste box, a file
 * drop, an opened deep link. Each wallet had grown its own ladder, so a
 * grammar one wallet routed the other silently mis-handled (a connect code
 * read as a credential URL, a connection payload read as nothing at all).
 *
 * Classification only: nothing here fetches, navigates, or stores. The caller
 * supplies the handlers ({@link handleWalletInput}) or switches on the
 * discriminated result itself.
 *
 * The order is the whole design, because several grammars are subsets of
 * others. Most specific first:
 *
 * 1. **`was-link`** -- the wallet-connection QR payload, a non-URL JSON blob
 *    (deliberately not a link, so no OS handler ever routes it). Checked first
 *    because it is JSON that would otherwise fall through to the credential
 *    branch.
 * 2. **`connect-code`** -- a client-enrollment connect code, recognized by
 *    prefix.
 * 3. **`legacy-request`** -- the legacy credential-request link: a registered
 *    deep link carrying both `vc_request_url` and `issuer`. Necessarily ahead
 *    of the generic deep-link branch, which it would otherwise be swallowed by.
 * 4. **`interaction-url`** -- a VCALM interaction URL (`interaction:` scheme,
 *    or `iuv=1`), the indirection that resolves to a protocols map.
 * 5. **`deep-link`** -- any other link on one of the app's registered schemes,
 *    routed by the app's own link handling.
 * 6. **`wallet-api-message`** -- a wallet API message, either as raw JSON or
 *    carried in a `request` query parameter of a link that is NOT on a
 *    registered scheme (a plain `https:` QR from a site that has one). The
 *    parameter form is checked before the raw-JSON form so the message is
 *    handed back parsed either way.
 * 7. **`credentials`** -- the fallback: raw VC/VP JSON, or a URL to fetch one
 *    from. Deliberately last, since it is the only branch that cannot be
 *    recognized positively.
 *
 * Nothing is classified as "unrecognized": the credential branch is where
 * unrecognized text lands, and the resolver a caller runs there is what
 * produces the honest error message.
 *
 * The first two grammars are account conventions this package does not own:
 * the `was-link` payload shape and the connect-code prefix are defined by
 * `@interop/wallet-core` (`space` and `enrollment`), beside the ceremonies
 * that consume them. The classifier takes each as an injected recognizer
 * ({@link WalletInputRecognizers}) rather than importing the convention, the
 * same way it takes the app's registered link schemes: a wallet that holds no
 * WAS account has no such grammar to route, and one that does passes the
 * owning package's predicate. An absent recognizer means that branch never
 * matches, so the ordering above is preserved whichever subset is wired.
 */
import { isInteractionUrl } from './interactionUrl.js'
import { log } from './log.js'
import {
  isWalletApiMessage,
  parseWalletApiMessage,
  parseWalletApiUrl
} from './parse.js'
import type { WalletApiMessage } from './types.js'

/**
 * What a piece of wallet input turned out to be. Every variant carries the
 * trimmed `text` it was classified from, plus whatever the classification
 * already parsed (a classifier that recognized a grammar has usually parsed
 * enough of it that re-parsing in the handler would be waste and drift).
 */
export type WalletInput =
  | { kind: 'was-link'; text: string }
  | { kind: 'connect-code'; text: string }
  | { kind: 'legacy-request'; text: string; params: Record<string, string> }
  | { kind: 'interaction-url'; text: string }
  | { kind: 'deep-link'; text: string }
  | { kind: 'wallet-api-message'; text: string; message: WalletApiMessage }
  | { kind: 'credentials'; text: string }

/**
 * The query parameters of a link, whatever its scheme. Uses the substring
 * after the first `?` rather than `new URL`, so a custom-protocol link parses
 * the same way an `https:` one does.
 *
 * @param text {string}
 * @returns {URLSearchParams}
 */
function queryParamsOf(text: string): URLSearchParams {
  const start = text.indexOf('?')
  return new URLSearchParams(start === -1 ? '' : text.slice(start + 1))
}

/**
 * Whether a link is on one of the app's registered link prefixes. The match is
 * anchored at a URL delimiter: after the prefix the text must end or continue
 * with `/`, `?`, or `#`, unless the prefix itself already ends in a delimiter
 * (`dccrequest://`, `https://lcw.app/`). A bare-origin prefix such as
 * `https://wallet.example.com` therefore matches `https://wallet.example.com/x`
 * but not the lookalike host `https://wallet.example.com.evil.org/x`, which a
 * plain `startsWith` would route to the app's own link handling.
 *
 * @param options {object}
 * @param options.text {string}
 * @param options.prefix {string}
 * @returns {boolean}
 */
function matchesLinkPrefix({
  text,
  prefix
}: {
  text: string
  prefix: string
}): boolean {
  if (!text.startsWith(prefix)) {
    return false
  }
  if (/[/?#:]$/.test(prefix)) {
    return true
  }
  const next = text.charAt(prefix.length)
  return next === '' || next === '/' || next === '?' || next === '#'
}

/**
 * The account-convention recognizers a caller injects, one per grammar the
 * classifier recognizes but does not own. Each is a predicate over the
 * trimmed input; an absent one means the branch never matches. A wallet on a
 * WAS account passes `@interop/wallet-core`'s own predicates
 * (`isWasLinkPayload` from `space`, `isConnectCode` from `enrollment`), so
 * the grammar keeps its one definition there.
 */
export interface WalletInputRecognizers {
  /**
   * Whether the text is a `was-link` wallet-connection payload.
   */
  isWasLink?: (text: string) => boolean
  /**
   * Whether the text is a client-enrollment connect code.
   */
  isConnectCode?: (text: string) => boolean
}

/**
 * Classifies one piece of wallet input. See the module doc for the order and
 * why each branch sits where it does.
 *
 * @param text {string}   the scanned, pasted, or opened text
 * @param [options] {object}
 * @param [options.deepLinkSchemes] {string[]}   the link prefixes this app has
 *   registered (custom protocols and universal app links), matched at a URL
 *   delimiter per {@link matchesLinkPrefix}. Empty, the deep-link and
 *   legacy-request branches never match -- a wallet with no registered links
 *   has nothing to route them to
 * @param [options.recognizers] {WalletInputRecognizers}   the account-
 *   convention predicates for the `was-link` and `connect-code` branches.
 *   Absent, neither branch ever matches
 * @returns {WalletInput}
 */
export function classifyWalletInput(
  text: string,
  {
    deepLinkSchemes = [],
    recognizers = {}
  }: { deepLinkSchemes?: string[]; recognizers?: WalletInputRecognizers } = {}
): WalletInput {
  const trimmed = text.trim()

  if (recognizers.isWasLink?.(trimmed)) {
    return { kind: 'was-link', text: trimmed }
  }
  if (recognizers.isConnectCode?.(trimmed)) {
    return { kind: 'connect-code', text: trimmed }
  }

  const isDeepLink = deepLinkSchemes.some(prefix =>
    matchesLinkPrefix({ text: trimmed, prefix })
  )
  if (isDeepLink) {
    const params = queryParamsOf(trimmed)
    if (params.has('vc_request_url') && params.has('issuer')) {
      return {
        kind: 'legacy-request',
        text: trimmed,
        params: Object.fromEntries(params.entries())
      }
    }
  }
  if (isInteractionUrl(trimmed)) {
    return { kind: 'interaction-url', text: trimmed }
  }
  if (isDeepLink) {
    return { kind: 'deep-link', text: trimmed }
  }

  // A link on an unregistered scheme can still carry a wallet API message in
  // its `request` parameter (a site's own QR code).
  const carried = parseWalletApiUrl({ url: trimmed })
  const message = carried
    ? parseWalletApiMessage({ messageObject: carried })
    : isWalletApiMessage(trimmed)
      ? parseWalletApiMessage({
          messageObject: JSON.parse(trimmed) as object
        })
      : undefined
  if (message) {
    return { kind: 'wallet-api-message', text: trimmed, message }
  }

  return { kind: 'credentials', text: trimmed }
}

/**
 * The handlers a caller injects, one per classified kind. Every handler is
 * optional: an input whose kind has no handler throws, which is what keeps a
 * wallet that does not implement a grammar from silently doing the wrong thing
 * with it.
 */
export interface WalletInputHandlers<T> {
  wasLink?: (input: { text: string }) => T | Promise<T>
  connectCode?: (input: { text: string }) => T | Promise<T>
  legacyRequest?: (input: {
    text: string
    params: Record<string, string>
  }) => T | Promise<T>
  interactionUrl?: (input: { text: string }) => T | Promise<T>
  deepLink?: (input: { text: string }) => T | Promise<T>
  walletApiMessage?: (input: {
    text: string
    message: WalletApiMessage
  }) => T | Promise<T>
  credentials?: (input: { text: string }) => T | Promise<T>
}

/**
 * Classifies input and dispatches it to the matching handler.
 *
 * @param options {object}
 * @param options.text {string}   the scanned, pasted, or opened text
 * @param [options.deepLinkSchemes] {string[]}   this app's registered link
 *   prefixes
 * @param [options.recognizers] {WalletInputRecognizers}   the account-
 *   convention predicates for the `was-link` and `connect-code` branches
 * @param options.handlers {WalletInputHandlers}   the injected handlers
 * @returns {Promise<*>}   whatever the matching handler resolves to
 */
export async function handleWalletInput<T>({
  text,
  deepLinkSchemes,
  recognizers,
  handlers
}: {
  text: string
  deepLinkSchemes?: string[]
  recognizers?: WalletInputRecognizers
  handlers: WalletInputHandlers<T>
}): Promise<T> {
  // A handler for a grammar this package does not own can only fire through
  // its recognizer; a handler wired without one is unreachable, which nothing
  // else would ever report.
  if (handlers.wasLink && !recognizers?.isWasLink) {
    log.warn('handlers.wasLink is set but recognizers.isWasLink is not')
  }
  if (handlers.connectCode && !recognizers?.isConnectCode) {
    log.warn('handlers.connectCode is set but recognizers.isConnectCode is not')
  }
  const input = classifyWalletInput(text, { deepLinkSchemes, recognizers })
  switch (input.kind) {
    case 'was-link':
      return dispatch({ handler: handlers.wasLink, input })
    case 'connect-code':
      return dispatch({ handler: handlers.connectCode, input })
    case 'legacy-request':
      return dispatch({ handler: handlers.legacyRequest, input })
    case 'interaction-url':
      return dispatch({ handler: handlers.interactionUrl, input })
    case 'deep-link':
      return dispatch({ handler: handlers.deepLink, input })
    case 'wallet-api-message':
      return dispatch({ handler: handlers.walletApiMessage, input })
    default:
      return dispatch({ handler: handlers.credentials, input })
  }
}

/**
 * Runs one handler, or refuses because this wallet does not implement the
 * grammar the input turned out to be.
 *
 * @param options {object}
 * @param [options.handler] {Function}
 * @param options.input {WalletInput}
 * @returns {Promise<*>}
 */
async function dispatch<T, Input extends WalletInput>({
  handler,
  input
}: {
  handler?: (input: Input) => T | Promise<T>
  input: Input
}): Promise<T> {
  if (!handler) {
    throw new Error(`Unhandled wallet input of kind "${input.kind}".`)
  }
  return handler(input)
}
