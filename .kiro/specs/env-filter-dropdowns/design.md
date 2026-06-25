# Design Document: Environment Filter Dropdowns

## Overview

Step 1 of the reload stepper currently shows Site, Area, and Tester Type as static read-only metadata chips that populate after an environment is chosen. This change promotes them to interactive `GlassSelect` dropdown filters that bidirectionally influence the Environment selector:

- Choosing a filter narrows the Environment list (filter → env direction).
- Choosing an Environment populates the filters with that env's metadata values and narrows the env list to siblings (env → filter direction).

No backend changes are needed — all filtering is performed client-side over the `EnvYearRange[]` already loaded by `GET /xfcs/envs`.

---

## Architecture

```
XfcsStepperComponent
  signals:
    envs               : EnvYearRange[]     (from API)
    filterSite         : string             (selected site name, '' = all)
    filterArea         : string             (selected area code, '' = all)
    filterTesterType   : string             (selected tester type, '' = all)
    environment        : string             (selected env key)

  computed:
    filteredEnvs       ← envs filtered by filterSite + filterArea + filterTesterType
    siteOptions        ← distinct siteName values from envs (not filtered — always full)
    areaOptions        ← distinct areaCode values from envs where site matches filterSite (or all)
    testerTypeOptions  ← distinct testerType from envs where site+area match active filters
    envOptions         ← grouped GlassOption[] built from filteredEnvs
    selectedEnvInfo    ← EnvYearRange for current environment (unchanged)
```

The cascading logic is encapsulated in computed signals — no imperative side-effect chains. The bidirectional sync from env → filters is handled in a dedicated `onEnvironmentChange(value)` method called by the env selector's `(ngModelChange)`.

---

## Components and Interfaces

### XfcsStepperComponent changes

**New signals:**
```typescript
filterSite        = signal<string>('');
filterArea        = signal<string>('');
filterTesterType  = signal<string>('');
```

**New / updated computed signals:**

```typescript
// Environments that pass all three active filters
filteredEnvs = computed<EnvYearRange[]>(() => {
  return this.envs().filter(e =>
    (!this.filterSite()       || e.siteName   === this.filterSite()) &&
    (!this.filterArea()       || e.areaCode   === this.filterArea()) &&
    (!this.filterTesterType() || e.testerType === this.filterTesterType())
  );
});

// Site options: all distinct sites from the full env list (not narrowed)
siteOptions = computed<GlassOption[]>(() => {
  const sites = [...new Set(this.envs().map(e => e.siteName).filter(Boolean))].sort();
  return [
    { value: '', label: 'All Sites' },
    ...sites.map(s => ({ value: s, label: s }))
  ];
});

// Area options: sites not selected → all areas; site selected → only areas in that site
areaOptions = computed<GlassOption[]>(() => {
  const base = this.filterSite()
    ? this.envs().filter(e => e.siteName === this.filterSite())
    : this.envs();
  const areas = [...new Set(base.map(e => e.areaCode).filter(Boolean))].sort();
  return [
    { value: '', label: 'All Areas' },
    ...areas.map(a => ({ value: a, label: a }))
  ];
});

// Tester type options: narrowed by current site + area filters
testerTypeOptions = computed<GlassOption[]>(() => {
  const base = this.envs().filter(e =>
    (!this.filterSite() || e.siteName === this.filterSite()) &&
    (!this.filterArea() || e.areaCode === this.filterArea())
  );
  const types = [...new Set(base.map(e => e.testerType).filter(Boolean))].sort();
  return [
    { value: '', label: 'All Tester Types' },
    ...types.map(t => ({ value: t, label: t }))
  ];
});

// envOptions now built from filteredEnvs instead of full envs()
envOptions = computed<GlassOption[]>(() => {
  // Same grouping logic as today (STANDARD PLANTS / FOUNDRY hierarchy)
  // but operating on this.filteredEnvs() instead of this.envs()
  ...
});
```

**Updated `onEnvironmentChange(value: string)` method (replaces direct signal binding):**
```typescript
onEnvironmentChange(value: string): void {
  this.environment.set(value);
  if (!value) return;
  const meta = this.envs().find(e => e.environment === value);
  if (!meta) return;
  // Sync filters to the chosen env's metadata (env → filters direction)
  this.filterSite.set(meta.siteName ?? '');
  this.filterArea.set(meta.areaCode ?? '');
  this.filterTesterType.set(meta.testerType ?? '');
}
```

