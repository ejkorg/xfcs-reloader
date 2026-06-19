package com.onsemi.cim.apps.exensio.xfcsreloader.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.annotation.Order;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * Debug filter that logs the SecurityContext state right before the request
 * reaches the controller. This lets us see EXACTLY what authentication
 * Spring Security sees when the request arrives.
 */
@Component
@Order(-50)
public class AuthDebugFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(AuthDebugFilter.class);

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {

        // log AFTER the Spring Security chain has set up the SecurityContext
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null) {
            log.info("[AUTH-DEBUG] uri={} method={} authenticated={} name={} authorities={}",
                    request.getRequestURI(), request.getMethod(),
                    auth.isAuthenticated(), auth.getName(), auth.getAuthorities());
        } else {
            log.warn("[AUTH-DEBUG] uri={} method={} NO AUTHENTICATION in SecurityContext",
                    request.getRequestURI(), request.getMethod());
        }

        filterChain.doFilter(request, response);

        int status = response.getStatus();
        log.info("[AUTH-DEBUG] response status={} for {} {}", status, request.getMethod(), request.getRequestURI());
    }
}
