# Implementation Plan: Environment Filter Dropdowns

## Overview

Pure frontend change to `XfcsStepperComponent`. Adds three filter signals, four computed signals, handler methods, template controls, and property-based tests. No backend work required.

## Tasks

- [x] 1. Add filter signals and core computed logic
  - Add `filterSite`, `filterArea`, `filterTesterType` signals (default `''`) to `XfcsStepperComponent`
  - Add `filteredEnvs` computed signal that filters `envs()` by all three non-empty filter values
  - Add `siteOptions` computed signal: all distinct `siteName` values from full `envs()`, sorted, prefixed with `{ value: '', label: 'All Sites' }`
  - Add `areaOptions` computed signal: distinct `areaCode` values from envs matching current `filterSite` (or all when empty), prefixed with `{ value: '', label: 'All Areas' }`
  - Add `testerTypeOptions` computed signal: distinct `testerType` values from envs matching `filterSite` + `filterArea`, prefixed with `{ value: '', label: 'All Tester Types' }`
  - Update `envOptions` to build its grouped option list from `filteredEnvs()` instead of `envs()`
  - _Requirements: 1.2, 1.3, 2.2, 2.3, 3.2, 1.5, 2.6, 3.5_

- [ ]* 1.1 Write property test for filteredEnvs (Property 1)
  - **Property 1: filteredEnvs respects all active filters**
  - **Validates: Requirements 1.3, 2.4, 3.3**

- [ ]* 1.2 Write property test for filter option lists (Property 2)
  - **Property 2: filter option lists contain only realised values**
  - **Validates: Requirements 2.2, 3.2**

- [x] 2. Add bidirectional sync and filter change handlers
  - Add `onEnvironmentChange(value: string)` method: sets `environment` signal then reads the matching `EnvYearRange` and sets `filterSite`, `filterArea`, `filterTesterType` to that env's metadata values (env → filters direction)
  - Add `onFilterSiteChange(value: string)` method: sets `filterSite`, then clears `filterArea` if it is no longer in `areaOptions`, clears `filterTesterType` if no longer in `testerTypeOptions`, clears `environment` if no longer in `filteredEnvs`
  - Add `onFilterAreaChange(value: string)` method: sets `filterArea`, clears `filterTesterType` if invalid, clears `environment` if excluded
  - Add `onFilterTesterTypeChange(value: string)` method: sets `filterTesterType`, clears `environment` if excluded
  - Update `resetAll()` to also call `filterSite.set('')`, `filterArea.set('')`, `filterTesterType.set('')`
  - _Requirements: 4.1, 4.2, 4.4, 4.5, 4.6, 5.1_

- [ ]* 2.1 Write property test for env → filters sync (Property 3)
  - **Property 3: env selection syncs filters**
  - **Validates: Requirements 4.5, 4.6**

- [ ]* 2.2 Write property test for downstream filter clearing (Property 4)
  - **Property 4: filter change clears incompatible downstream values**
  - **Validates: Requirements 4.1, 4.2**

- [ ]* 2.3 Write property test for environment cleared on filter change (Property 5)
  - **Property 5: environment cleared when no longer in filtered set**
  - **Validates: Requirements 4.4**

- [ ]* 2.4 Write property test for resetAll (Property 6)
  - **Property 6: reset produces empty filter state**
  - **Validates: Requirements 5.1, 5.2**

- [ ] 3. Checkpoint — Ensure all logic tests pass
  - Run `ng test --include=**/xfcs-stepper*` (or equivalent), ensure all new property tests pass. Ask the user if any test is unclear.

- [x] 4. Update the Step 1 template
  - Add a `<div class="filter-row">` grid with three `<app-glass-select>` controls (Site, Area, Tester Type) positioned above the existing Environment selector
  - Wire Site select: `[options]="siteOptions()"`, `[ngModel]="filterSite()"`, `(ngModelChange)="onFilterSiteChange($event)"`
  - Wire Area select: `[options]="areaOptions()"`, `[ngModel]="filterArea()"`, `(ngModelChange)="onFilterAreaChange($event)"`
  - Wire Tester Type select: `[options]="testerTypeOptions()"`, `[ngModel]="filterTesterType()"`, `(ngModelChange)="onFilterTesterTypeChange($event)"`
  - Change the Environment selector's `(ngModelChange)` from direct `environment.set($event)` to `onEnvironmentChange($event)`
  - Keep the existing `<div class="env-meta-grid">` confirmation chips below the Environment selector unchanged
  - Add `.filter-row` CSS (3-column grid, responsive to 1-column on ≤768px)
  - _Requirements: 1.1, 2.1, 3.1, 6.1, 6.2_

- [ ]* 4.1 Write property test for selectedEnvInfo (Property 7)
  - **Property 7: selectedEnvInfo resolves to the correct environment record**
  - **Validates: Requirements 6.1**

- [ ] 5. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- All filtering is client-side — no API changes required
- `envOptions` grouping logic (STANDARD PLANTS / FOUNDRY hierarchy) is preserved; it just operates on `filteredEnvs()` instead of `envs()`
- Property tests use **fast-check** (already in the project's dev dependencies via existing test files)
