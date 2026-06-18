# Core Principles

> Engineering and design principles that govern every decision in this codebase.

---

## 1. Enhancement First

**Always prioritize enhancing existing components over creating new ones.**

Before adding a new file, module, route, or component, audit what exists. Can an existing piece be extended, parameterized, or generalized to cover the new requirement? New code should only exist when no existing code can be reasonably adapted.

**How to apply:**
- Before writing a new API route, check if an existing route can accept an additional query parameter or payload field
- Before creating a new React component, check if an existing component can be made more generic with props
- Before adding a new hook, check if an existing hook can be composed or extended
- Use the file tree and `code_searcher` to find existing implementations first

**Avoid:**
- Creating a "v2" of something when the v1 can be extended
- Parallel implementations of the same concept for different chains/providers
- "This is different enough to warrant its own thing" without a concrete, documented reason

---

## 2. Consolidation

**Delete unnecessary code rather than deprecating. Dead code is a liability, not an artifact.**

Deprecated code accumulates. It rots, confuses readers, creates false search results, and increases build times and bundle size. When a feature is removed, the code that implemented it must be deleted — not commented out, not if-gated, not left as a "maybe someday" relic.

**How to apply:**
- When removing a feature, delete its files, routes, components, hooks, and lib modules
- Update all references (imports, re-exports, config) atomically in the same PR
- Use `code_searcher` to find every reference before deleting
- If a module is genuinely useful later, git history preserves it — no need to keep dead files

**Avoid:**
- `// TODO: remove this later` — remove it now
- Leaving commented-out blocks "for reference"
- Deprecation warnings that nobody reads
- "We might need this again" — git revert is cleaner

---

## 3. Prevent Bloat

**Systematically audit and consolidate before adding new features.**

Every new feature has a cost: maintenance burden, cognitive load, bundle size, API surface area, test surface. Before the first line of new code, audit the existing surface for:
- What can be deleted to make room
- What can be extended instead of built alongside
- What the minimum viable change is

**How to apply:**
- Each new feature should come with a corresponding deletion or consolidation of equivalent scope
- Before starting, run a quick audit: "What in the codebase becomes redundant if I add this?"
- Set a budget: a new component = remove an old component of similar complexity
- The codebase should trend toward fewer, better files — not more files

**Avoid:**
- "Just adding one more file" without removing anything
- Feature creep disguised as "enhancement"
- Keeping unused features because they're "done" and "someone might use them"

---

## 4. DRY (Don't Repeat Yourself)

**Single source of truth for all shared logic.**

Every piece of business logic, configuration, type definition, and utility function should exist in exactly one canonical location. Duplication is the primary source of drift, bugs, and missed updates.

**How to apply:**
- Shared types live in `src/lib/` modules or their domain subdirectories — never inline in components
- Chain-specific constants (RPC URLs, program IDs, contract addresses) go in `src/lib/config.ts` — the single source of truth
- API clients and data-fetching logic go in `src/lib/` or `src/hooks/` — never inline in route handlers
- UI patterns (buttons, cards, badges, dialogs) use the shared `src/components/ui/` library
- Business logic (scoring, filtering, validation) lives in `src/lib/` modules — not in components or route handlers
- When you need the same logic in a route handler and a component, extract it to a shared lib module

**Avoid:**
- Copy-pasting validation logic across route handlers
- Re-defining the same types in multiple files
- Inline API URLs or magic strings
- Two components implementing the same data-fetching pattern differently

---

## 5. Clean

**Clear separation of concerns with explicit dependencies.**

Every module, component, and function should have a single, well-defined responsibility. Dependencies should be explicit (imported, not ambient) and should form a directed acyclic graph.

**How to apply:**
- Pages orchestrate — they import hooks and components, but contain minimal business logic
- Hooks mediate — they connect UI state to business logic and external services
- Lib modules compute — pure functions, data transformation, API clients
- Components present — they render props and call callbacks, but don't fetch data directly (delegate to hooks)
- Route handlers are thin — they validate input, call lib functions, return responses
- No circular dependencies — if module A imports B and B imports A, extract the shared dependency into C

**Avoid:**
- Components that call APIs directly instead of going through hooks
- Route handlers with inline business logic that should live in lib
- Ambient state (global variables, module-level mutable state) without explicit initialization
- "God modules" that know about routes, components, database schemas, and chain configurations

---

