package com.onsemi.cim.apps.exensio.xfcsreloader.service.exensio;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.onsemi.cim.apps.exensio.xfcsreloader.config.ExensioProperties;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.locks.ReentrantLock;

/**
 * Manages the Exensio API session token.
 */
@Service
public class ExensioAuthService {

    private static final Logger log = LoggerFactory.getLogger(ExensioAuthService.class);

    private final ExensioProperties props;
    private final HttpClient httpClient;
    private final ObjectMapper objectMapper;

    private final ReentrantLock loginLock = new ReentrantLock();
    private final ConcurrentHashMap<String, String> cachedTokens = new ConcurrentHashMap<>();

    public ExensioAuthService(ExensioProperties props, ObjectMapper objectMapper) {
        this.props = props;
        // NEVER_REDIRECT: a 3xx from the login endpoint means something is wrong with the
        // URL or server config (e.g. HTTP→HTTPS redirect, or a proxy login page).
        // We want to see and report the actual status code, not silently follow the redirect.
        this.httpClient = HttpClient.newBuilder()
                .followRedirects(HttpClient.Redirect.NEVER)
                .connectTimeout(Duration.ofSeconds(10))
                .build();
        this.objectMapper = objectMapper;
    }

    public String getToken(String schema) {
        if (schema == null) return null;
        String token = cachedTokens.get(schema);
        if (token != null) {
            return token;
        }
        return login(schema);
    }

    public void invalidateToken(String schema) {
        if (schema != null) {
            cachedTokens.remove(schema);
        }
    }

    public String login(String schema) {
        if (schema == null) throw new IllegalArgumentException("Schema must not be null");
        loginLock.lock();
        try {
            String token = cachedTokens.get(schema);
            if (token != null) {
                return token;
            }

            String url = props.resolvedBaseUrl().replaceAll("/$", "") + "/v1/session/login";

            ObjectNode body = objectMapper.createObjectNode();
            body.put("username", props.getUsername());
            body.put("password", props.getPassword());
            body.put("dbname", props.resolvedDbname());
            body.put("dbschema", schema);

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .timeout(Duration.ofSeconds(15))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body.toString()))
                    .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                String location = response.headers().firstValue("Location").orElse(null);
                String detail = location != null
                        ? "HTTP " + response.statusCode() + " → redirected to: " + location
                          + " (check exensio.qa-url/prod-url — may need HTTPS or different path)"
                        : "HTTP " + response.statusCode() + " → " + response.body();
                log.warn("Exensio login failed for schema={}: {}", schema, detail);
                throw new ExensioAuthException("Exensio login failed: " + detail);
            }

            JsonNode json = objectMapper.readTree(response.body());
            token = json.path("token").asText(null);
            if (token == null || token.isBlank()) {
                throw new ExensioAuthException("Exensio login response missing 'token' field");
            }

            cachedTokens.put(schema, token);
            log.info("Exensio session established (env={}, schema={})", props.getEnv(), schema);
            return token;

        } catch (ExensioAuthException e) {
            throw e;
        } catch (Exception e) {
            throw new ExensioAuthException("Exensio login error: " + e.getMessage(), e);
        } finally {
            loginLock.unlock();
        }
    }

    @PreDestroy
    public void logout() {
        if (!props.isConfigured()) return;
        cachedTokens.forEach((schema, token) -> {
            try {
                String url = props.resolvedBaseUrl().replaceAll("/$", "") + "/v1/session/logout";
                HttpRequest request = HttpRequest.newBuilder()
                        .uri(URI.create(url))
                        .timeout(Duration.ofSeconds(5))
                        .header("Authorization", "Bearer " + token)
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.noBody())
                        .build();
                httpClient.send(request, HttpResponse.BodyHandlers.discarding());
                log.info("Exensio session closed for schema={}", schema);
            } catch (Exception e) {
                log.debug("Exensio logout failed for schema={} (non-critical): {}", schema, e.getMessage());
            }
        });
        cachedTokens.clear();
    }

    public static class ExensioAuthException extends RuntimeException {
        public ExensioAuthException(String message) { super(message); }
        public ExensioAuthException(String message, Throwable cause) { super(message, cause); }
    }
}
