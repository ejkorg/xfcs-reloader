-- ============================================================================
-- XFCS Reloader DB Cleanup Script
-- Description: Cleans up all transactional and session data for the xfcs-reloader.
--              Does NOT touch user authentication or configuration tables.
-- ============================================================================

-- Turn on feedback/transaction options if running in SQL*Plus or Oracle SQL Developer (optional)
-- SET AUTOCOMMIT OFF;

-- Start Transaction
-- (For systems that require explicit transaction block, e.g. PostgreSQL, or implicit transactions like Oracle)

-- 1. Clean up child table data first (references session_id)
DELETE FROM xfcs_dearchiver_reload_pending_files;
DELETE FROM xfcs_dearchiver_reload_session_events;
DELETE FROM xfcs_dearchiver_reload_session_notifications;

-- 2. Clean up parent session table data
DELETE FROM xfcs_dearchiver_reload_sessions;

-- Commit changes to make them permanent
COMMIT;

-- ============================================================================
-- Optional: TRUNCATE statements (Alternative for faster execution on large datasets)
-- Note: Truncate is a DDL operation that cannot be rolled back.
--       Uncomment the lines below to use truncate instead.
-- ============================================================================
-- TRUNCATE TABLE xfcs_dearchiver_reload_pending_files;
-- TRUNCATE TABLE xfcs_dearchiver_reload_session_events;
-- TRUNCATE TABLE xfcs_dearchiver_reload_session_notifications;
-- TRUNCATE TABLE xfcs_dearchiver_reload_sessions;
