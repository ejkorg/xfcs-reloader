package com.onsemi.cim.apps.exensio.xfcsreloader.service.exensio;

import java.util.Locale;

/**
 * Resolves the Exensio {@code pgc_key} for a reload session from its {@code area}
 * and {@code testerType}.
 *
 * <p>The area keyword is the primary signal (matching {@code EnvConfigService}
 * process-group derivation), with {@code testerType} available as a secondary
 * disambiguator when a future area keyword needs it.</p>
 */
public final class ExensioPgcKeyResolver {

    public static final int PGC_KEY_PROBE  = 1;
    public static final int PGC_KEY_FT     = 2;
    public static final int PGC_KEY_WMAP   = 4;
    public static final int PGC_KEY_PCM    = 5;
    public static final int PGC_KEY_DEFECT = 14;

    private ExensioPgcKeyResolver() {}

    /**
     * Maps an area (and optional tester type) to a {@code pgc_key}.
     *
     * @param area       area keyword, e.g. {@code "FT"}, {@code "PROBE"}, {@code "PCM"}
     * @param testerType tester type, reserved for future disambiguation (may be null)
     * @return the Exensio program-group-class key
     */
    public static int resolve(String area, String testerType) {
        String normalized = area == null ? "" : area.trim().toLowerCase(Locale.ROOT);

        return switch (normalized) {
            case "sort", "probe" -> PGC_KEY_PROBE;
            case "ft", "ast" -> PGC_KEY_FT;
            case "et", "pcm" -> PGC_KEY_PCM;
            case "map", "wmap" -> PGC_KEY_WMAP;
            case "defect" -> PGC_KEY_DEFECT;
            default -> PGC_KEY_FT; // default to Final Test
        };
    }
}
