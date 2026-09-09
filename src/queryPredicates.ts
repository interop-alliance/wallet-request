/*!
 * Copyright (c) 2026 Interop Alliance. All rights reserved.
 */
/**
 * Import-free helpers shared by the request classifiers: which VPR query
 * type a query object carries, and the parse-and-no-fragment core every URL
 * validated straight off a request body layers its own rule on top of. Kept
 * in one dependency-light leaf file so `onboarding.ts` can classify a
 * `WalletOnboardingQuery` without pulling `classify.ts`'s heavier graph.
 */
import type { IVPRQuery, IZcapQuery } from './types.js'

/**
 * Whether a query is a standalone capability query, under either type string:
 * `AuthorizationCapabilityQuery` (the canonical VCALM name) or the legacy
 * `ZcapQuery`.
 *
 * The one reader of that alias pair. Both exclusivity checks and both
 * capability extractors ask through here, so retiring or extending the pair
 * is one edit rather than four.
 *
 * @param query {IVPRQuery}
 * @returns {boolean}
 */
export function isZcapQuery(query: IVPRQuery): query is IZcapQuery {
  return (
    query.type === 'AuthorizationCapabilityQuery' || query.type === 'ZcapQuery'
  )
}

/**
 * The queries of a set carrying the given `type` string, when the request may
 * carry at most one: returns `null` for none, the one query for exactly one,
 * and throws for more. The one home of the at-most-one rule, shared by the
 * `DIDAuthentication` check and the exclusive-type check.
 *
 * @param options {object}
 * @param options.queries {IVPRQuery[]}
 * @param options.typeName {string}
 * @returns {IVPRQuery | null}
 */
export function singleQueryOfType({
  queries,
  typeName
}: {
  queries: IVPRQuery[]
  typeName: string
}): IVPRQuery | null {
  const matches = queries.filter(query => isQueryOfType({ query, typeName }))
  if (matches.length > 1) {
    throw new Error(`More than one ${typeName} found, exiting.`)
  }
  return matches[0] ?? null
}

/**
 * The query types that stand alone in a request under the
 * one-mental-model-per-exchange rule: a screen that asks the person to
 * connect a wallet, or to join an account, must not simultaneously ask them
 * to share credentials or grant capabilities. Each type excludes
 * `QueryByExample`, standalone capability queries, and every other member of
 * this set, in both directions. The set is the one home of that mutual
 * exclusion: adding a third exclusive type is one entry here, and
 * {@link exclusiveQueryOf} refuses the new mixtures from every side.
 */
export const EXCLUSIVE_QUERY_TYPES = [
  'AppConnectQuery',
  'WalletOnboardingQuery'
] as const

/**
 * A member of {@link EXCLUSIVE_QUERY_TYPES}.
 */
export type ExclusiveQueryType = (typeof EXCLUSIVE_QUERY_TYPES)[number]

/**
 * Whether a query carries the given `type` string. `AppConnectQuery` and
 * `WalletOnboardingQuery` extend the spec query union rather than being part
 * of it, so they are matched by `type` string and upcast rather than narrowed
 * via a type predicate.
 *
 * @param options {object}
 * @param options.query {IVPRQuery}
 * @param options.typeName {string}
 * @returns {boolean}
 */
function isQueryOfType({
  query,
  typeName
}: {
  query: IVPRQuery
  typeName: string
}): boolean {
  return (query.type as string) === typeName
}

/**
 * The indefinite article a type name takes in a refusal message.
 *
 * @param typeName {string}
 * @returns {string}
 */
function articleFor(typeName: string): string {
  return /^[AEIOU]/.test(typeName) ? 'an' : 'a'
}

