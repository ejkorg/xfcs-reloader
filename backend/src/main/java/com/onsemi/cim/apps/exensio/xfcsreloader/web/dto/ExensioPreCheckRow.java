package com.onsemi.cim.apps.exensio.xfcsreloader.web.dto;

/**
 * A single row returned by the Exensio pre-check query.
 *
 * <p>{@code schemaName} holds the Exensio schema (e.g. {@code "PRODUCTION"},
 * {@code "SANDBOX"}) for lots found in Snowflake, or {@code "FOUND"} for lots
 * surfaced via the Exensio HTTP fallback (which does not expose a schema name).
 * The value {@code "NOT FOUND"} is used as an internal sentinel inside
 * {@link com.onsemi.cim.apps.exensio.xfcsreloader.service.ExensioPreCheckService}
 * but is filtered out before the response is returned to the caller.</p>
 */
public record ExensioPreCheckRow(
        String lotId,
        String schemaName
) {}
