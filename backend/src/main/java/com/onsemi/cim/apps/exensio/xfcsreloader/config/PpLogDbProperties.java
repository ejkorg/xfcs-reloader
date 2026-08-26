package com.onsemi.cim.apps.exensio.xfcsreloader.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * Connection properties for the pp_log Oracle database.
 * Matches exensio reload reference.
 */
@Component
@ConfigurationProperties(prefix = "refdb.pplog")
public class PpLogDbProperties {

    private String host;
    private int port;
    private String sid;
    private String service;
    private String user;
    private String password;
    private Pool pool = new Pool();
    private boolean enabled = true;

    /**
     * Timezone of the Oracle server hosting pp_log.
     * process_datetime is written by third-party ETL in the server's local timezone.
     * Not currently used for querying (no timestamp filter) but kept for consistency
     * with exensioreload and future use.
     * Confirmed Oracle server timezone: -07:00 (America/Phoenix)
     */
    private String serverTimezone = "America/Phoenix";

    public String getHost() { return host; }
    public void setHost(String host) { this.host = host; }
    public int getPort() { return port; }
    public void setPort(int port) { this.port = port; }
    public String getSid() { return sid; }
    public void setSid(String sid) { this.sid = sid; }
    public String getService() { return service; }
    public void setService(String service) { this.service = service; }
    public String getUser() { return user; }
    public void setUser(String user) { this.user = user; }
    public String getPassword() { return password; }
    public void setPassword(String password) { this.password = password; }
    public Pool getPool() { return pool; }
    public void setPool(Pool pool) { this.pool = pool; }
    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean enabled) { this.enabled = enabled; }
    public String getServerTimezone() { return serverTimezone; }
    public void setServerTimezone(String serverTimezone) { this.serverTimezone = serverTimezone == null ? "America/Phoenix" : serverTimezone; }

    public boolean isConfigured() {
        return host != null && !host.isBlank();
    }

    public boolean isPpLogAvailable() {
        return enabled && isConfigured();
    }

    public String buildJdbcUrl() {
        if (service != null && !service.isBlank()) {
            return String.format("jdbc:oracle:thin:@//%s:%d/%s", host, port, service);
        }
        if (sid != null && !sid.isBlank()) {
            return String.format("jdbc:oracle:thin:@%s:%d:%s", host, port, sid);
        }
        return String.format("jdbc:oracle:thin:@%s:%d", host, port);
    }

    public static class Pool {
        private int maxSize = 3;
        private int minIdle = 1;

        public int getMaxSize() { return maxSize; }
        public void setMaxSize(int maxSize) { this.maxSize = maxSize; }
        public int getMinIdle() { return minIdle; }
        public void setMinIdle(int minIdle) { this.minIdle = minIdle; }
    }
}