**Updated `resetAll()`:**
```typescript
resetAll(): void {
  // existing resets …
  this.filterSite.set('');
  this.filterArea.set('');
  this.filterTesterType.set('');
}
```

**Filter change handlers** (called by each dropdown's `ngModelChange`):
```typescript
onFilterSiteChange(value: string): void {
  this.filterSite.set(value);
  // Clear area/testerType if no longer valid in new set
  const newAreaOpts = this.areaOptions().map(o => o.value);
  if (this.filterArea() && !newAreaOpts.includes(this.filterArea())) {
    this.filterArea.set('');
  }
  const newTypeOpts = this.testerTypeOptions().map(o => o.value);
  if (this.filterTesterType() && !newTypeOpts.includes(this.filterTesterType())) {
    this.filterTesterType.set('');
  }
  // Clear env if no longer in filtered set
  if (this.environment() && !this.filteredEnvs().some(e => e.environment === this.environment())) {
    this.environment.set('');
  }
}

onFilterAreaChange(value: string): void {
  this.filterArea.set(value);
  const newTypeOpts = this.testerTypeOptions().map(o => o.value);
  if (this.filterTesterType() && !newTypeOpts.includes(this.filterTesterType())) {
    this.filterTesterType.set('');
  }
  if (this.environment() && !this.filteredEnvs().some(e => e.environment === this.environment())) {
    this.environment.set('');
  }
}

onFilterTesterTypeChange(value: string): void {
  this.filterTesterType.set(value);
  if (this.environment() && !this.filteredEnvs().some(e => e.environment === this.environment())) {
    this.environment.set('');
  }
}
```

### Template changes

Replace the existing `<div class="env-meta-grid">` static chips with an **active filter row** above the environment selector, then keep a slimmed-down metadata confirmation row below:

```html
<!-- Filter row: Site | Area | Tester Type -->
<div class="filter-row">
  <app-glass-select
    label="Site"
    placeholder="All Sites"
    [options]="siteOptions()"
    [ngModel]="filterSite()"
    (ngModelChange)="onFilterSiteChange($event)">
  </app-glass-select>
  <app-glass-select
    label="Area"
    placeholder="All Areas"
    [options]="areaOptions()"
    [ngModel]="filterArea()"
    (ngModelChange)="onFilterAreaChange($event)">
  </app-glass-select>
  <app-glass-select
    label="Tester Type"
    placeholder="All Tester Types"
    [options]="testerTypeOptions()"
    [ngModel]="filterTesterType()"
    (ngModelChange)="onFilterTesterTypeChange($event)">
  </app-glass-select>
</div>

<!-- Environment selector (existing, now uses filteredEnvs via envOptions) -->
<app-glass-select
  label="Environment"
  placeholder="Select an environment"
  ...
  (ngModelChange)="onEnvironmentChange($event)">
</app-glass-select>

<!-- Confirmation chips (read-only, shown after env selected) -->
<div class="env-meta-grid" [class.has-env]="!!selectedEnvInfo()">
  <!-- site / area / testerType chips — unchanged from today -->
</div>
```

**New CSS class:**
```scss
.filter-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 0.75rem;
}
@media (max-width: 768px) {
  .filter-row { grid-template-columns: 1fr; }
}
```

---

## Data Models

No new data models. All filtering operates on the existing `EnvYearRange[]` loaded at component init.

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: filteredEnvs respects all active filters

*For any* list of `EnvYearRange` records and any combination of `filterSite`, `filterArea`, `filterTesterType` values, every environment in `filteredEnvs` SHALL match all non-empty filter values, and no environment that matches all non-empty filters SHALL be absent from `filteredEnvs`.

**Validates: Requirements 1.3, 2.4, 3.3**

---

### Property 2: Filter option lists contain only realised values

*For any* list of `EnvYearRange` records and any `filterSite` value, every `areaCode` value in `areaOptions` SHALL correspond to at least one environment whose `siteName` equals `filterSite` (when `filterSite` is non-empty).

*For any* list of `EnvYearRange` records and any `filterSite` + `filterArea` combination, every `testerType` in `testerTypeOptions` SHALL correspond to at least one environment matching both filters (when they are non-empty).

**Validates: Requirements 2.2, 3.2**

---

### Property 3: Env selection syncs filters (env → filters direction)

*For any* environment selected via `onEnvironmentChange`, the resulting `filterSite`, `filterArea`, and `filterTesterType` signals SHALL equal the `siteName`, `areaCode`, and `testerType` of that environment's `EnvYearRange` record.

**Validates: Requirements 4.5, 4.6**

---

### Property 4: Filter change clears incompatible downstream values

*For any* initial filter state and any filter change that removes the current `filterArea` value from `areaOptions`, the resulting `filterArea` SHALL be `''`. Similarly for `filterTesterType` after any change that removes it from `testerTypeOptions`.

**Validates: Requirements 4.1, 4.2**

---

### Property 5: Environment cleared when no longer in filtered set

*For any* selected environment and any filter change that causes `filteredEnvs` to exclude that environment, the resulting `environment` signal SHALL be `''`.

**Validates: Requirements 4.4**

---

### Property 6: Reset produces empty filter state

*For any* stepper state, after `resetAll()` the `filterSite`, `filterArea`, and `filterTesterType` signals SHALL all equal `''`, and `envOptions` SHALL reflect the full unfiltered environment list.

**Validates: Requirements 5.1, 5.2**

---

### Property 7: selectedEnvInfo resolves to the correct environment record

*For any* environment string set via `onEnvironmentChange`, the `selectedEnvInfo` computed signal SHALL return the `EnvYearRange` record whose `environment` field equals that string, or `null` if no such record exists.

**Validates: Requirements 6.1**

---

## Error Handling

| Scenario | Behavior |
|---|---|
| `EnvYearRange.areaCode` or `testerType` is null/undefined | Filtered out of option lists (`filter(Boolean)` guard); treated as non-matching |
| All envs filtered out by an impossible filter combination | `filteredEnvs = []`, `envOptions = []`; env selector shows "No results" via GlassSelect empty state |
| Environment loaded after filters are set | `filteredEnvs` recomputes automatically via computed signal reactivity |
| `filterArea` value becomes invalid after `filterSite` change | Auto-cleared by `onFilterSiteChange` guard |

---

## Testing Strategy

### Unit Tests

- `filteredEnvs` with all filters empty returns full list
- `filteredEnvs` with one filter set returns correct subset
- `filteredEnvs` with all three filters set returns exact matches only
- `areaOptions` with no site filter returns all distinct areas
- `areaOptions` with site filter returns only areas for that site
- `testerTypeOptions` with site+area both set returns intersection
- `onEnvironmentChange` sets all three filter signals correctly
- `onFilterSiteChange` clears area and testerType when they become invalid
- `onFilterSiteChange` clears environment when no longer in filtered set
- `resetAll` sets all three filter signals to `''`

### Property-Based Tests

Uses **fast-check** (TypeScript/Angular). Each property test runs a minimum of 100 iterations.

- **Property 1** — Tag: `Feature: env-filter-dropdowns, Property 1: filteredEnvs respects all active filters`
  Generate random `EnvYearRange[]` and random filter values drawn from that list. Assert every item in `filteredEnvs` matches all non-empty filters, and no matching item is absent.

- **Property 2** — Tag: `Feature: env-filter-dropdowns, Property 2: filter option lists contain only realised values`
  Generate random `EnvYearRange[]` and a random `filterSite` value. Assert every `areaCode` in `areaOptions` has at least one matching env.

- **Property 3** — Tag: `Feature: env-filter-dropdowns, Property 3: env selection syncs filters`
  Generate random `EnvYearRange[]`. Pick a random env. Call `onEnvironmentChange`. Assert filter signals match the env's metadata.

- **Property 4** — Tag: `Feature: env-filter-dropdowns, Property 4: filter change clears incompatible downstream values`
  Generate random filter states and a new `filterSite` that invalidates the current `filterArea`. Assert `filterArea` is `''` afterward.

- **Property 5** — Tag: `Feature: env-filter-dropdowns, Property 5: environment cleared when no longer in filtered set`
  Generate an env list, select an env, then change a filter that excludes it. Assert `environment` is `''`.

- **Property 6** — Tag: `Feature: env-filter-dropdowns, Property 6: reset produces empty filter state`
  Generate any state with non-empty filters. Call `resetAll`. Assert all filter signals are `''`.

- **Property 7** — Tag: `Feature: env-filter-dropdowns, Property 7: selectedEnvInfo resolves correctly`
  Generate random `EnvYearRange[]` and pick a random env key. Call `onEnvironmentChange`. Assert `selectedEnvInfo` equals the correct `EnvYearRange` record.
