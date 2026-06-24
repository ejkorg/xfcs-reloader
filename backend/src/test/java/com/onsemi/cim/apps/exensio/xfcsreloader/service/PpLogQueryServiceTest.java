package com.onsemi.cim.apps.exensio.xfcsreloader.service;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for PpLogQueryService static parsing methods.
 *
 * Feature: stepper-pplog-enhancements
 * Validates: Requirements 4.3, 5.2, 6.2
 */
class PpLogQueryServiceTest {

    // ────────────────────────────────────────────────────────────────────────────
    // deriveDestination tests
    // ────────────────────────────────────────────────────────────────────────────

    @Test
    void deriveDestination_withSandboxKeyword_returnsSandbox() {
        assertThat(PpLogQueryService.deriveDestination("sandbox"))
                .isEqualTo("SANDBOX");
        assertThat(PpLogQueryService.deriveDestination("SANDBOX"))
                .isEqualTo("SANDBOX");
        assertThat(PpLogQueryService.deriveDestination("/etl/envs/sandbox"))
                .isEqualTo("SANDBOX");
        assertThat(PpLogQueryService.deriveDestination("SANDBOX/path/to/file"))
                .isEqualTo("SANDBOX");
    }

    @Test
    void deriveDestination_withNotProcessedKeyword_returnsNotProcessed() {
        assertThat(PpLogQueryService.deriveDestination("NotProcessed"))
                .isEqualTo("NOT_PROCESSED");
        assertThat(PpLogQueryService.deriveDestination("NOTPROCESSED"))
                .isEqualTo("NOT_PROCESSED");
        assertThat(PpLogQueryService.deriveDestination("NotProcessed/file"))
                .isEqualTo("NOT_PROCESSED");
    }

    @Test
    void deriveDestination_withoutKeywords_returnsProduction() {
        assertThat(PpLogQueryService.deriveDestination("production"))
                .isEqualTo("PRODUCTION");
        assertThat(PpLogQueryService.deriveDestination("/etl/envs/production/path"))
                .isEqualTo("PRODUCTION");
        assertThat(PpLogQueryService.deriveDestination("some/other/path"))
                .isEqualTo("PRODUCTION");
    }

    @Test
    void deriveDestination_withNull_returnsProduction() {
        assertThat(PpLogQueryService.deriveDestination(null))
                .isEqualTo("PRODUCTION");
    }

    @Test
    void deriveDestination_withEmptyString_returnsProduction() {
        assertThat(PpLogQueryService.deriveDestination(""))
                .isEqualTo("PRODUCTION");
    }

    // ────────────────────────────────────────────────────────────────────────────
    // extractSandboxReason tests
    // ────────────────────────────────────────────────────────────────────────────

    @Test
    void extractSandboxReason_withSampleFromSpec_returnsFirstBadSegment() {
        // Sample from spec: "PartNo Not Specified..sending file to sandbox --- Good. Meta Found ... --- Test name should not be blank. ---  at ... line 950."
        String logMessage = "PartNo Not Specified..sending file to sandbox --- Good. Meta Found ... --- Test name should not be blank. ---  at ... line 950.";
        String reason = PpLogQueryService.extractSandboxReason(logMessage);
        
        // Should return the first segment containing "Not Specified" (which contains "Not found" would match)
        assertThat(reason).isNotNull();
        assertThat(reason.toLowerCase()).contains("not");
    }

    @Test
    void extractSandboxReason_withBadKeyword_returnsSegmentContainingBad() {
        String logMessage = "Good segment --- Bad segment with error --- Another segment";
        String reason = PpLogQueryService.extractSandboxReason(logMessage);
        
        assertThat(reason).isEqualTo("Bad segment with error");
    }

    @Test
    void extractSandboxReason_withNotFoundKeyword_returnsSegment() {
        String logMessage = "Some data --- Good data --- Not found in database --- More data";
        String reason = PpLogQueryService.extractSandboxReason(logMessage);
        
        assertThat(reason).isEqualTo("Not found in database");
    }

