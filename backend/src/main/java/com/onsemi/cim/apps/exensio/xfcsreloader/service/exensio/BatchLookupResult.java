package com.onsemi.cim.apps.exensio.xfcsreloader.service.exensio;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.onsemi.cim.apps.exensio.xfcsreloader.entity.ReloadPendingFileEntity;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Result of a batch lot-wafer lookup against the Exensio API.
 *
 * Response shape:
 * <pre>
 * {
 *   "lots": [{
 *     "lot_id": "P002924307",
 *     "lot_key": 2776623,
 *     "wafers": [{
 *       "wafer_id": "KG01HK4X_06",
 *       "wafer_key": 4633046,
 *       "pg_key": 12345,
 *       "ppid": "WS::CM8012X_..."
 *     }]
 *   }]
 * }
 * </pre>
 *
 * Lot matching uses the string {@code lot_id} field, not {@code lot_key} (which is a DB
 * surrogate). The {@code userLotId} on the pending file entity is the same string the
 * request was submitted with, so they match directly.
 */
public class BatchLookupResult {

    private static final Logger log = LoggerFactory.getLogger(BatchLookupResult.class);

    private final List<LotResult> lots;
    private final boolean success;
    private final String errorMessage;

    public record LotResult(String lotId, long lotKey, long pgKey, List<WaferResult> wafers) {
        public record WaferResult(String waferId, long waferKey, long pgKey, String ppid) {}
    }

    public enum UpdateType { DONE, NOT_FOUND, ERROR }

    public record RecordUpdate(String absPath, UpdateType type, Long waferKey, Long pgKey, String errorMessage) {}

    public BatchLookupResult(List<LotResult> lots) {
        this.lots = lots;
        this.success = true;
        this.errorMessage = null;
    }

    public BatchLookupResult(String errorMessage) {
        this.lots = new ArrayList<>();
        this.success = false;
        this.errorMessage = errorMessage;
    }

    public boolean isSuccess() { return success; }
    public String getErrorMessage() { return errorMessage; }
    public List<LotResult> getLots() { return lots; }

    /**
     * Maps the API response back to per-file updates.
     *
     * Matching strategy (mirrors exensioreload BatchLookupResult):
     * 1. Build a map of lot_id (string) → best wafer result (first with pg_key > 0).
     * 2. For each pending file, look up its userLotId in that map.
     * 3. DONE when found, NOT_FOUND when absent, ERROR when batch call itself failed.
     */
    public List<RecordUpdate> mapToRecordUpdates(List<ReloadPendingFileEntity> records) {
        List<RecordUpdate> updates = new ArrayList<>();

        if (!success) {
            for (ReloadPendingFileEntity r : records) {
                updates.add(new RecordUpdate(r.getAbsPath(), UpdateType.ERROR, null, null, errorMessage));
            }
            return updates;
        }

        // lot_id string → best wafer result in this lot
        Map<String, LotResult.WaferResult> byLotId = new HashMap<>();
        Map<String, Long> lotPgKeyByLotId = new HashMap<>();
        for (LotResult lot : lots) {
            if (lot.lotId() == null || lot.lotId().isBlank()) continue;
            String key = lot.lotId().toUpperCase();
            // Keep lot-level pg_key as fallback when no wafers are present
            if (lot.pgKey() > 0) {
                lotPgKeyByLotId.put(key, lot.pgKey());
            }
            for (LotResult.WaferResult w : lot.wafers()) {
                if (w.pgKey() > 0 && !byLotId.containsKey(key)) {
                    byLotId.put(key, w);
                }
            }
        }

        for (ReloadPendingFileEntity r : records) {
            String lotId = r.getUserLotId();
            if (lotId == null || lotId.isBlank()) {
                updates.add(new RecordUpdate(r.getAbsPath(), UpdateType.ERROR, null, null, "Missing userLotId"));
                continue;
            }

            String key = lotId.toUpperCase();
            LotResult.WaferResult wafer = byLotId.get(key);
            if (wafer != null) {
                updates.add(new RecordUpdate(r.getAbsPath(), UpdateType.DONE,
                        wafer.waferKey() > 0 ? wafer.waferKey() : null,
                        wafer.pgKey(), null));
            } else if (lotPgKeyByLotId.containsKey(key)) {
                // Lot found but no wafers — still treat as DONE with lot-level pg_key
                updates.add(new RecordUpdate(r.getAbsPath(), UpdateType.DONE,
                        null, lotPgKeyByLotId.get(key), null));
            } else {
                updates.add(new RecordUpdate(r.getAbsPath(), UpdateType.NOT_FOUND, null, null, null));
            }
        }
        return updates;
    }

    /**
     * Parses the JSON response body from POST /v1/key/lot-wafer-lookup.
     */
    public static BatchLookupResult parse(String jsonResponse, ObjectMapper objectMapper) {
        try {
            JsonNode root = objectMapper.readTree(jsonResponse);
            JsonNode lotsNode = root.path("lots");

            if (!lotsNode.isArray()) {
                return new BatchLookupResult("Response missing 'lots' array");
            }

            List<LotResult> lotResults = new ArrayList<>();
            for (JsonNode lotNode : lotsNode) {
                String lotId  = lotNode.path("lot_id").asText(null);
                long lotKey   = lotNode.path("lot_key").asLong(0);
                long lotPgKey = lotNode.path("pg_key").asLong(0);
                JsonNode wafersNode = lotNode.path("wafers");

                List<LotResult.WaferResult> waferResults = new ArrayList<>();
                if (wafersNode.isArray()) {
                    for (JsonNode w : wafersNode) {
                        String waferId  = w.path("wafer_id").asText(null);
                        long waferKey   = w.path("wafer_key").asLong(0);
                        long pgKey      = w.path("pg_key").asLong(0);
                        String ppid     = w.path("ppid").asText(null);
                        if (waferId != null && waferKey > 0) {
                            waferResults.add(new LotResult.WaferResult(waferId, waferKey, pgKey, ppid));
                        }
                    }
                }

                if (lotId != null || lotKey > 0 || lotPgKey > 0) {
                    lotResults.add(new LotResult(lotId, lotKey, lotPgKey, waferResults));
                }
            }

            return new BatchLookupResult(lotResults);

        } catch (Exception e) {
            log.warn("Failed to parse Exensio batch lookup response: {}", e.getMessage());
            return new BatchLookupResult("Parse error: " + e.getMessage());
        }
    }
}
