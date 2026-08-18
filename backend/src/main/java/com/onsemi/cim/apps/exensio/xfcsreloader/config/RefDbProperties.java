package com.onsemi.cim.apps.exensio.xfcsreloader.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * Connection properties for the primary application database (refdb).
 * Supports both PostgreSQL and Oracle through the dbType property.
 * Mirrors the pattern from exensioreload.
 */
@Component
@ConfigurationProperties(prefix = "refdb")
public class RefDbProperties {
    private String dbType = "oracle";
    private String host;
    private int port;
    private String database;
    private String sid;
    private String service;
    private String user;
    private String password;
    private Pool pool = new Pool();

    public String getDbType() { return dbType; }
    public void setDbType(String dbType) { this.dbType = dbType; }

    public String getHost() { return host; }
    public void setHost(String host) { this.host = host; }

    public int getPort() { return port; }
    public void setPort(int port) { this.port = port; }

    public String getDatabase() { return database; }
    public void setDatabase(String database) { this.database = database; }

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

    /**
     * Returns true if dbType is "postgresql" (case-insensitive).
     */
    public boolean isPostgres() {
        return dbType != null && dbType.trim().equalsIgnoreCase("postgresql");
    }

    /**
     * Builds a JDBC URL based on dbType and connection parameters.
     * For PostgreSQL: jdbc:postgresql://host:port/database (falls back to service then sid)
     * For Oracle: jdbc:oracle:thin:@//host:port/service or jdbc:oracle:thin:@host:port:sid
     */
    public String buildJdbcUrl() {
        if (isPostgres()) {
            String dbName = database;
            if (dbName == null || dbName.isBlank()) {
                dbName = service;
            }
            if (dbName == null || dbName.isBlank()) {
                dbName = sid;
            }
            return String.format("jdbc:postgresql://%s:%d/%s", host, port, dbName);
        }
        if (service != null && !service.isBlank()) {
            return String.format("jdbc:oracle:thin:@//%s:%d/%s", host, port, service);
        }
        if (sid != null && !sid.isBlank()) {
            return String.format("jdbc:oracle:thin:@%s:%d:%s", host, port, sid);
        }
        return String.format("jdbc:oracle:thin:@%s:%d", host, port);
    }

    /**
     * Inner class for connection pool settings.
     */
    public static class Pool {
        private int maxSize = 5;
        private int minIdle = 1;

        public int getMaxSize() { return maxSize; }
        public void setMaxSize(int maxSize) { this.maxSize = maxSize; }

        public int getMinIdle() { return minIdle; }
        public void setMinIdle(int minIdle) { this.minIdle = minIdle; }
    }
}
