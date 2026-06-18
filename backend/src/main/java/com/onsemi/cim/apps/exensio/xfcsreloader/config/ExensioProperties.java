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

    public boolean isConfigured() {
        return enabled && resolvedBaseUrl() != null && !resolvedBaseUrl().isBlank();
    }

    public String resolvedBaseUrl() {
        return "PROD".equalsIgnoreCase(env) ? prodUrl : qaUrl;
    }

    public String resolvedDbname() {
        return dbname;
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
}
