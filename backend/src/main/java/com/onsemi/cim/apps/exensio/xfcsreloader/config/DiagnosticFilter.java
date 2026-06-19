package com.onsemi.cim.apps.exensio.xfcsreloader.config;

import jakarta.servlet.*;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import java.io.IOException;

@Component
@Order(-200)
public class DiagnosticFilter implements Filter {

    private static final Logger log = LoggerFactory.getLogger(DiagnosticFilter.class);

    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
            throws IOException, ServletException {

        HttpServletRequest req = (HttpServletRequest) request;
        HttpServletResponse res = (HttpServletResponse) response;

        String uri = req.getRequestURI();
        String auth = req.getHeader("Authorization");
        String authPreview = auth != null ? auth.substring(0, Math.min(30, auth.length())) + "..." : "NONE";

        log.info(">>> DIAG: {} {} auth={}", req.getMethod(), uri, authPreview);

        chain.doFilter(request, response);

        int status = res.getStatus();
        log.info("<<< DIAG: {} {} status={}", req.getMethod(), uri, status);
    }
}
