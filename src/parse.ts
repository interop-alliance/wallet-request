/*!
 * Copyright (c) 2026 Interop Alliance. All rights reserved.
 */
/**
 * Parsing of incoming wallet/VC API messages that arrive as JSON text or a
 * deep-link URL (`dccrequest://...?request=<json>`), plus the small
 * query-inspection helpers a caller runs over a parsed VPR body. Ported from
 * DCW's `app/lib/walletRequestApi.ts`; the `query-string` dependency is dropped
 * in favor of the native `URL` / `URLSearchParams`.
 */
import { log } from './log.js'
import type {
  IExchangeInvitation,
  IIssueRequest,
  IVPOffer,
  IVPRequest,
  IVPRQuery,
  IZcapQuery,
  WalletApiMessage
} from './types.js'

import { isDIDAuthRequested, isZcapQuery, queriesOf } from './classify.js'

// The DID-Auth query helper is spelled `isDIDAuthRequested` in `classify.ts`;
// DCW imported it as `isDidAuthRequested`. Both names resolve to one function.
export { isDIDAuthRequested as isDidAuthRequested } from './classify.js'

/**
 * The parsed object behind a JSON string when it is a recognized wallet API
 * message (an exchange invitation, a presentation request, a presentation
 * offer, or an issuance request), or `undefined` when it is not. Malformed
 * JSON is not a message. Parses once, so a caller that goes on to
 * `parseWalletApiMessage` the object does not parse the text again.
 *
 * @param text {string}
 * @returns {object | undefined}
 */
export function walletApiMessageObjectOf(text: string): object | undefined {
  let messageObject: unknown
  try {
    messageObject = JSON.parse(text)
  } catch {
    return undefined
  }
  const isMessage =
    !!messageObject &&
    typeof messageObject === 'object' &&
    ('protocols' in messageObject ||
      'verifiablePresentationRequest' in messageObject ||
      'verifiablePresentation' in messageObject ||
      'issueRequest' in messageObject)
  return isMessage ? (messageObject as object) : undefined
}

/**
 * Whether a JSON string is a recognized wallet API message.
 *
 * @param text {string}
 * @returns {boolean}
 */
export function isWalletApiMessage(text: string): boolean {
  return walletApiMessageObjectOf(text) !== undefined
}

/**
 * Rejects a presentation request whose query set names `DIDAuthentication` more
 * than once: a single DID-Auth proof answers the request, so a duplicate is
 * malformed. Enforced here at the parse boundary so a request that would later
 * fail classification never reaches the consent screen as accepted.
 *
 * @param request {IVPRequest}
 * @returns {void}
 */
function assertSingleDIDAuthQuery(request: IVPRequest): void {
  const details = request.verifiablePresentationRequest
  if (!details || typeof details !== 'object') {
    return
  }
  // Throws when more than one DIDAuthentication query is present.
  isDIDAuthRequested({ queries: queriesOf(details) })
}

/**
 * Classifies a parsed message object into one of the wallet API message types
 * by its discriminating property. Returns `undefined` for an unrecognized
 * shape. Throws when a presentation request carries more than one
 * `DIDAuthentication` query.
 *
 * @param options {object}
 * @param options.messageObject {object}
 * @returns {WalletApiMessage | undefined}
 */
export function parseWalletApiMessage({
  messageObject
}: {
  messageObject: object
}): WalletApiMessage | undefined {
  if ('protocols' in messageObject) {
    return messageObject as IExchangeInvitation
  }
  if ('verifiablePresentationRequest' in messageObject) {
    const request = messageObject as IVPRequest
    assertSingleDIDAuthQuery(request)
    return request
  }
  if ('verifiablePresentation' in messageObject) {
    return messageObject as IVPOffer
  }
  if ('issueRequest' in messageObject) {
    return messageObject as IIssueRequest
  }
  // Message not recognized / not supported, return undefined.
  return undefined
}

/**
 * Extracts and parses the wallet API message carried in a deep-link URL's
 * `request` query parameter (`dccrequest://...?request=<json>`). Returns
 * `undefined` when the parameter is absent, its value is not valid JSON, or the
 * JSON is not an object. None of those is an error: a link on an unregistered
 * scheme routinely carries an unrelated `request` parameter, and the caller
 * simply goes on to the next classification branch.
 *
 * @param options {object}
 * @param options.url {string}
 * @returns {Record<string, unknown> | undefined}
 */
export function parseWalletApiUrl({
  url
}: {
  url: string
}): Record<string, unknown> | undefined {
  let messageText: string | null
  try {
    messageText = new URL(url).searchParams.get('request')
  } catch {
    return undefined
  }
  if (messageText === null) {
    // URL does not contain a "request" parameter.
    return undefined
  }
  let parsed: unknown
  try {
    // `URLSearchParams.get` has already percent-decoded the value.
    parsed = JSON.parse(messageText)
  } catch (err) {
    log.debug('The "request" parameter is not JSON; not a wallet API URL', {
      err
    })
    return undefined
  }
  if (!parsed || typeof parsed !== 'object') {
    return undefined
  }
  return parsed as Record<string, unknown>
}

/**
 * Filters an incoming VCALM query set for capability (zcap) requests, returning
 * only those. Recognizes both the canonical `AuthorizationCapabilityQuery` and
 * the legacy `ZcapQuery` type strings.
 *
 * @param options {object}
 * @param options.queries {IVPRQuery[]}
 * @returns {{ zcapRequests?: IZcapQuery[] }}
 */
export function zcapsRequested({ queries }: { queries: IVPRQuery[] }): {
  zcapRequests?: IZcapQuery[]
} {
  const zcapRequests = queries.filter(isZcapQuery)
  if (zcapRequests.length > 0) {
    return { zcapRequests }
  }
  return {}
}

/**
 * Returns true if the message is a VPR whose only query type is
 * `DIDAuthentication` (i.e. no credential sharing is involved). A request whose
 * `verifiablePresentationRequest` is not an object has no query set and is not
 * DID-Auth-only. The query set is read through `queriesOf`, so a `null` or
 * untyped entry is skipped here exactly as classification skips it. Throws when the query set names
 * `DIDAuthentication` more than once, matching what classification would
 * otherwise reject after the request was accepted.
 *
 * @param message {WalletApiMessage}
 * @returns {boolean}
 */
export function isDIDAuthOnlyRequest(message: WalletApiMessage): boolean {
  if (!('verifiablePresentationRequest' in message)) {
    return false
  }
  const details = message.verifiablePresentationRequest
  if (!details || typeof details !== 'object') {
    return false
  }
  assertSingleDIDAuthQuery(message)
  const queries = queriesOf(details)
  return (
    queries.length > 0 &&
    queries.every(entry => entry.type === 'DIDAuthentication')
  )
}
