/*!
 * Copyright (c) 2026 Interop Alliance. All rights reserved.
 */
/**
 * The shared JSON-LD document loader every signing and verifying path in the
 * package uses: the standard security contexts plus the hosted App Connect
 * context, resolved from the bundled `byoe-context` document so neither
 * signing nor verification fetches it. Built once at module load. A context
 * URL that is not bundled is fetched over HTTPS through the global `fetch`.
 */
import { securityLoader } from '@interop/security-document-loader'
import { contexts as byoeContexts } from 'byoe-context'
import type { IDocumentLoader } from '@interop/data-integrity-core'

/**
 * Shared JSON-LD document loader for presentation, credential, and request
 * signing and verification. Exported so an app can hand the same context
 * resolution to its own signing paths.
 */
export const documentLoader: IDocumentLoader = (() => {
  const loader = securityLoader({ fetchRemoteContexts: true })
  for (const [url, context] of byoeContexts) {
    loader.addStatic(url, context)
  }
  return loader.build()
})()
