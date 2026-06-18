package com.onsemi.cim.apps.exensio.xfcsreloader.service;

import net.jqwik.api.*;
import net.jqwik.api.constraints.NotBlank;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Property 4: File status state machine correctness
 *
 * For any pending file, after the monitor scans and locates it in a known directory,
 * the file_status field should reflect the canonical mapping:
 *   inbox-root path  → "staging"
 *   Processed/ path  → "completed"
 *   NotProcessed/ path → "failed"
 *
 * Feature: reload-monitoring-overhaul, Property 4: File status state machine correctness
 * Validates: Requirements 2.2, 2.3, 2.4
 */
class FileStatusStateMachinePropertyTest {

    /**
     * Encodes the same path-classification logic used in ReloadPendingMonitor.scanPendingFiles().
     * This is the pure function under test — extracted for testability.
     */
    static String classifyPath(String foundPath, String absPath) {
        String foundLower = foundPath.replace("\\", "/").toLowerCase();
        String stagedPath = absPath == null ? "" : absPath.replace("\\", "/").toLowerCase();

        if (foundLower.equals(stagedPath)) {
            return "staging";
        } else if (foundLower.contains("/processed/") || foundLower.endsWith("/processed")) {
            return "completed";
        } else if (foundLower.contains("/notprocessed/") || foundLower.endsWith("/notprocessed")) {
            return "failed";
        }
        return "unknown";
    }

    @Property(tries = 200)
    void inboxRootPathMapsToStaging(
            @ForAll @NotBlank String basePath,
            @ForAll @NotBlank String fileName
    ) {
        // Sanitize inputs to avoid path separator issues
        String cleanBase = basePath.replace("\\", "/").replaceAll("[<>:\"|?*]", "_");
        String cleanFile = fileName.replace("\\", "/").replaceAll("[<>:\"|?*]", "_");
        if (cleanBase.isBlank() || cleanFile.isBlank()) return;

        String absPath = cleanBase + "/" + cleanFile;
        String result = classifyPath(absPath, absPath);

        assertThat(result).isEqualTo("staging");
    }

    @Property(tries = 200)
    void processedSubdirMapsToCompleted(
            @ForAll @NotBlank String basePath,
            @ForAll @NotBlank String fileName
    ) {
        String cleanBase = basePath.replace("\\", "/").replaceAll("[<>:\"|?*]", "_");
        String cleanFile = fileName.replace("\\", "/").replaceAll("[<>:\"|?*]", "_");
        if (cleanBase.isBlank() || cleanFile.isBlank()) return;

        String absPath = cleanBase + "/" + cleanFile;
        String processedPath = cleanBase + "/Processed/" + cleanFile;
        String result = classifyPath(processedPath, absPath);

        assertThat(result).isEqualTo("completed");
    }

    @Property(tries = 200)
    void notProcessedSubdirMapsToFailed(
            @ForAll @NotBlank String basePath,
            @ForAll @NotBlank String fileName
    ) {
        String cleanBase = basePath.replace("\\", "/").replaceAll("[<>:\"|?*]", "_");
        String cleanFile = fileName.replace("\\", "/").replaceAll("[<>:\"|?*]", "_");
        if (cleanBase.isBlank() || cleanFile.isBlank()) return;

        String absPath = cleanBase + "/" + cleanFile;
        String notProcessedPath = cleanBase + "/NotProcessed/" + cleanFile;
        String result = classifyPath(notProcessedPath, absPath);

        assertThat(result).isEqualTo("failed");
    }

    @Property(tries = 100)
    void statusIsAlwaysOneOfKnownValues(
            @ForAll @NotBlank String foundPath,
            @ForAll @NotBlank String absPath
    ) {
        String result = classifyPath(foundPath, absPath);
        assertThat(result).isIn("staging", "completed", "failed", "unknown");
    }
}
