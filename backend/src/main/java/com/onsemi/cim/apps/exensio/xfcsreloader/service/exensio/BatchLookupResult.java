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

public class BatchLookupResult {
    private static final Logger log = LoggerFactory.getLogger(BatchLookupResult.class);

    private final List<LotResult> lots;
    private final boolean success;
    private final String errorMessage;

    public record LotResult(long lotKey, long pgKey, List<WaferResult> wafers) {
        public record WaferResult(String waferId, long waferKey, long pgKey, String ppid) {}
    }

    public enum UpdateType { DONE, NOT_FOUND, ERROR, FAILED }

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

    public boolean isSuccess() {
        return success;
    }

    public String getErrorMessage() {
        return errorMessage;
    }

    public List<LotResult> getLots() {
        return lots;
    }

    public List<RecordUpdate> mapToRecordUpdates(List<ReloadPendingFileEntity> originalRecords) {
        if (!success) {
            List<RecordUpdate> updates = new ArrayList<>();
            for (ReloadPendingFileEntity record : originalRecords) {
                updates.add(new RecordUpdate(record.getAbsPath(), UpdateType.ERROR, null, null, errorMessage));
            }
            return updates;
        }

        Map<String, LotResult> lotLookup = new HashMap<>();
        for (LotResult lot : lots) {
            lotLookup.put(String.valueOf(lot.lotKey()), lot);
            // We just use the lot string as key assuming search uses string representation.
        }

        List<RecordUpdate> updates = new ArrayList<>();
        for (ReloadPendingFileEntity record : originalRecords) {
            String lot = record.getUserLotId();

            if (lot != null) {
                // In this implementation, the Exensio API returns matches 
                // in the 'lots' array according to how they were submitted.
                // We'll perform generic checking.
                for (LotResult lr : lots) {
                    if (String.valueOf(lr.lotKey()).equals(lot) || lotLookup.containsKey(lot)) {
                        break;
                    }
                }
                
                // If not matched strictly by lotKey string matching the userLotId, 
                // since XFCS userLotId might be an actual string and Exensio lotKey is a database ID,
                // wait, in dtp-resender: lotIds.add(record.lot()); 
                // Exensio returns `lot_key`, but wait, how do we correlate response back to the requested lot string?
                // Actually dtp-resender matches by checking `lotLookup.get(String.valueOf(record.lot()))`!!
                // Meaning Exensio `lot_key` string representation equals the input lot? Yes.
                
                LotResult lotResult = lotLookup.get(lot);
                if (lotResult != null) {
                    updates.add(new RecordUpdate(record.getAbsPath(), UpdateType.DONE, null, lotResult.pgKey(), null));
                } else if (!lots.isEmpty() && isTargetLotPresent(lot, String.valueOf(lots.get(0).lotKey()))) {
                    // Fallback matching if keys somehow mismatch but we know it's a success
                    updates.add(new RecordUpdate(record.getAbsPath(), UpdateType.DONE, null, lots.get(0).pgKey(), null));
                } else {
                    updates.add(new RecordUpdate(record.getAbsPath(), UpdateType.NOT_FOUND, null, null, null));
                }
            } else {
                updates.add(new RecordUpdate(record.getAbsPath(), UpdateType.ERROR, null, null, "Record missing userLotId"));
            }
        }
        return updates;
    }

    private boolean isTargetLotPresent(String target, String actual) {
         return target != null && actual != null && target.equalsIgnoreCase(actual);
    }

    public static BatchLookupResult parse(String jsonResponse, ObjectMapper objectMapper) {
        try {
            JsonNode root = objectMapper.readTree(jsonResponse);
            JsonNode lotsNode = root.path("lots");

            if (!lotsNode.isArray()) {
                return new BatchLookupResult("Response missing 'lots' array");
            }

            List<LotResult> lotResults = new ArrayList<>();
            for (JsonNode lotNode : lotsNode) {
                long lotKey = lotNode.path("lot_key").asLong(0);
                long lotPgKey = lotNode.path("pg_key").asLong(0);
                JsonNode wafersNode = lotNode.path("wafers");

                List<LotResult.WaferResult> waferResults = new ArrayList<>();
                if (wafersNode.isArray()) {
                    for (JsonNode waferNode : wafersNode) {
                        String waferId = waferNode.path("wafer_id").asText(null);
                        long waferKey = waferNode.path("wafer_key").asLong(0);
                        long pgKey = waferNode.path("pg_key").asLong(0);
                        String ppid = waferNode.path("ppid").asText(null);

                        if (waferId != null && waferKey > 0) {
                            waferResults.add(new LotResult.WaferResult(waferId, waferKey, pgKey, ppid));
                        }
                    }
                }

                if (lotKey > 0 || lotPgKey > 0) {
                    lotResults.add(new LotResult(lotKey, lotPgKey, waferResults));
                }
            }
            return new BatchLookupResult(lotResults);

        } catch (Exception e) {
            log.warn("Failed to parse batch lookup response: {}", e.getMessage());
            return new BatchLookupResult("Parse error: " + e.getMessage());
        }
    }
}
