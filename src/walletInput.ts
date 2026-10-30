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
 * 1. **`pws-link`** -- the wallet-connection QR payload, a non-URL JSON blob
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
 * 7. **`malformed-request`** -- a wallet API message recognized by shape but
 *    refused by the parse boundary (today: a presentation request naming
 *    `DIDAuthentication` more than once). The text is a request, so it must
 *    not fall to the credentials branch, where the resolver would misdescribe
 *    it. The refusal rides along as `cause`, so the classifier never throws.
 * 8. **`credentials`** -- the fallback: raw VC/VP JSON, or a URL to fetch one
 *    from. Deliberately last, since it is the only branch that cannot be
 *    recognized positively.
 *
 * Nothing is classified as "unrecognized": the credential branch is where
 * unrecognized text lands, and the resolver a caller runs there is what
 * produces the honest error message.
 *
 * The first two grammars are account conventions this package does not own:
 * the `pws-link` payload shape and the connect-code prefix are defined by
 * `@interop/wallet-core` (`space` and `enrollment`), beside the ceremonies
 * that consume them. The classifier takes each as an injected recognizer
 * ({@link WalletInputRecognizers}) rather than importing the convention, the
 * same way it takes the app's registered link schemes: a wallet that holds no
 * PWS account has no such grammar to route, and one that does passes the
 * owning package's predicate. An absent recognizer means that branch never
 * matches, so the ordering above is preserved whichever subset is wired.
 */
import { isInteractionUrl } from './interactionUrl.js'
import { log } from './log.js'
import {
  walletApiMessageObjectOf,
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
  | { kind: 'pws-link'; text: string }
  | { kind: 'connect-code'; text: string }
  | { kind: 'legacy-request'; text: string; params: Record<string, string> }
  | { kind: 'interaction-url'; text: string }
  | { kind: 'deep-link'; text: string }
  | { kind: 'wallet-api-message'; text: string; message: WalletApiMessage }
  | { kind: 'malformed-request'; text: string; cause: Error }
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
 * PWS account passes `@interop/wallet-core`'s own predicates
 * (`isPwsLinkPayload` from `space`, `isConnectCode` from `enrollment`), so
 * the grammar keeps its one definition there.
 */
export interface WalletInputRecognizers {
  /**
   * Whether the text is a `pws-link` wallet-connection payload.
   */
  isPwsLink?: (text: string) => boolean
  /**
   * Whether the text is a client-enrollment connect code.
   */
  isConnectCode?: (text: string) => boolean
}

/**
 * The recognizer names this module reads. The `Record` type fails the build
 * when a new recognizer goes unlisted.
 */
const RECOGNIZER_NAMES: Record<keyof WalletInputRecognizers, true> = {
  isPwsLink: true,
  isConnectCode: true
}

/**
 * Warns about each name in an injected object that this module does not read.
 * A misnamed recognizer or handler is otherwise silent wherever the type check
 * does not reach: the input falls through to a later branch, which can hand a
 * `pws-link` payload to the credentials handler.
 *
 * @param options {object}
 * @param options.option {string}   the option being checked, for the log
 * @param options.given {object}   the injected object
 * @param options.known {Record<string, true>}   the names this module reads
 * @returns {void}
 */
function warnUnknownNames({
  option,
  given,
  known
}: {
  option: string
  given: object
  known: Record<string, true>
}): void {
  for (const name of Object.keys(given)) {
    if (!Object.hasOwn(known, name)) {
      log.warn('Ignoring an unknown wallet input name', { option, name })
    }
  }
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
 *   convention predicates for the `pws-link` and `connect-code` branches.
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
  warnUnknownNames({
    option: 'recognizers',
    given: recognizers,
    known: RECOGNIZER_NAMES
  })
  const trimmed = text.trim()

  if (recognizers.isPwsLink?.(trimmed)) {
    return { kind: 'pws-link', text: trimmed }
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
  const messageObject =
    parseWalletApiUrl({ url: trimmed }) ?? walletApiMessageObjectOf(trimmed)
  let message: WalletApiMessage | undefined
  if (messageObject) {
    try {
      message = parseWalletApiMessage({ messageObject })
    } catch (err) {
      log.debug('The wallet API message was refused by the parse boundary', {
        err
      })
      const cause = err instanceof Error ? err : new Error(String(err))
      return { kind: 'malformed-request', text: trimmed, cause }
    }
  }
  if (message) {
    return { kind: 'wallet-api-message', text: trimmed, message }
  }

  return { kind: 'credentials', text: trimmed }
}

/**
 * Raised by {@link handleWalletInput} when the input's kind has no handler:
 * this wallet does not implement the grammar the text turned out to be. The
 * classified `kind` rides along so a caller can name it in its own message.
 * Dispatch on `err.name` rather than `instanceof`, as with the package's other
 * errors: the classifier may resolve to a different copy of this package than
 * the caller's, which makes the name the stable contract.
 */
export class UnhandledWalletInputError extends Error {
  readonly kind: WalletInput['kind']

  constructor({ kind }: { kind: WalletInput['kind'] }) {
    super(`Unhandled wallet input of kind "${kind}".`)
    this.name = 'UnhandledWalletInputError'
    this.kind = kind
  }
}

/**
 * The handlers a caller injects, one per classified kind. Every handler is
 * optional: an input whose kind has no handler throws
 * {@link UnhandledWalletInputError}, which is what keeps a wallet that does not
 * implement a grammar from silently doing the wrong thing with it.
 */
export interface WalletInputHandlers<T> {
  pwsLink?: (input: { text: string }) => T | Promise<T>
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
  malformedRequest?: (input: { text: string; cause: Error }) => T | Promise<T>
  credentials?: (input: { text: string }) => T | Promise<T>
}

/**
 * The handler names this module reads. The `Record` type fails the build when a
 * new handler goes unlisted.
 */
const HANDLER_NAMES: Record<keyof WalletInputHandlers<unknown>, true> = {
  pwsLink: true,
  connectCode: true,
  legacyRequest: true,
  interactionUrl: true,
  deepLink: true,
  walletApiMessage: true,
  malformedRequest: true,
  credentials: true
}

/**
 * Classifies input and dispatches it to the matching handler.
 *
 * @param options {object}
 * @param options.text {string}   the scanned, pasted, or opened text
 * @param [options.deepLinkSchemes] {string[]}   this app's registered link
 *   prefixes
 * @param [options.recognizers] {WalletInputRecognizers}   the account-
 *   convention predicates for the `pws-link` and `connect-code` branches
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
  warnUnknownNames({
    option: 'handlers',
    given: handlers,
    known: HANDLER_NAMES
  })
  // A handler for a grammar this package does not own can only fire through
  // its recognizer; a handler wired without one is unreachable, which nothing
  // else would ever report.
  if (handlers.pwsLink && !recognizers?.isPwsLink) {
    log.warn('handlers.pwsLink is set but recognizers.isPwsLink is not')
  }
  if (handlers.connectCode && !recognizers?.isConnectCode) {
    log.warn('handlers.connectCode is set but recognizers.isConnectCode is not')
  }
  const input = classifyWalletInput(text, { deepLinkSchemes, recognizers })
  switch (input.kind) {
    case 'pws-link':
      return dispatch({ handler: handlers.pwsLink, input })
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
    case 'malformed-request':
      return dispatch({ handler: handlers.malformedRequest, input })
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
    throw new UnhandledWalletInputError({ kind: input.kind })
  }
  return handler(input)
}
