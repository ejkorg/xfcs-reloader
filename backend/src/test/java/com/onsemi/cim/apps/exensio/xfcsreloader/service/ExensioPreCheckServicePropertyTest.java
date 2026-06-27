package com.onsemi.cim.apps.exensio.xfcsreloader.service;

import com.onsemi.cim.apps.exensio.xfcsreloader.web.dto.ExensioPreCheckResponse;
import com.onsemi.cim.apps.exensio.xfcsreloader.web.dto.ExensioPreCheckRow;
import com.onsemi.cim.apps.exensio.xfcsreloader.web.dto.PreCheckBlock;
import net.jqwik.api.ForAll;
import net.jqwik.api.Property;
import net.jqwik.api.constraints.AlphaChars;
import net.jqwik.api.constraints.StringLength;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Property-based tests for ExensioPreCheckService helper methods.
 *
 * Feature: lot-exensio-precheck, Properties 2, 3, 4, 5
 * Validates: Requirements 2.2, 2.3, 2.5, 7.1, 7.3, 7.5, 7.6
 */
class ExensioPreCheckServicePropertyTest {

    // ────────────────────────────────────────────────────────────────────────────
    // Property 2: JSON lot array contains every submitted lot ID
    //
    // Feature: lot-exensio-precheck, Property 2: JSON lot array contains every submitted lot ID
    // Validates: Requirements 2.2, 7.1
    // ────────────────────────────────────────────────────────────────────────────

    @Property(tries = 100)
    void buildLotIdsJson_containsAllLotIds(
            @ForAll List<@StringLength(min = 1, max = 20) String> lotIds
    ) {
        if (lotIds.isEmpty()) return; // Skip empty list

        String result = ExensioPreCheckService.buildLotIdsJson(lotIds);

        // Every lot ID must appear in the JSON string
        for (String lotId : lotIds) {
            assertThat(result).contains("\"" + lotId.replace("\"", "\\\"") + "\"");
        }
    }

    @Property(tries = 100)
    void buildLotIdsJson_hasNoNullElements(
            @ForAll List<@StringLength(min = 1, max = 20) String> lotIds
    ) {
        if (lotIds.isEmpty()) return;

        String result = ExensioPreCheckService.buildLotIdsJson(lotIds);

        // Result must be a valid JSON array
        assertThat(result).startsWith("[").endsWith("]");

        // No null strings should be present (buildLotIdsJson treats null as empty string)
        assertThat(result).doesNotContain("null");
    }

    @Property(tries = 100)
    void buildLotIdsJson_escapesDoubleQuotes(
            @ForAll @StringLength(min = 1, max = 10) String prefix,
            @ForAll @StringLength(min = 1, max = 10) String suffix
    ) {
        String lotIdWithQuote = prefix + "\"" + suffix;
        List<String> lotIds = List.of(lotIdWithQuote);

        String result = ExensioPreCheckService.buildLotIdsJson(lotIds);

        // The quote should be escaped as \"
        assertThat(result).contains("\\\"");
        // And the original unescaped quote should not appear in the JSON value
        assertThat(result).doesNotContain("\"" + prefix + "\"" + suffix + "\"");
    }

    @Property(tries = 100)
    void buildLotIdsJson_isValidJsonArray(
            @ForAll List<@StringLength(min = 1, max = 20) String> lotIds
    ) {
        if (lotIds.isEmpty()) return;

        String result = ExensioPreCheckService.buildLotIdsJson(lotIds);

        // Must be a valid JSON array (start with [, end with ], no unmatched brackets)
        assertThat(result).startsWith("[").endsWith("]");
        int openCount = (int) result.chars().filter(c -> c == '[').count();
        int closeCount = (int) result.chars().filter(c -> c == ']').count();
        assertThat(openCount).isEqualTo(closeCount);
    }

    // ────────────────────────────────────────────────────────────────────────────
    // Property 3: Year-month bind parameter resolves to correct month start
    //
    // Feature: lot-exensio-precheck, Property 3: Year-month bind parameter resolves to correct month start
    // Validates: Requirements 2.3, 7.3
    // ────────────────────────────────────────────────────────────────────────────

    @Property(tries = 100)
    void deriveEarliestYearMonth_withYearAndMonth_returnsCorrectFormat(
            @ForAll(value = "year2020To2030") int year,
            @ForAll(value = "month1To12") int month
    ) {
        List<PreCheckBlock> blocks = List.of(new PreCheckBlock(year, month, List.of("LOT1")));

        String result = ExensioPreCheckService.deriveEarliestYearMonth(blocks);

        // Must be in YYYY-MM format
        assertThat(result).matches("\\d{4}-\\d{2}");
        assertThat(result).isEqualTo(String.format("%04d-%02d", year, month));
    }

    @Property(tries = 100)
    void deriveEarliestYearMonth_withYearOnly_usesJanuary(
            @ForAll(value = "year2020To2030") int year
    ) {
        List<PreCheckBlock> blocks = List.of(new PreCheckBlock(year, null, List.of("LOT1")));

        String result = ExensioPreCheckService.deriveEarliestYearMonth(blocks);

        // Should resolve to January (month 01)
        assertThat(result).isEqualTo(String.format("%04d-01", year));
    }

    @Property(tries = 100)
    void deriveEarliestYearMonth_withMultipleBlocks_returnsEarliest(
            @ForAll(value = "year2020To2030") int year1,
            @ForAll(value = "year2020To2030") int year2
    ) {
        if (year1 == year2) return; // Need different years

        int earlierYear = Math.min(year1, year2);
        List<PreCheckBlock> blocks = List.of(
                new PreCheckBlock(year1, 6, List.of("LOT1")),
                new PreCheckBlock(year2, 3, List.of("LOT2"))
        );

        String result = ExensioPreCheckService.deriveEarliestYearMonth(blocks);

        // Must return the earliest year
        assertThat(result).startsWith(String.format("%04d", earlierYear));
    }

