package com.onsemi.cim.apps.exensio.xfcsreloader.web.dto;

import java.util.List;

/**
 * Response wrapper for archive search that includes both results and metadata about limits.
 * 
 * Key design: Returns ALL matching files for processing, but indicates display limit
 * for UI performance. The 'results' array contains all files found (up to searchMaxResults),
 * while 'displayLimit' indicates how many should be shown in the UI.
 */
public record SearchResponse(
        List<SearchResult> results,
        int totalFound,
        int maxResults,
        int displayLimit,
        boolean limitExceeded,
        boolean displayLimited
) {
    /**
     * Create a response for search results with display limit info.
     * @param results all files found (up to maxResults)
     * @param totalFound actual total that would have been found (may exceed maxResults)
     * @param maxResults the configured absolute maximum
     * @param displayLimit the UI display limit (for performance)
     */
    public static SearchResponse of(List<SearchResult> results, int totalFound, int maxResults, int displayLimit) {
        return new SearchResponse(
            results, 
            totalFound, 
            maxResults, 
            displayLimit,
            totalFound > maxResults,
            results.size() > displayLimit
        );
    }
}

