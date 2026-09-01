package com.onsemi.cim.apps.exensio.xfcsreloader.util;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Utility for parsing XFCS/DTP filenames to extract metadata like Lot ID.
 */
public class FilenameParser {

    // Common patterns for Lot IDs in filenames (e.g. ..._LOT12345_...)
    private static final Pattern LOT_PATTERN = Pattern.compile("(?i)[/_](LOT|L)([0-9a-zA-Z.]+)", Pattern.CASE_INSENSITIVE);

    // Wafer marker pattern, e.g. "..._W06_..." / "..._WF_05_..." / "..._wafer12_..."
    private static final Pattern WAFER_PATTERN = Pattern.compile(
            "(?:wafer|wf|w)[_-]?([A-Za-z0-9]+)", Pattern.CASE_INSENSITIVE);
    
    /**
     * Attempts to extract a Lot ID from a file path or name.
     * @param input the path or filename (e.g. /path/to/LOT-12345.gz)
     * @return the Lot ID, or null
     */
    public static String parseLotId(String input) {
        if (input == null || input.isBlank()) return null;
        
        Matcher m = LOT_PATTERN.matcher(input);
        if (m.find()) {
            return m.group(2).split("[._-]")[0];
        }
        
        // Fallback: look for parts starting with LOT
        String[] parts = input.split("[\\\\/]");
        for (String part : parts) {
            String upper = part.toUpperCase();
            if (upper.startsWith("LOT") && upper.length() > 3) {
                return part.substring(3).split("[._-]")[0];
            }
        }
        
        return null;
    }

    /**
     * Attempts to extract a wafer identifier from a file path or name.
     *
     * @param input the path or filename (e.g. "/path/to/LOT12345_W06.dat")
     * @return the wafer identifier (e.g. "06"), or null if none is found
     */
    public static String parseWaferId(String input) {
        if (input == null || input.isBlank()) return null;

        Matcher m = WAFER_PATTERN.matcher(input);
        if (m.find()) {
            String wafer = m.group(1);
            return wafer == null || wafer.isBlank() ? null : wafer;
        }
        return null;
    }
}