    @Test
    void extractSandboxReason_withNoQualifyingSegment_returnsNull() {
        String logMessage = "All good segments --- Everything fine --- No issues";
        String reason = PpLogQueryService.extractSandboxReason(logMessage);
        
        assertThat(reason).isNull();
    }

    @Test
    void extractSandboxReason_withNull_returnsNull() {
        assertThat(PpLogQueryService.extractSandboxReason(null)).isNull();
    }

    @Test
    void extractSandboxReason_withEmptyString_returnsNull() {
        assertThat(PpLogQueryService.extractSandboxReason("")).isNull();
    }

    @Test
    void extractSandboxReason_caseSensitivity_matchesIrregardlessOfCase() {
        String logMessage = "Segment 1 --- BAD error --- Segment 3";
        String reason = PpLogQueryService.extractSandboxReason(logMessage);
        
        assertThat(reason).isEqualTo("BAD error");
    }

    // ────────────────────────────────────────────────────────────────────────────
    // extractErrorReason tests
    // ────────────────────────────────────────────────────────────────────────────

    @Test
    void extractErrorReason_withSampleFromSpec_returnsLastMeaningfulSegment() {
        // Sample from spec: "PartNo Not Specified..sending file to sandbox --- Good. Meta Found ... --- Test name should not be blank. ---  at ... line 950."
        String logMessage = "PartNo Not Specified..sending file to sandbox --- Good. Meta Found ... --- Test name should not be blank. ---  at ... line 950.";
        String reason = PpLogQueryService.extractErrorReason(logMessage);
        
        // Should return a meaningful segment; the last meaningful segment or first with "bad"/"not found"
        assertThat(reason).isNotNull();
    }

    @Test
    void extractErrorReason_withMeaningfulLastSegment_returnsLast() {
        String logMessage = "Segment 1 --- Segment 2 --- File not found in archive";
        String reason = PpLogQueryService.extractErrorReason(logMessage);
        
        assertThat(reason).isEqualTo("File not found in archive");
    }

    @Test
    void extractErrorReason_withTrivialLastSegment_returnsBadOrNotFoundSegment() {
        String logMessage = "Some error happened --- Bad input detected --- OK";
        String reason = PpLogQueryService.extractErrorReason(logMessage);
        
        // Last segment is "OK" (trivial), so should fall back to first "Bad" segment
        assertThat(reason).isEqualTo("Bad input detected");
    }

    @Test
    void extractErrorReason_withNoBadNotFoundButMeaningfulLast_returnsLast() {
        String logMessage = "Good data --- More good data --- Validation failed";
        String reason = PpLogQueryService.extractErrorReason(logMessage);
        
        assertThat(reason).isEqualTo("Validation failed");
    }

    @Test
    void extractErrorReason_withOnlyTrivialSegments_returnsNull() {
        String logMessage = "Good --- OK --- Done";
        String reason = PpLogQueryService.extractErrorReason(logMessage);
        
        assertThat(reason).isNull();
    }

    @Test
    void extractErrorReason_withNull_returnsNull() {
        assertThat(PpLogQueryService.extractErrorReason(null)).isNull();
    }

    @Test
    void extractErrorReason_withEmptyString_returnsNull() {
        assertThat(PpLogQueryService.extractErrorReason("")).isNull();
    }

    @Test
    void extractErrorReason_singleSegmentWithMeaning_returnsThat() {
        String logMessage = "Error: File validation failed";
        String reason = PpLogQueryService.extractErrorReason(logMessage);
        
        assertThat(reason).isEqualTo("Error: File validation failed");
    }

    @Test
    void extractErrorReason_multipleSegmentsWithBadKeyword_returnsBadSegment() {
        String logMessage = "Initial --- Bad format detected --- Good --- final";
        String reason = PpLogQueryService.extractErrorReason(logMessage);
        
        // "final" is last but trivial, so should use "Bad format detected"
        assertThat(reason).isEqualTo("Bad format detected");
    }
}
