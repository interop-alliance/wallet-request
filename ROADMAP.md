# Wallet Request Roadmap (open items)

nextAvailableId: 6

Status as of 2026-09-09. Uses the formalized item structure shared with the
freewallet and was-teaching-server roadmaps.

Scope: open work items only. This document tracks the **remaining** items;
completed items move verbatim to [archived-roadmap.md](archived-roadmap.md) as
they land, so WR-N references keep resolving (CHANGELOG.md remains the record of
what landed).

## Item format

Each work item is a `### WR-N: Title` heading followed by a field block and free
prose context. Ids are permanent and never reused. The `nextAvailableId` line at
the top of this file is the next id to take: filing an item takes that number
and rewrites the line to one higher, in the same edit. Statuses: `todo`,
`in-progress`, `draft` (no actionable done-state yet -- blocked externally or a
parking record); `done` items move to [archived-roadmap.md](archived-roadmap.md)
once shipped. Full conventions live in [AGENTS.md](AGENTS.md) under "Roadmap &
Task Conventions".

## Dependencies

### WR-5: The root entry pays for was-client's `paths` graph to validate one URL

- status: todo
- priority: low
- labels: onboarding, dependencies, import-weight
- touches:
  - was-client: WCL-149 (done 2026-10-30; `@interop/was-client/paths/layout`,
    the dependency-free part of `./paths` carrying `canonicalBaseServerUrl`,
    ships in was-client 0.103.0 and is named in its ARCHITECTURE.md)
  - this repo's ARCHITECTURE.md: the `onboarding.ts` edge in the module graph
    and the "Import-free helpers" row name the subpath consumed
- acceptance:
  - [ ] Importing this package's root entry under plain Node ESM no longer loads
        `@interop/storage-core` or `@interop/zcap` on behalf of
        `serializedBaseServerUrl`
  - [ ] `onboarding.ts` imports `canonicalBaseServerUrl` from
        `@interop/was-client/paths/layout` (one rule, not a local copy), and the
        dependency range names a was-client that has it (0.103.0 or later)
  - [ ] ARCHITECTURE.md names the subpath consumed and why it is the light one

Context: WR-4 made `onboarding.ts` import `canonicalBaseServerUrl` from
`@interop/was-client/paths`, so that the base server URL an inviter publishes is
validated by the same rule the enrollee's `WasClient` constructor applies. That
subpath is a leaf in was-client's export map and does not load the client
itself, but its own graph (`internal/paths`, `internal/reserved`,
`internal/rootCapability`, `errors`) imports `@interop/storage-core` for the
reserved-id lists and problem types, and `@interop/zcap` for the root-capability
helpers. was-client declares `sideEffects: false`, so a bundler shakes those
away, but under plain Node ESM the whole graph loads on first import of this
package's root entry, and every root consumer pays it whether or not it ever
composes or classifies a `WalletOnboardingQuery`. The `./matching` leaf is
unaffected: it does not import `onboarding.ts`.

Re-stating the rule locally is not an option (one rule, owned upstream). The
upstream half is done: was-client's WCL-149 (2026-10-30) split the layout
grammar out as `./paths/layout`, whose static closure holds no external package.
What remains here is to import from that subpath instead of `./paths` once
was-client 0.103.0 is published, and to update the module-graph note. Filed from
the /simplify pass of 2026-10-30 as a skipped efficiency finding;
discovered-from: WR-4.
