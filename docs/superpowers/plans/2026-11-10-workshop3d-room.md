# Workshop 3D Room (parts 3 and 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Steps use `- [ ]`.

**Goal:** A 2.5D isometric "Phòng dựng 3D" with nine distinct characters whose actions follow the workshop3d session state, opened from a `Design3DTower` floor.

**Architecture:** Same layering as the gym: pure state/phase logic (`workshop3d.ts`), pure geometry + BFS (`workshop3d-layout.ts`, reusing the grid/path code of the gym through its own cell constants), a deterministic simulation (`workshop3d-scene.ts`), then React (`Workshop3DRoom.tsx` + `Workshop3DEquipment.tsx`). Session data is polled over REST (~3 s) by `useWorkshop3DSession`; while `/api/workshop3d` does not exist the room shows a friendly empty state.

**Tech Stack:** React + Vite, SVG isometric helpers (`office/iso/depth`, `IsoFurniture` `isoBox`), vitest.

**Spec:** `docs/superpowers/specs/2026-11-10-workshop-3d-design.md` sections 8 and 9.

## Global Constraints

- No server (`src/`) changes; do not edit `Workshop3DViewer*` / `Model3DViewer*`.
- `i18n.ts`, `popup.ts`, `App.tsx`, `CityScene.tsx`, `IsoPerson.tsx`: add only, never reorder.
- i18n key prefix `w3r_`, both `vi` and `en`. UI text Vietnamese, code English.
- No `sessionStorage`. Layout must work at 375 px and >= 1280 px. CityScene stays `main.scene`.
- Must keep passing: `city-scene-design3d`, `app-design3d-wiring`, gym tests, i18n parity tests.

## Tasks

### Task 1: pure phase logic (`ui/src/office/workshop3d.ts`, test `tests/workshop3d.test.ts`)
- [ ] Test: every state of the spec maps to a phase; unknown -> `idle`; paused/stopped/waiting_quota -> `rest`; nine roles with distinct looks (suit colours unique, accessory per role); `w3dScene(phase)` gives the active role + podium stage 0..4 (wireframe -> solids -> materials -> final); `done` => cheering.
- [ ] Implement; run `npx vitest run tests/workshop3d.test.ts`.
- [ ] Commit.

### Task 2: layout + BFS (`workshop3d-layout.ts`, test `tests/workshop3d-layout.test.ts`)
- [ ] Test: room 16 x 13.5, every role work spot is free and reachable from every home, no overlapping blocking rects, rest seats reachable.
- [ ] Implement zones: reception, mood-board wall, drafting desk, plan table, material shelf, 3D printer, podium, studio, review desk, rest area, coffee, wall screen.
- [ ] Commit.

### Task 3: simulation (`workshop3d-scene.ts`, test `tests/workshop3d-scene.test.ts`)
- [ ] Test: for every phase the active role reaches its work spot and performs the right act within N ticks; `done` makes everyone clap; `rest` seats people; nobody leaves the room; deterministic with seeded rng.
- [ ] Implement `createW3DSim/directW3D/tickW3D`.
- [ ] Commit.

### Task 4: character accessories (`IsoPerson.tsx`, test `tests/iso-person-w3d.test.ts`)
- [ ] Add `headgear` `beret` | `ar`, `neckwear` `apron`, `holding` `camera` | `loupe` | `tablet` | `clipboard`; old looks render identically.
- [ ] Commit.

### Task 5: room component (`Workshop3DRoom.tsx`, `Workshop3DEquipment.tsx`, css)
- [ ] Render test over all 16 states (no NaN, >= 9 people, roles present).
- [ ] Commit.

### Task 6: popup, tower, i18n
- [ ] `PopupId` `workshop3d`; App branch; `Workshop3DPopup` with tabs Room / Files; placeholder for the 3D viewer; REST poll hook with mock for dev (`?w3dmock=` in the hash is not used; a `mock` prop on the room drives the demo).
- [ ] `w3r_` keys vi/en + parity test.
- [ ] Commit.

### Task 7: verification
- [ ] typecheck, vitest (related), build:ui, browser at 375 and >= 1280 px through every state, screenshots `docs/screens/w3d-room-*.jpg`, `docs/PROGRESS.md` entry, commit.
