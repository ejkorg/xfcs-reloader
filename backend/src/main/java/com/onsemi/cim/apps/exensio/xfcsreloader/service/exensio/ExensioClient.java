package com.onsemi.cim.apps.exensio.xfcsreloader.service.exensio;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.onsemi.cim.apps.exensio.xfcsreloader.config.ExensioProperties;
import com.onsemi.cim.apps.exensio.xfcsreloader.entity.ReloadPendingFileEntity;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.stream.Collectors;

/**
 * HTTP client for the Exensio API.
 */
@Service
public class ExensioClient {

    private static final Logger log = LoggerFactory.getLogger(ExensioClient.class);

    private final ExensioProperties props;
    private final ExensioAuthService authService;
    private final HttpClient httpClient;
    private final ObjectMapper objectMapper;

    public ExensioClient(ExensioProperties props,
                         ExensioAuthService authService,
                         ObjectMapper objectMapper) {
        this.props = props;
        this.authService = authService;
        this.httpClient = HttpClient.newBuilder().build();
        this.objectMapper = objectMapper;
    }

    public List<BatchLookupResult.RecordUpdate> lotWaferLookupBatch(List<ReloadPendingFileEntity> records) {
        List<BatchLookupResult.RecordUpdate> combinedUpdates = new java.util.ArrayList<>();

        java.util.Map<String, List<ReloadPendingFileEntity>> bySchema = records.stream()
                .filter(r -> r.getDestinationFolder() != null)
                .collect(Collectors.groupingBy(ReloadPendingFileEntity::getDestinationFolder));

        for (java.util.Map.Entry<String, List<ReloadPendingFileEntity>> entry : bySchema.entrySet()) {
            String schema = entry.getKey();
            List<ReloadPendingFileEntity> subBatch = entry.getValue();

            BatchLookupResult partialResult = processSubBatch(schema, subBatch);
            combinedUpdates.addAll(partialResult.mapToRecordUpdates(subBatch));
        }

        records.stream().filter(r -> r.getDestinationFolder() == null).forEach(pf -> {
            combinedUpdates.add(new BatchLookupResult.RecordUpdate(pf.getAbsPath(), BatchLookupResult.UpdateType.ERROR, null, null, "No destination folder for Exensio schema"));
        });

        return combinedUpdates;
    }

    private BatchLookupResult processSubBatch(String schema, List<ReloadPendingFileEntity> subBatch) {
        String token;
        try {
            token = authService.getToken(schema);
        } catch (ExensioAuthService.ExensioAuthException e) {
            return new BatchLookupResult("Auth failed for " + schema + ": " + e.getMessage());
        }

        BatchLookupResult result = doLotWaferLookupBatch(subBatch, token);

        if (!result.isSuccess() && result.getErrorMessage() != null && result.getErrorMessage().contains("HTTP 401")) {
            log.debug("Exensio 401 on batch lookup for {} — invalidating token and retrying", schema);
            authService.invalidateToken(schema);
            try {
                token = authService.login(schema);
            } catch (ExensioAuthService.ExensioAuthException e) {
                return new BatchLookupResult("Re-auth failed for " + schema + ": " + e.getMessage());
            }
            result = doLotWaferLookupBatch(subBatch, token);
        }

        return result;
    }

    private BatchLookupResult doLotWaferLookupBatch(List<ReloadPendingFileEntity> records, String token) {
        long startTime = System.currentTimeMillis();
        int batchSize = records.size();

        try {
            String url = props.resolvedBaseUrl().replaceAll("/$", "") + "/v1/key/lot-wafer-lookup";

            java.util.Set<String> uniqueLots = records.stream()
                    .map(ReloadPendingFileEntity::getUserLotId)
                    .filter(lot -> lot != null && !lot.isBlank())
                    .collect(Collectors.toSet());

            if (uniqueLots.isEmpty()) {
                return new BatchLookupResult("No valid lots in batch");
            }

            ObjectNode body = objectMapper.createObjectNode();
            body.put("pgc_key", 1);
            ArrayNode lotIds = body.putArray("lot_ids");
            for (String lot : uniqueLots) {
                lotIds.add(lot);
            }

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .timeout(Duration.ofSeconds(30))
                    .header("Authorization", "Bearer " + token)
                    .header("Content-Type", "application/json")
                    .header("Connection", "Close")
                    .POST(HttpRequest.BodyPublishers.ofString(body.toString()))
                    .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

            long responseTimeMs = System.currentTimeMillis() - startTime;
            log.debug("Batch API call completed: batchSize={}, uniqueLots={}, responseTimeMs={}, statusCode={}",
                    batchSize, uniqueLots.size(), responseTimeMs, response.statusCode());

            if (response.statusCode() == 401) {
                return new BatchLookupResult("HTTP 401");
            }
            if (response.statusCode() == 429) {
                return new BatchLookupResult("HTTP 429 (rate limited)");
            }
            if (response.statusCode() >= 500) {
                return new BatchLookupResult("HTTP " + response.statusCode());
            }
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                return new BatchLookupResult("HTTP " + response.statusCode());
            }

            return BatchLookupResult.parse(response.body(), objectMapper);

        } catch (Exception e) {
            long responseTimeMs = System.currentTimeMillis() - startTime;
            log.warn("Exensio batch lot-wafer-lookup failed after {}ms: {}", responseTimeMs, e.getMessage());
            return new BatchLookupResult("Error: " + e.getMessage());
        }
    }
}
