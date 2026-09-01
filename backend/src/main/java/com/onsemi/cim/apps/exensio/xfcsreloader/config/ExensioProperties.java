package com.onsemi.cim.apps.exensio.xfcsreloader.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/**
 * Configuration properties for the Exensio API connection.
 */
@Configuration
@ConfigurationProperties(prefix = "exensio")
public class ExensioProperties {

    private boolean enabled = false;
    private String qaUrl;
    private String prodUrl;
    private String username;
    private String password;
    private String dbname;
    private String dbschema;
    private String env = "QA";
    
    /** Timeout in minutes to wait for load confirmation before marking failed */
    private int timeoutMinutes = 60;
    
    /** Poll interval in milliseconds */
    private long pollIntervalMs = 60000;

    /** Prefer the Exensio raw-SQL endpoint before the lot-wafer-lookup endpoint. */
    private boolean preferRawSql = true;

    /** Upper bound on rows returned by generated raw-SQL queries. */
    private int rawSqlRowLimit = 200;

    /** HTTP timeout in seconds for raw-SQL calls. */
    private int rawSqlTimeoutSeconds = 20;

    /**
     * Maximum allowed gap (in minutes) between a pending file's creation time and the
     * Exensio {@code op_log.insert_time}. Used to reject stale rows and avoid matching
     * an old load of the same lot. Default: 60.
     */
    private int maxLookupWindowMinutes = 60;

    public boolean isConfigured() {
        return enabled && resolvedBaseUrl() != null && !resolvedBaseUrl().isBlank();
    }

    public String resolvedBaseUrl() {
        return "PROD".equalsIgnoreCase(env) ? prodUrl : qaUrl;
    }

    /**
     * Effective dbname sent to POST /v1/session/login.
     * Falls back to the env value if not explicitly configured, matching exensioreload behaviour.
     */
    public String resolvedDbname() {
        return (dbname != null && !dbname.isBlank()) ? dbname : env;
    }

    /**
     * Maps a file destination folder (as detected by the pending monitor from the file path)
     * to the Exensio dbschema that should be used when querying the API.
     *
     * The ETL writes files to either a Production/ or Sandbox/ sub-folder inside Processed/.
     * That folder name IS the schema target — we do not infer it from the env config.
     *
     * Returns "PRODUCTION" or "SANDBOX"; defaults to "PRODUCTION" when destination is unknown.
     */
    public String resolvedDbschemaForDestination(String destination) {
        if ("SANDBOX".equalsIgnoreCase(destination)) {
            return "SANDBOX";
        }
        return "PRODUCTION";
    }

    // getters and setters

    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean enabled) { this.enabled = enabled; }

    public String getQaUrl() { return qaUrl; }
    public void setQaUrl(String qaUrl) { this.qaUrl = qaUrl; }

    public String getProdUrl() { return prodUrl; }
    public void setProdUrl(String prodUrl) { this.prodUrl = prodUrl; }

    public String getUsername() { return username; }
    public void setUsername(String username) { this.username = username; }

    public String getPassword() { return password; }
    public void setPassword(String password) { this.password = password; }

    public String getDbname() { return dbname; }
    public void setDbname(String dbname) { this.dbname = dbname; }

    public String getDbschema() { return dbschema; }
    public void setDbschema(String dbschema) { this.dbschema = dbschema; }

    public String getEnv() { return env; }
    public void setEnv(String env) { this.env = env; }

    public int getTimeoutMinutes() { return timeoutMinutes; }
    public void setTimeoutMinutes(int timeoutMinutes) { this.timeoutMinutes = timeoutMinutes; }

    public long getPollIntervalMs() { return pollIntervalMs; }
    public void setPollIntervalMs(long pollIntervalMs) { this.pollIntervalMs = pollIntervalMs; }

    public boolean isPreferRawSql() { return preferRawSql; }
    public void setPreferRawSql(boolean preferRawSql) { this.preferRawSql = preferRawSql; }

    public int getRawSqlRowLimit() { return rawSqlRowLimit; }
    public void setRawSqlRowLimit(int rawSqlRowLimit) { this.rawSqlRowLimit = rawSqlRowLimit; }

    public int getRawSqlTimeoutSeconds() { return rawSqlTimeoutSeconds; }
    public void setRawSqlTimeoutSeconds(int rawSqlTimeoutSeconds) { this.rawSqlTimeoutSeconds = rawSqlTimeoutSeconds; }

    public int getMaxLookupWindowMinutes() { return maxLookupWindowMinutes; }
    public void setMaxLookupWindowMinutes(int maxLookupWindowMinutes) { this.maxLookupWindowMinutes = maxLookupWindowMinutes; }
}
