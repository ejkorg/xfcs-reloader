package com.onsemi.cim.apps.exensio.xfcsreloader.config;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.context.HttpRequestResponseHolder;
import org.springframework.security.web.context.SecurityContextRepository;

import java.util.List;

public class JwtSecurityContextRepository implements SecurityContextRepository {

    private static final Logger log = LoggerFactory.getLogger(JwtSecurityContextRepository.class);

    private final JwtUtil jwtUtil;

    public JwtSecurityContextRepository(JwtUtil jwtUtil) {
        this.jwtUtil = jwtUtil;
    }

    @Override
    public SecurityContext loadContext(HttpRequestResponseHolder requestResponseHolder) {
        HttpServletRequest request = requestResponseHolder.getRequest();
        String authHeader = request.getHeader("Authorization");
        String token = null;

        if (authHeader != null && authHeader.startsWith("Bearer ")) {
            token = authHeader.substring(7);
        }

        if (token != null && jwtUtil.validateToken(token)) {
            String username = jwtUtil.extractUsername(token);
            List<String> rawRoles = jwtUtil.extractRoles(token);
            log.debug("[JWT-CTX] User='{}' raw roles: {}", username, rawRoles);

            if (rawRoles.isEmpty()) {
                log.warn("[JWT-CTX] No roles for user='{}'; defaulting to USER", username);
                rawRoles = List.of("USER");
            }

            List<SimpleGrantedAuthority> authorities = rawRoles.stream()
                    .map(role -> role.startsWith("ROLE_") ? role : "ROLE_" + role)
                    .map(SimpleGrantedAuthority::new)
                    .toList();

            UsernamePasswordAuthenticationToken auth =
                    new UsernamePasswordAuthenticationToken(username, token, authorities);

            SecurityContext context = SecurityContextHolder.createEmptyContext();
            context.setAuthentication(auth);
            log.info("[JWT-CTX] Authenticated user='{}' authorities={}", username, authorities);
            return context;
        }

        return SecurityContextHolder.createEmptyContext();
    }

    @Override
    public void saveContext(SecurityContext context, HttpServletRequest request, HttpServletResponse response) {
    }

    @Override
    public boolean containsContext(HttpServletRequest request) {
        String authHeader = request.getHeader("Authorization");
        return authHeader != null && authHeader.startsWith("Bearer ");
    }
}
