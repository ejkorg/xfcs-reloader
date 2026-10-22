package com.onsemi.cim.apps.exensio.xfcsreloader.web;

import com.onsemi.cim.apps.exensio.xfcsreloader.entity.AppUser;
import com.onsemi.cim.apps.exensio.xfcsreloader.entity.AppUserRole;
import com.onsemi.cim.apps.exensio.xfcsreloader.repository.AppUserRepository;
import com.onsemi.cim.apps.exensio.xfcsreloader.config.JwtUtil;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.stream.Collectors;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import jakarta.servlet.http.HttpServletResponse;

/**
 * Local authentication controller for xfcs-reloader.
 * Provides local credential-based login, registration, and token refresh.
 */
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final JwtUtil jwtUtil;
    private final ObjectMapper objectMapper;
    private final AppUserRepository appUserRepository;
    private final PasswordEncoder passwordEncoder;
    private final AuthenticationManager authenticationManager;

    @Value("${xfcsreloader.auth.default-role:USER}")
    private String defaultRole;

    @Value("${xfcsreloader.auth.register-enabled:true}")
    private boolean registerEnabled;

    @Value("${sso.enabled:false}")
    private boolean ssoEnabled;

    @Value("${sso.exensio-auth-url:}")
    private String exensioAuthUrl;

    @Value("${sso.callback-url:}")
    private String callbackUrl;

    public AuthController(JwtUtil jwtUtil,
                          ObjectMapper objectMapper,
                          AppUserRepository appUserRepository,
                          PasswordEncoder passwordEncoder,
                          AuthenticationManager authenticationManager) {
        this.jwtUtil = jwtUtil;
        this.objectMapper = objectMapper;
        this.appUserRepository = appUserRepository;
        this.passwordEncoder = passwordEncoder;
        this.authenticationManager = authenticationManager;
    }

    @GetMapping("/config")
    public ResponseEntity<ObjectNode> getAuthConfig() {
        ObjectNode config = objectMapper.createObjectNode();
        config.put("ssoEnabled", ssoEnabled);
        config.put("registerEnabled", registerEnabled);
        return ResponseEntity.ok(config);
    }

    @GetMapping("/sso/initiate")
    public void initiateSso(@RequestParam(value = "returnUrl", defaultValue = "/dashboard") String returnUrl,
                            HttpServletResponse response) throws IOException {
        if (!ssoEnabled) {
            response.sendError(400, "SSO is not enabled");
            return;
        }

        try {
            String encodedReturnUrl = URLEncoder.encode(returnUrl, StandardCharsets.UTF_8);
            String encodedCallbackApp = URLEncoder.encode(callbackUrl, StandardCharsets.UTF_8);
            String redirectUrl = exensioAuthUrl + "/initiate?returnUrl=" + encodedReturnUrl
                    + "&callbackApp=" + encodedCallbackApp;

            response.sendRedirect(redirectUrl);
        } catch (Exception e) {
            response.sendError(500, "Failed to initiate SSO: " + e.getMessage());
        }
    }

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

    @PostMapping("/sso/callback")
    public ResponseEntity<?> handleSsoCallback(@RequestBody SsoCallbackRequest request) {
        if (!ssoEnabled) {
            return ResponseEntity.badRequest().body(Map.of("error", "SSO is not enabled"));
        }

        if (request.token() == null || request.token().isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "Missing token"));
        }

        try {
            if (!jwtUtil.validateToken(request.token())) {
                return ResponseEntity.status(401).body(Map.of("error", "Invalid or expired token"));
            }

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

    @PostMapping("/login")
    public ResponseEntity<?> login(@RequestBody LoginRequest request) {
        if (request.username() == null || request.username().isBlank() ||
            request.password() == null || request.password().isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "Missing username or password"));
        }

        try {
            UsernamePasswordAuthenticationToken authToken =
                    new UsernamePasswordAuthenticationToken(request.username(), request.password());
            Authentication authentication = authenticationManager.authenticate(authToken);
            SecurityContextHolder.getContext().setAuthentication(authentication);

            String username = authentication.getName();
            Collection<String> roles = authentication.getAuthorities().stream()
                    .map(a -> a.getAuthority().replaceFirst("^ROLE_", ""))
                    .collect(Collectors.toList());

            String token = jwtUtil.generateToken(username, new ArrayList<>(roles));

            ObjectNode response = objectMapper.createObjectNode();
            response.put("accessToken", token);
            response.put("username", username);
            ArrayNode rolesNode = response.putArray("roles");
            roles.forEach(rolesNode::add);

            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return ResponseEntity.status(401).body(Map.of("error", "Invalid username or password"));
        }
    }

    @PostMapping("/register")
    public ResponseEntity<?> register(@RequestBody RegisterRequest request) {
        if (!registerEnabled) {
            return ResponseEntity.status(403).body(Map.of("error", "Registration is disabled"));
        }

        if (request.username() == null || request.username().isBlank() ||
            request.password() == null || request.password().isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "Missing username or password"));
        }

        String username = request.username().trim();
        if (appUserRepository.existsByUsername(username)) {
            return ResponseEntity.status(409).body(Map.of("error", "Username already exists"));
        }

        AppUser appUser = new AppUser();
        appUser.setUsername(username);
        appUser.setPasswordHash(passwordEncoder.encode(request.password()));
        appUser.setEnabled(true);
        appUser.setUpdatedAt(LocalDateTime.now());

        AppUserRole role = new AppUserRole();
        role.setUsername(username);
        role.setRole(request.role() != null && !request.role().isBlank() ? request.role().trim() : defaultRole);

        appUser.setAuthorities(Set.of(role));
        appUserRepository.save(appUser);

        return ResponseEntity.ok(Map.of("message", "User created successfully"));
    }

    @GetMapping("/me")
    public ResponseEntity<?> getCurrentUser(Authentication authentication) {
        try {
            if (authentication == null || !authentication.isAuthenticated()) {
                return ResponseEntity.status(401).body(Map.of("error", "Not authenticated"));
            }

            ObjectNode response = objectMapper.createObjectNode();
            response.put("username", authentication.getName());

            ArrayNode roles = response.putArray("roles");
            authentication.getAuthorities().stream()
                    .map(a -> a.getAuthority().replaceFirst("^ROLE_", ""))
                    .forEach(roles::add);

            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return ResponseEntity.status(401).body(Map.of("error", "Failed to get user info: " + e.getMessage()));
        }
    }

    @PostMapping("/refresh")
    public ResponseEntity<?> refresh(Authentication authentication) {
        try {
            if (authentication == null || !authentication.isAuthenticated()) {
                return ResponseEntity.status(401).body(Map.of("error", "Not authenticated"));
            }

            String username = authentication.getName();
            Collection<String> roles = authentication.getAuthorities().stream()
                    .map(a -> a.getAuthority().replaceFirst("^ROLE_", ""))
                    .collect(Collectors.toList());

            String token = jwtUtil.generateToken(username, new ArrayList<>(roles));
            return ResponseEntity.ok(Map.of("accessToken", token));
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", "Failed to refresh token: " + e.getMessage()));
        }
    }

    record LoginRequest(String username, String password) {}
    record RegisterRequest(String username, String password, String role) {}
    record SsoCallbackRequest(String token) {}
}
