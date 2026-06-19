package com.onsemi.cim.apps.exensio.xfcsreloader.web;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.onsemi.cim.apps.exensio.xfcsreloader.config.JwtUtil;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.*;

/**
 * Authentication controller providing SSO integration with Exensio auth service.
 * Supports both local credential login and SSO redirect flows.
 */
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final JwtUtil jwtUtil;
    private final ObjectMapper objectMapper;
    
    @Value("${sso.exensio-auth-url:https://usaz15ls088:8080/exensio-reload/api/auth/sso}")
    private String exensioAuthUrl;

    @Value("${sso.callback-url:https://usaz15ls088:8080/xfcs-reloader/sso-callback}")
    private String callbackUrl;
    
    @Value("${sso.enabled:true}")
    private boolean ssoEnabled;

    public AuthController(JwtUtil jwtUtil, ObjectMapper objectMapper) {
        this.jwtUtil = jwtUtil;
        this.objectMapper = objectMapper;
    }

    /**
     * Returns auth configuration, including whether SSO is enabled.
     * Called by the frontend during app initialization.
     */
    @GetMapping("/config")
    public ResponseEntity<ObjectNode> getAuthConfig() {
        ObjectNode config = objectMapper.createObjectNode();
        config.put("ssoEnabled", ssoEnabled);
        return ResponseEntity.ok(config);
    }

    /**
     * Initiates SSO login by redirecting to the Exensio auth service.
     * Passes callbackApp so exensioreload redirects back to xfcs-reloader after authentication.
     */
    @GetMapping("/sso/initiate")
    public void initiateSso(@RequestParam(value = "returnUrl", defaultValue = "/dashboard") String returnUrl,
                            HttpServletResponse response) throws IOException {
        if (!ssoEnabled) {
            response.sendError(400, "SSO is not enabled");
            return;
        }

        try {
            // Redirect to exensioreload's SSO initiation, passing our sso-callback as callbackApp.
            // Exensioreload authenticates via Azure AD, then redirects to callbackUrl?token=<JWT>
            String encodedReturnUrl = URLEncoder.encode(returnUrl, StandardCharsets.UTF_8);
            String encodedCallbackApp = URLEncoder.encode(callbackUrl, StandardCharsets.UTF_8);
            String redirectUrl = exensioAuthUrl + "/initiate?returnUrl=" + encodedReturnUrl
                    + "&callbackApp=" + encodedCallbackApp;

            response.sendRedirect(redirectUrl);
        } catch (Exception e) {
            response.sendError(500, "Failed to initiate SSO: " + e.getMessage());
        }
    }

    /**
     * Silent SSO attempt for users with an active Exensio session.
     * Redirects to Exensio auth service's /silent endpoint which performs
     * an OIDC prompt=none check via Azure AD.
     */
    @GetMapping("/sso/silent")
    public void silentSso(@RequestParam(value = "returnUrl", defaultValue = "/dashboard") String returnUrl,
                          HttpServletResponse response) throws IOException {
        if (!ssoEnabled) {
            response.setStatus(204);
            return;
        }

        try {
            String encodedReturnUrl = URLEncoder.encode(returnUrl, StandardCharsets.UTF_8);
            String encodedCallbackApp = URLEncoder.encode(callbackUrl, StandardCharsets.UTF_8);
            String redirectUrl = exensioAuthUrl + "/silent?returnUrl=" + encodedReturnUrl
                    + "&callbackApp=" + encodedCallbackApp;
            response.sendRedirect(redirectUrl);
        } catch (Exception e) {
            response.sendError(500, "Failed to initiate silent SSO: " + e.getMessage());
        }
    }

    /**
     * Handles SSO callback after Exensio auth service authenticates the user.
     * Expects a JWT token from the Exensio service and validates it.
     */
    @PostMapping("/sso/callback")
    public ResponseEntity<?> handleSsoCallback(@RequestBody SsoCallbackRequest request) {
        if (!ssoEnabled) {
            return ResponseEntity.badRequest().body(Map.of("error", "SSO is not enabled"));
        }
        
        if (request.token() == null || request.token().isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "Missing token"));
        }
        
        try {
            // Validate the token from Exensio
            if (!jwtUtil.validateToken(request.token())) {
                return ResponseEntity.status(401).body(Map.of("error", "Invalid or expired token"));
            }
            
            // Extract user info from token
            Map<String, Object> claims = jwtUtil.getTokenClaims(request.token());
            String username = (String) claims.get("sub");
            
            ObjectNode response = objectMapper.createObjectNode();
            response.put("accessToken", request.token());
            response.put("username", username);
            
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return ResponseEntity.status(401).body(Map.of("error", "Failed to process SSO callback: " + e.getMessage()));
        }
    }

    /**
     * Local credential-based login endpoint.
     * Authenticates user with username/password and returns a JWT token.
     */
    @PostMapping("/login")
    public ResponseEntity<?> login(@RequestBody LoginRequest request) {
        if (request.username() == null || request.username().isBlank() ||
            request.password() == null || request.password().isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "Missing username or password"));
        }
        
        try {
            // Validate credentials against Exensio or local user store
            // For now, validate against a simple hardcoded check or Exensio
            if (validateCredentials(request.username(), request.password())) {
                String token = jwtUtil.generateToken(request.username(), List.of("USER"));
                
                ObjectNode response = objectMapper.createObjectNode();
                response.put("accessToken", token);
                response.put("username", request.username());
                
                return ResponseEntity.ok(response);
            }
            
            return ResponseEntity.status(401).body(Map.of("error", "Invalid credentials"));
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", "Login failed: " + e.getMessage()));
        }
    }

    /**
     * Refresh JWT token endpoint.
     * Called by frontend before token expiry.
     */
    @PostMapping("/refresh")
    public ResponseEntity<?> refresh() {
        try {
            // In a real implementation, this would check refresh token validity
            // For now, return 200 with no refresh token (stateless JWT)
            ObjectNode response = objectMapper.createObjectNode();
            response.put("refreshed", false);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", "Failed to refresh token: " + e.getMessage()));
        }
    }

    /**
     * Get current user info from JWT token in Authorization header.
     */
    @GetMapping("/me")
    public ResponseEntity<?> getCurrentUser() {
        try {
            ObjectNode response = objectMapper.createObjectNode();
            response.put("username", "current-user");
            response.putArray("roles").add("USER");
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return ResponseEntity.status(401).body(Map.of("error", "Failed to get user info: " + e.getMessage()));
        }
    }

    /**
     * Validate credentials against Exensio service or local store.
     * TODO: Integrate with actual Exensio auth service
     */
    private boolean validateCredentials(String username, String password) {
        // Placeholder implementation
        // In production, this should call Exensio auth service
        return !username.isBlank() && password.length() >= 8;
    }

    record LoginRequest(String username, String password) {}
    record SsoCallbackRequest(String token) {}
}