/**
 * The singleton query of a set for one of the {@link EXCLUSIVE_QUERY_TYPES}.
 * Returns `null` when no query of the type is present, the one query when
 * exactly one is, and throws when more than one appears or when a query of a
 * mutually exclusive type sits beside it: `QueryByExample`, a standalone
 * capability query, or any other exclusive type. The exclusion list is
 * derived from the shared set rather than written per caller, so no type can
 * be excluded from one direction only. The type parameter names the extension
 * query shape the caller reads (see {@link isQueryOfType} for why it is an
 * upcast rather than a narrowing).
 *
 * @param options {object}
 * @param options.queries {IVPRQuery[]}   the request's query set
 * @param options.typeName {ExclusiveQueryType}   the singleton's type
 * @returns {Query | null}
 */
export function exclusiveQueryOf<Query = IVPRQuery>({
  queries,
  typeName
}: {
  queries: IVPRQuery[]
  typeName: ExclusiveQueryType
}): Query | null {
  const match = singleQueryOfType({ queries, typeName })
  if (match === null) {
    return null
  }
  const otherTypes = EXCLUSIVE_QUERY_TYPES.filter(other => other !== typeName)
  const isExcluded = (query: IVPRQuery): boolean =>
    query.type === 'QueryByExample' ||
    isZcapQuery(query) ||
    otherTypes.includes(query.type as ExclusiveQueryType)
  if (queries.some(isExcluded)) {
    const others = otherTypes.map(other => `${articleFor(other)} ${other}`)
    const article = articleFor(typeName)
    const capitalized = article[0]!.toUpperCase() + article.slice(1)
    throw new Error(
      `${capitalized} ${typeName} cannot be combined with QueryByExample, ` +
        `standalone capability queries, or ${others.join(', or ')}.`
    )
  }
  return match as unknown as Query
}

/**
 * Which of the {@link EXCLUSIVE_QUERY_TYPES} a query set carries, or
 * `undefined` when none. Runs {@link exclusiveQueryOf} for every member, so a
 * set that mixes an exclusive type with `QueryByExample`, a standalone
 * capability query, or another exclusive type throws here whichever type is
 * asked about. `processRequest` dispatches on the result: the one type it has
 * a processor for takes its own branch, and any other is refused rather than
 * answered on the generic half of the request.
 *
 * @param queries {IVPRQuery[]}
 * @returns {ExclusiveQueryType | undefined}
 */
export function exclusiveQueryTypeOf(
  queries: IVPRQuery[]
): ExclusiveQueryType | undefined {
  return EXCLUSIVE_QUERY_TYPES.find(
    typeName => exclusiveQueryOf({ queries, typeName }) !== null
  )
}

/**
 * Parses a wire value as an absolute URL with no fragment: the shared core
 * every request field that copies a URL verbatim from an untrusted body
 * layers its own rule on top of (an App Connect `appUrl`'s same-origin check,
 * a wallet-onboarding `host`'s http(s)-only check). Throws a caller-supplied
 * message on a parse failure (with the parse error as `cause`) or on a
 * fragment, so each site keeps its own wording while the parse-and-no-
 * fragment logic is written once.
 *
 * The fragment check reads the serialized URL rather than `url.hash`: a bare
 * trailing `#` sets an empty (non-null) fragment that `hash` reports as `''`,
 * and a percent-encoded `%23` never appears as `#` in the serialization.
 *
 * @param options {object}
 * @param options.value {string}   the raw wire value to parse
 * @param options.notAbsoluteMessage {string}   thrown, with the parse error
 *   as `cause`, when `value` does not parse as an absolute URL
 * @param options.fragmentMessage {string}   thrown when the parsed URL
 *   carries a fragment
 * @returns {URL}   the parsed URL
 */
export function parsedAbsoluteUrl({
  value,
  notAbsoluteMessage,
  fragmentMessage
}: {
  value: string
  notAbsoluteMessage: string
  fragmentMessage: string
}): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch (err) {
    throw new Error(notAbsoluteMessage, { cause: err })
  }
  if (url.href.includes('#')) {
    throw new Error(fragmentMessage)
  }
  return url
}
