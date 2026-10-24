# deedlit.dev.portal — Copilot Instructions

## What This Package Owns
A private Next.js service portal: the signed-in services dashboard (`/`), the account page (`/account`), sign-in (`/login`) and the JSON view at `/api/portal/services`. There is no public content — every route needs a session except the allow-list in `src/lib/public-paths.ts`.

## Architecture
- App Router in `src/app/`. Signed-in pages live in the `(portal)` route group; its `layout.tsx` is the server-side session check and renders the shell.
- Default to Server Components. Add `"use client"` only when state, effects, browser APIs, or direct event handling require it.
- Features under `src/features/<feature>/` (today only `services`); shared shell components in `src/components/`; cross-feature utilities in `src/lib/`. Use the `@/` alias.

## Security Rules (do not weaken)
- New routes are private by default. Making one public means adding it to `src/lib/public-paths.ts` with a reason and a test.
- Every page calls `requireSession()`; every route handler and server action calls `auth()` and refuses without a session. Never rely on the proxy or a layout alone.
- Never pass a raw `callbackUrl` to `redirect()` — use `safeCallbackUrl()`.
- Inline scripts take the CSP nonce from `x-nonce`; never relax the CSP.

## Shared UI Rules
- Reuse `@carneirofc/ui` before adding one-off primitives; promote generic controls into `deedlit.dev.ui`.
- The kit's stylesheet overrides `font` on `button`/`input` without a layer, so font-size utilities there need the important modifier (`text-xs!`). `text-base` is a colour token in this app, not a size.

## Testing And Verification
- `npm test` (Vitest) covers the security-critical rules and the dashboard summary logic; a fix to any of them ships with a test.
- `npm run lint` (Biome), `npx tsc --noEmit`, `npm run build`.

## Change Boundaries
- Service listings are cluster data: to add a service, annotate its Ingress in `deedlit.dev.infra`, not here.