    @Property(tries = 50)
    void deriveEarliestYearMonth_withoutYears_returnsNull() {
        List<PreCheckBlock> blocks = List.of(
                new PreCheckBlock(null, null, List.of("LOT1")),
                new PreCheckBlock(null, 6, List.of("LOT2"))
        );

        String result = ExensioPreCheckService.deriveEarliestYearMonth(blocks);

        // Should return null when no year is set
        assertThat(result).isNull();
    }

    @Property(tries = 50)
    void deriveEarliestYearMonth_withEmptyBlocks_returnsNull() {
        String result = ExensioPreCheckService.deriveEarliestYearMonth(List.of());
        assertThat(result).isNull();
    }

    @Property(tries = 50)
    void deriveEarliestYearMonth_withNullBlocks_returnsNull() {
        String result = ExensioPreCheckService.deriveEarliestYearMonth(null);
        assertThat(result).isNull();
    }

    // ────────────────────────────────────────────────────────────────────────────
    // Property 4 & 5: Response partitioning is complete, non-overlapping cover
    //
    // Feature: lot-exensio-precheck, Property 4: Response partitioning is complete, non-overlapping cover
    // Feature: lot-exensio-precheck, Property 5: NOT FOUND rows are excluded from lotsFound
    // Validates: Requirements 2.5, 7.5
    // ────────────────────────────────────────────────────────────────────────────

    @Property(tries = 100)
    void partitionResults_lotsFoundAndNotFoundCoverAllSubmitted(
            @ForAll List<@StringLength(min = 1, max = 15) String> submittedLotIds
    ) {
        if (submittedLotIds.isEmpty()) return;

        // Create rows with some found and some not found
        List<ExensioPreCheckRow> rows = new ArrayList<>();
        for (int i = 0; i < submittedLotIds.size(); i++) {
            String schemaName = (i % 2 == 0) ? "PRODUCTION" : "NOT FOUND";
            rows.add(new ExensioPreCheckRow(submittedLotIds.get(i), schemaName));
        }

        ExensioPreCheckResponse response = ExensioPreCheckService.partitionResults(rows, submittedLotIds);

        // Union of lotsFound and lotsNotFound should equal submitted lot IDs
        Set<String> union = new HashSet<>(response.lotsFound());
        union.addAll(response.lotsNotFound());

        assertThat(union).containsExactlyInAnyOrderElementsOf(
                submittedLotIds.stream().map(String::toUpperCase).toList()
        );
    }

    @Property(tries = 100)
    void partitionResults_lotsFoundAndNotFoundDoNotOverlap(
            @ForAll List<@StringLength(min = 1, max = 15) String> submittedLotIds
    ) {
        if (submittedLotIds.isEmpty()) return;

        List<ExensioPreCheckRow> rows = new ArrayList<>();
        for (int i = 0; i < submittedLotIds.size(); i++) {
            String schemaName = (i % 2 == 0) ? "PRODUCTION" : "NOT FOUND";
            rows.add(new ExensioPreCheckRow(submittedLotIds.get(i), schemaName));
        }

        ExensioPreCheckResponse response = ExensioPreCheckService.partitionResults(rows, submittedLotIds);

        // Intersection should be empty
        Set<String> foundSet = new HashSet<>(response.lotsFound());
        Set<String> notFoundSet = new HashSet<>(response.lotsNotFound());
        foundSet.retainAll(notFoundSet);

        assertThat(foundSet).isEmpty();
    }

    @Property(tries = 100)
    void partitionResults_notFoundRowsExcludedFromLotsFound(
            @ForAll List<@StringLength(min = 1, max = 15) String> submittedLotIds
    ) {
        if (submittedLotIds.isEmpty()) return;

        List<ExensioPreCheckRow> rows = new ArrayList<>();
        for (String lotId : submittedLotIds) {
            rows.add(new ExensioPreCheckRow(lotId, "NOT FOUND"));
        }

        ExensioPreCheckResponse response = ExensioPreCheckService.partitionResults(rows, submittedLotIds);

        // All should be in lotsNotFound
        assertThat(response.lotsFound()).isEmpty();
        assertThat(response.lotsNotFound()).hasSameElementsAs(
                submittedLotIds.stream().map(String::toUpperCase).toList()
        );
    }

    @Property(tries = 100)
    void partitionResults_casInsensitiveMatching(
            @ForAll @StringLength(min = 1, max = 15) String baseLotId
    ) {
        String lotIdLower = baseLotId.toLowerCase();
        String lotIdUpper = baseLotId.toUpperCase();
        List<String> submittedLotIds = List.of(lotIdLower);
        List<ExensioPreCheckRow> rows = List.of(new ExensioPreCheckRow(lotIdUpper, "PRODUCTION"));

        ExensioPreCheckResponse response = ExensioPreCheckService.partitionResults(rows, submittedLotIds);

        // Should match case-insensitively
        assertThat(response.lotsFound()).isNotEmpty();
        assertThat(response.lotsNotFound()).isEmpty();
    }

    // ────────────────────────────────────────────────────────────────────────────
    // Arbitraries
    // ────────────────────────────────────────────────────────────────────────────

    @net.jqwik.api.Provide
    net.jqwik.api.Arbitrary<Integer> year2020To2030() {
        return net.jqwik.api.Arbitraries.integers().between(2020, 2030);
    }

    @net.jqwik.api.Provide
    net.jqwik.api.Arbitrary<Integer> month1To12() {
        return net.jqwik.api.Arbitraries.integers().between(1, 12);
    }
}
