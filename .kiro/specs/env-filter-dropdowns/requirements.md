# Requirements Document

## Introduction

Currently in Step 1 (Target Selection) of the reload stepper, the Site, Area, and Tester Type fields are read-only metadata chips that auto-populate when an environment is selected. This feature converts those three fields into independent searchable dropdown filters that allow the user to narrow the environment list before making a final selection — making it faster to find the right environment when many environments are configured.

## Glossary

- **Environment**: A named archive configuration (e.g. `CZ2_SPD_T`) that identifies a specific tester vault.
- **EnvYearRange**: The backend model returned by `GET /xfcs/envs`; each record has `siteName`, `areaCode`, `testerType`, and `environment` fields.
- **Filter Dropdowns**: The Site, Area, and Tester Type `<app-glass-select>` controls that drive progressive filtering of the environment list.
- **Stepper**: The `XfcsStepperComponent` multi-step wizard used to create a reload request.
- **GlassSelect**: The shared `<app-glass-select>` dropdown component supporting searchable and grouped options.

---

## Requirements

### Requirement 1: Site Dropdown Filter

**User Story:** As a user, I want to filter environments by site using a dropdown, so that I can narrow down the list when environments from multiple sites are loaded.

#### Acceptance Criteria

1. THE Stepper SHALL display a Site dropdown in Step 1 below the Environment selector.
2. WHEN the environment list is loaded, THE Stepper SHALL populate the Site dropdown with a deduplicated, sorted list of `siteName` values from all active environments.
3. WHEN the user selects a Site value, THE Stepper SHALL filter the Environment dropdown options to only show environments matching that site.
4. WHEN the user clears the Site selection, THE Stepper SHALL restore all environments to the Environment dropdown.
5. THE Site dropdown SHALL include a blank/empty option that means "All Sites".

---

### Requirement 2: Area Dropdown Filter

**User Story:** As a user, I want to filter environments by area using a dropdown, so that I can quickly narrow down to a specific fab area.

#### Acceptance Criteria

1. THE Stepper SHALL display an Area dropdown in Step 1, alongside the Site dropdown.
2. WHEN a Site is selected, THE Stepper SHALL populate the Area dropdown with only the `areaCode` values available within that site.
3. WHEN no Site is selected, THE Stepper SHALL populate the Area dropdown with all distinct `areaCode` values across all environments.
4. WHEN the user selects an Area value, THE Stepper SHALL further filter the Environment dropdown to only show environments matching both the selected Site (if any) and the selected Area.
5. WHEN the user clears the Area selection, THE Stepper SHALL relax the area filter while preserving any active site filter.
6. THE Area dropdown SHALL include a blank/empty option that means "All Areas".

---

### Requirement 3: Tester Type Dropdown Filter

**User Story:** As a user, I want to filter environments by tester type using a dropdown, so that I can quickly find environments for a specific tester family.

#### Acceptance Criteria

1. THE Stepper SHALL display a Tester Type dropdown in Step 1, alongside the Site and Area dropdowns.
2. WHEN Site or Area filters change, THE Stepper SHALL repopulate the Tester Type dropdown to show only the `testerType` values available in the currently filtered environment set.
3. WHEN the user selects a Tester Type value, THE Stepper SHALL further filter the Environment dropdown to match all active filter selections.
4. WHEN the user clears the Tester Type selection, THE Stepper SHALL relax the tester type filter while preserving any other active filters.
5. THE Tester Type dropdown SHALL include a blank/empty option that means "All Tester Types".

---

### Requirement 4: Cascading Filter Coordination (Bidirectional)

**User Story:** As a user, I want the filter dropdowns and the environment selector to stay in sync with each other in both directions, so that selecting either a filter or an environment always produces a consistent, non-contradictory state.

#### Acceptance Criteria

1. WHEN any filter (Site, Area, or Tester Type) value changes, THE Stepper SHALL recompute the available options for the other filters based on the current filtered environment set, removing options that would yield zero results.
2. WHEN a previously selected filter value is no longer present in the updated options (due to another filter change), THE Stepper SHALL clear that filter's value automatically.
3. WHEN all three filters are cleared, THE Stepper SHALL display the full grouped environment list as before.
4. WHEN the selected Environment is no longer in the filtered set after a filter change, THE Stepper SHALL clear the Environment selection.
5. WHEN the user selects an Environment directly, THE Stepper SHALL update the Site, Area, and Tester Type filter dropdowns to reflect that environment's `siteName`, `areaCode`, and `testerType` values respectively.
6. WHEN the user selects an Environment directly, THE Stepper SHALL narrow the Environment dropdown options to only those matching the now-set filter values (i.e. environments sharing the same site, area, and tester type).

---

### Requirement 5: Filter Reset

**User Story:** As a user, I want the filter dropdowns to reset together with the rest of Step 1, so that clicking "Reset All" gives me a fully clean state.

#### Acceptance Criteria

1. WHEN the user clicks "Reset All", THE Stepper SHALL clear the Site, Area, and Tester Type filter selections in addition to the existing reset behavior.
2. AFTER a reset, THE Environment dropdown SHALL display all available environments.

---

### Requirement 6: Metadata Display

**User Story:** As a user, I want the Site, Area, and Tester Type values for the chosen environment to still be clearly visible after selection, so that I can confirm I picked the right environment.

#### Acceptance Criteria

1. WHEN an environment is selected, THE Stepper SHALL display the resolved `siteName`, `areaCode`, and `testerType` values in the existing read-only metadata chips below the filter row.
2. WHEN the filter dropdowns are used to narrow the list, THE metadata chips SHALL reflect the values of the ultimately selected environment, not the filter values.
