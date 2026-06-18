package com.onsemi.cim.apps.exensio.xfcsreloader.config;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Component
public class JwtUtil {
    private final SecretKey key;

    public JwtUtil(@Value("${reloader.jwt.secret:dev-secret-change-me-please-32-bytes}") String secret) {
        byte[] bytes;
        try {
            bytes = java.util.Base64.getDecoder().decode(secret);
            if (bytes.length < 32) {
                bytes = secret.getBytes(StandardCharsets.UTF_8);
            }
        } catch (IllegalArgumentException e) {
            bytes = secret.getBytes(StandardCharsets.UTF_8);
        }
        if (bytes.length < 32) {
            byte[] padded = new byte[32];
            System.arraycopy(bytes, 0, padded, 0, Math.min(bytes.length, 32));
            bytes = padded;
        }
        this.key = Keys.hmacShaKeyFor(bytes);
    }

    public boolean validateToken(String token) {
        try {
            Claims claims = parseClaims(token);
            return claims.getExpiration() == null || claims.getExpiration().after(new Date());
        } catch (Exception e) {
            return false;
        }
    }

    public String extractUsername(String token) {
        try {
            return parseClaims(token).getSubject();
        } catch (Exception e) {
            return null;
        }
    }

    public List<String> extractRoles(String token) {
        try {
            Object roles = parseClaims(token).get("roles");
            if (roles instanceof List<?> list) {
                return list.stream().map(String::valueOf).collect(Collectors.toList());
            }
            if (roles instanceof String s) {
                return List.of(s);
            }
            return List.of();
        } catch (Exception e) {
            return List.of();
        }
    }

    private Claims parseClaims(String token) {
        return Jwts.parserBuilder().setSigningKey(key).build().parseClaimsJws(token).getBody();
    }

    public String generateToken(String username, List<String> roles) {
        return generateToken(username, roles, 3600000); // 1 hour expiry
    }

    public String generateToken(String username, List<String> roles, long expirationMs) {
        Map<String, Object> claims = new HashMap<>();
        claims.put("roles", roles);
        
        Date now = new Date();
        Date expiryDate = new Date(now.getTime() + expirationMs);
        
        return Jwts.builder()
                .setClaims(claims)
                .setSubject(username)
                .setIssuedAt(now)
                .setExpiration(expiryDate)
                .signWith(key)
                .compact();
    }

    public Map<String, Object> getTokenClaims(String token) {
        try {
            Claims claims = parseClaims(token);
            Map<String, Object> result = new HashMap<>(claims);
            return result;
        } catch (Exception e) {
            return new HashMap<>();
        }
    }
}
