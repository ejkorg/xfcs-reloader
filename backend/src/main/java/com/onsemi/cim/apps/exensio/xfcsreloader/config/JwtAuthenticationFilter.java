package com.onsemi.cim.apps.exensio.xfcsreloader.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;

/**
 * Spring Security filter that runs inside the Spring Security chain,
 * AFTER {@link org.springframework.security.web.context.SecurityContextHolderFilter}
 * has loaded/exchanged the SecurityContext.
 * <p>
 * Reads JWT from the Authorization header and sets the authentication
 * in the SecurityContextHolder.
 */
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(JwtAuthenticationFilter.class);

    private final JwtUtil jwtUtil;

    public JwtAuthenticationFilter(JwtUtil jwtUtil) {
        this.jwtUtil = jwtUtil;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {

        String authHeader = request.getHeader("Authorization");
        String token = null;

        if (authHeader != null && authHeader.startsWith("Bearer ")) {
            token = authHeader.substring(7);
        }

        if (token != null && jwtUtil.validateToken(token)) {
            String username = jwtUtil.extractUsername(token);
            List<String> rawRoles = jwtUtil.extractRoles(token);

            if (rawRoles.isEmpty()) {
                log.warn("[JWT-FILTER] No roles in token for user='{}'; defaulting to USER", username);
                rawRoles = List.of("USER");
            }

            List<SimpleGrantedAuthority> authorities = rawRoles.stream()
                    .map(role -> role.startsWith("ROLE_") ? role : "ROLE_" + role)
                    .map(SimpleGrantedAuthority::new)
                    .toList();

            UsernamePasswordAuthenticationToken authentication =
                    new UsernamePasswordAuthenticationToken(username, token, authorities);

            SecurityContextHolder.getContext().setAuthentication(authentication);
            log.info("[JWT-FILTER] Authenticated user='{}' method={} uri={}",
                    username, request.getMethod(), request.getRequestURI());
        } else if (token != null) {
            log.warn("[JWT-FILTER] Invalid token for {} {}", request.getMethod(), request.getRequestURI());
        }

        try {
            filterChain.doFilter(request, response);
        } catch (Exception e) {
            log.error("[JWT-FILTER] EXCEPTION from chain for {} {}: {}", request.getMethod(), request.getRequestURI(), e.getMessage(), e);
            throw e;
        }

        int status = response.getStatus();
        log.warn("[JWT-FILTER] AFTER CHAIN status={} for {} {}",
                status, request.getMethod(), request.getRequestURI());
    }
}
