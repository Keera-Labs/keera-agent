---
name: frontend
description: Conventions for keera-agent's Vue 3 + Inertia frontend in resources/js (pages, components, queries, stores, composables, tests).
---

# Frontend

Vue 3 `<script setup lang="ts">` SFCs, TypeScript, Inertia.js via `@inertiajs/vue3`, Pinia + Pinia Colada, Tailwind CSS v4, vitest. No comments or docstrings; express intent through naming and structure.

## Pages and layout

- `resources/js/app.ts` resolves every page from `resources/js/pages/<Name>.vue` and wraps it in `layouts/AppLayout.vue` (plus `layouts/ProjectLayout.vue` when the page has a `project` prop). `AppLayout` never unmounts across navigations.
- Navigate with the Inertia router (`router.visit(url)`), never full page loads.
- Page props come from the server's `Inertia.render("Name", props)`; do not refetch them. For server-driven page details see `.ai/fastapi-startkit/inertia/SKILL.md`.

## Components

- `resources/js/components/` holds only reusable components used by two or more pages.
- Page-specific components live beside their page in `resources/js/pages/<page>/` (canonical example: `pages/dashboard/` next to `pages/Dashboard.vue`).
- A page entry and its folder differ only in case, so import the folder barrel with an explicit path, e.g. `@/pages/dashboard/index`; a bare `@/pages/dashboard` resolves to the entry file on case-insensitive filesystems.

## State and data

- Server data: Pinia Colada queries in `resources/js/queries/` (`useProjects`, `useTasks`). After a mutation, invalidate the matching key, e.g. `useQueryCache().invalidateQueries({ key: PROJECTS_QUERY_KEY })`.
- Shared client state: Pinia stores in `resources/js/stores/`.
- Reusable logic: composables in `resources/js/composables/` named `useX`.
- Terminal sessions and their WebSockets are owned by `stores/appLayoutStore.ts` via `composables/useTerminalSessions.ts`, not by components, so they survive page transitions. Keep xterm objects raw with `markRaw`.

## HTTP requests and forms

- Make API requests with `useHttp` from `@inertiajs/vue3` (`get`, `post`, `put`, `patch`, `delete`), never plain `fetch`. Create one `useHttp` instance per independent request so processing state and abort controllers are not shared; see `queries/agentCheckinQuery.ts`. Wrap it in a Pinia Colada `useQuery`/`useMutation` for server data.
- Handle form submissions with Inertia's `useForm`, or another Inertia helper when one fits, never hand-rolled `fetch` or manual form state.

## Verify

- `npm run types:check`
- `npm run test:frontend` (vitest; tests sit beside the page or component as `*.test.ts`)