## 6. Modular

**Composable, testable, independent modules.**

Each module should be usable independently, composable with others, and testable in isolation. Modules communicate through well-defined interfaces (function signatures, TypeScript types, hook return values), not through shared mutable state.

**How to apply:**
- Each lib module exports a clean public API (one or a few functions/types) and keeps internals private
- Hooks return typed objects — consumers depend on the shape, not on internal implementation details
- Components accept props and render — they don't reach into global stores directly (use hooks or wrapper components)
- Pure business logic is extracted into lib modules with no React or Next.js dependency — testable with plain Jest/Vitest
- Side effects (API calls, localStorage, wallet connections) are isolated in hooks or service modules

**Avoid:**
- Modules with implicit runtime dependencies (e.g., a utility that reads from `process.env` directly instead of accepting a config parameter)
- Hooks that return raw state plus setters when a derived, stable interface would suffice
- Components that import directly from `@/lib/store` instead of going through a hook
- Circular dependencies between lib modules

---

## 7. Performant

**Adaptive loading, caching, and resource optimization.**

Performance isn't an afterthought — it's a design constraint. Every decision should consider bundle size, network requests, render cycles, and memory usage.

**How to apply:**
- Server-side data fetching where possible — route handlers should pre-compute and cache results
- Client components that depend on Node-only modules must be server-executed behind an API route (see `privacycash` pattern in `src/hooks/use-privacy-cash.ts`)
- React query for cache-coordinated data fetching — not raw `useEffect` + `fetch`
- Dynamic imports for heavy components (three.js, chart libraries, wallet adapters)
- Memoize expensive computations with `useMemo` and `useCallback`
- Set stale times aggressively for chain data that doesn't change frequently
- Bundle analysis — know what `next build` produces

**Avoid:**
- Importing heavy SDKs (wallet adapters, charting libraries) in the root layout
- Fetching the same data in multiple parallel components — lift to a parent hook
- Unnecessary re-renders from store subscriptions — use selectors, not full-store subscriptions
- Client-side computation of data that could be pre-computed server-side

---

## 8. Organized

**Predictable file structure with domain-driven design.**

The file tree should communicate the architecture. A developer should be able to find any file by reasoning about what domain it belongs to and what layer it operates at.

**How to apply:**
```
src/
  app/           # Next.js App Router — pages, API routes, layouts
    page.tsx     #   Routes mirror the URL structure
    api/         #   API routes grouped by domain (/alpha/, /aleo/, /cohort/)
  components/    # React components
    ui/          #   Reusable primitives (button, card, dialog, input)
    <domain>/   #   Domain-specific components (alpha/, aleo/, mantle/)
  hooks/         # React hooks — one file per hook, named use-<domain>.ts
  lib/           # Business logic, utilities, configurations
    <domain>/   #   Domain-specific lib (aleo/, alpha/, db/, services/)
    config.ts    #   Single source of truth for all configuration
    utils.ts     #   Pure utility functions with no business logic
    store.ts     #   Global state (Zustand) — one store, selectors in hooks
```

- One concept, one file. If a file needs "and" in its purpose, split it.
- Domain directories are flat — no nested subdirectories beyond one level
- File names are kebab-case for everything (utility files) or PascalCase for components
- Test files sit next to their source: `foo.ts` → `foo.test.ts`

**Avoid:**
- A `utils/` or `helpers/` directory — utilities are domain-specific and belong in the domain's lib directory
- Deeply nested component directories (beyond `components/<domain>/<component>.tsx`)
- Files named `index.tsx` — named exports are better for searchability
- Mixing concerns in a single file (e.g., a component that also defines its styles, types, and data-fetching logic inline)

---

## Applying These Principles

These principles are ordered by priority. When two principles conflict, the higher-priority one wins:

```
ENHANCEMENT FIRST > CONSOLIDATION > PREVENT BLOAT > DRY > CLEAN > MODULAR > PERFORMANT > ORGANIZED
```

For example, if making code DRY would require creating a new module when an existing one could be enhanced, **Enhancement First** wins. If deleting dead code would temporarily make the file tree less organized, **Consolidation** wins over **Organized**.

When in doubt, optimize for:
1. **Less code** — fewer files, fewer lines, fewer concepts
2. **Clear intent** — the code should communicate what it does without comments
3. **Easy deletion** — if a feature dies, its code should be trivially removable
