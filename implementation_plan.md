# Implementation Plan — Date Coverage Feature and Options Refinement

This plan details the backend and frontend changes required to fix the Date Coverage reporting feature.

## Proposed Changes

### Backend Components

#### [MODIFY] [ReloadSessionService.java](file:///c:/Users/fg8n8x/Desktop/eta/wip/xfcs-reloader/backend/src/main/java/com/onsemi/cim/apps/exensio/xfcsreloader/service/ReloadSessionService.java)
- Update [getFileCoverage](file:///c:/Users/fg8n8x/Desktop/eta/wip/xfcs-reloader/backend/src/main/java/com/onsemi/cim/apps/exensio/xfcsreloader/service/ReloadSessionService.java#875-960) native query to UNION active files from `xfcs_dearchiver_reload_pending_files` with historical/resolved records from `xfcs_dearchiver_reload_session_events` joined with `xfcs_dearchiver_reload_sessions`.
- Use a subquery named `pf` containing `created_at`, `environment`, and `file_status` mapping:
  - Staging/etl/loading pending files are mapped as they are.
  - Events with type `file_completed` maps to [completed](file:///c:/Users/fg8n8x/Desktop/eta/wip/xfcs-reloader/backend/src/main/java/com/onsemi/cim/apps/exensio/xfcsreloader/service/ReloadSessionService.java#778-781).
  - Events with type `file_failed` and `file_unverified` map to [failed](file:///c:/Users/fg8n8x/Desktop/eta/wip/xfcs-reloader/backend/src/main/java/com/onsemi/cim/apps/exensio/xfcsreloader/service/ReloadSessionService.java#782-785).

### Frontend Components

#### [MODIFY] [xfcs-coverage.component.ts](file:///c:/Users/fg8n8x/Desktop/eta/wip/xfcs-reloader/frontend/src/app/xfcs/xfcs-coverage.component.ts)
- Import [GlassSelectComponent](file:///c:/Users/fg8n8x/Desktop/eta/wip/xfcs-reloader/frontend/src/app/shared/components/glass-select.component.ts#17-657), `GlassButtonComponent`, and `GlassIconComponent`.
- Implement filters as signals: `filterSite`, `filterArea`, `filterTesterType`, and `selectedEnv` (signal).
- Add cascading computed properties: `resolvedEnvs`, `resolveStatus`, `siteOptions`, `resolvedEnvOptions`, `areaOptions`, `testerTypeOptions`.
- Implement dropdown change handlers: [onFilterSiteChange](file:///c:/Users/fg8n8x/Desktop/eta/wip/xfcs-reloader/frontend/src/app/xfcs/xfcs-stepper.component.ts#1250-1260), [onFilterAreaChange](file:///c:/Users/fg8n8x/Desktop/eta/wip/xfcs-reloader/frontend/src/app/xfcs/xfcs-stepper.component.ts#1261-1267), [onFilterTesterTypeChange](file:///c:/Users/fg8n8x/Desktop/eta/wip/xfcs-reloader/frontend/src/app/xfcs/xfcs-stepper.component.ts#1268-1272), and environment auto-resolution [_autoResolve](file:///c:/Users/fg8n8x/Desktop/eta/wip/xfcs-reloader/frontend/src/app/xfcs/xfcs-stepper.component.ts#1277-1286).
- Update the layout HTML and styles for the filter bar to layout items in grids (`filter-row` and `filter-row-4`) and dress standard date inputs with glass theme styles matching the drop-downs.

---

## Verification Plan

### Automated Tests
- Validate Maven tests pass to verify we haven't introduced syntax errors or broken existing functionality:
  ```powershell
  cd backend
  mvn test
  ```

### Manual Verification
- Launch the application locally and navigate to the Coverage page.
- Select Site, Area, and Tester Type, and verify that the environment resolves correctly.
- Click "Run Report" and verify that historical file reload counts (from completed/failed sessions) are retrieved and shown in the chart and table.
