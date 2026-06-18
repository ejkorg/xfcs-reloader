package com.onsemi.cim.apps.exensio.xfcsreloader.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "xfcs")
public class XfcsProperties {
    private String envConfPath = "/apps/exensio_data/xfcs-reloader/env.conf";
    private boolean featureEnabled = true;
    private String archivesRoot = "/archives";
    private int searchMaxResults = 200;
    private int searchMaxFilesScan = 20000;
    private int envConfCacheTtlSec = 120;
    private int envConfRetries = 2;
    private int envConfRetryBackoffMs = 500;

    // Data root where environment inbox folders live
    private String dataRoot = "/apps/exensio_data/data";

    // Staging subfolder name within the resolved inbox path
    private String stagingFolder = "dearchive";

    // Path to the .mgr file that maps env names → .cfg files
    private String mgrFilePath = "/export/home/dpower/project/load/fcs_all_load.mgr";

    // Background pending file monitor poll interval (seconds)
    private long pendingMonitorIntervalSec = 5;

    // Stuck-session auto-timeout in minutes (0 = disabled)
    private int stuckSessionTimeoutMin = 60;

    // Read mode for .mgr/.cfg files: LOCAL or REMOTE
    private String mgrReadMode = "LOCAL";
    private String cfgReadMode = "LOCAL";

    // Environment variable names used in path expansion
    private String dploadEnvVar = "DPLOAD";
    private String dpdataEnvVar = "DPDATA";
    private String dpscriptEnvVar = "DPSCRIPT";
    private String dplogEnvVar = "DPLOG";

    private boolean remoteEnabled = false;
    private String remoteHost = "usaz15ls082";
    private int remotePort = 22;
    private String remoteUser = "dpower";
    private String remoteEnvConfPath = "/export/home/dpower/project/scripts/dearchive/env.conf";
    private String remotePrivateKeyPath;
    private String remotePassword = "5taRf1sh";
    private String remoteKnownHostsPath = "/export/home/dpower/.ssh/known_hosts";
    private boolean remoteStrictHostKey = false;
    private int remoteConnectTimeoutMs = 5000;
    private int remoteReadTimeoutMs = 10000;

    // Completion email notifications
    private boolean notificationEmailEnabled = false;
    private String notificationEmailFrom = "no-reply@localhost";
    private String notificationEmailRequesterDomain;
    private java.util.List<String> notificationEmailFallbackRecipients = new java.util.ArrayList<>();
    private String notificationEmailSubjectPrefix = "[XFCS Reloader]";
    private int notificationEmailMaxFiles = 500;

    public String getEnvConfPath() {
        return envConfPath;
    }

    public void setEnvConfPath(String envConfPath) {
        this.envConfPath = envConfPath;
    }

    public boolean isFeatureEnabled() {
        return featureEnabled;
    }

    public void setFeatureEnabled(boolean featureEnabled) {
        this.featureEnabled = featureEnabled;
    }

    public String getArchivesRoot() {
        return archivesRoot;
    }

    public void setArchivesRoot(String archivesRoot) {
        this.archivesRoot = archivesRoot;
    }

    public int getSearchMaxResults() {
        return searchMaxResults;
    }

    public void setSearchMaxResults(int searchMaxResults) {
        this.searchMaxResults = searchMaxResults;
    }

    public int getSearchMaxFilesScan() {
        return searchMaxFilesScan;
    }

    public void setSearchMaxFilesScan(int searchMaxFilesScan) {
        this.searchMaxFilesScan = searchMaxFilesScan;
    }

    public int getEnvConfCacheTtlSec() {
        return envConfCacheTtlSec;
    }

    public void setEnvConfCacheTtlSec(int envConfCacheTtlSec) {
        this.envConfCacheTtlSec = envConfCacheTtlSec;
    }

    public int getEnvConfRetries() {
        return envConfRetries;
    }

    public void setEnvConfRetries(int envConfRetries) {
        this.envConfRetries = envConfRetries;
    }

    public int getEnvConfRetryBackoffMs() {
        return envConfRetryBackoffMs;
    }

    public void setEnvConfRetryBackoffMs(int envConfRetryBackoffMs) {
        this.envConfRetryBackoffMs = envConfRetryBackoffMs;
    }

    public boolean isRemoteEnabled() {
        return remoteEnabled;
    }

    public void setRemoteEnabled(boolean remoteEnabled) {
        this.remoteEnabled = remoteEnabled;
    }

    public String getRemoteHost() {
        return remoteHost;
    }

    public void setRemoteHost(String remoteHost) {
        this.remoteHost = remoteHost;
    }

    public int getRemotePort() {
        return remotePort;
    }

    public void setRemotePort(int remotePort) {
        this.remotePort = remotePort;
    }

    public String getRemoteUser() {
        return remoteUser;
    }

    public void setRemoteUser(String remoteUser) {
        this.remoteUser = remoteUser;
    }

    public String getRemoteEnvConfPath() {
        return remoteEnvConfPath;
    }

    public void setRemoteEnvConfPath(String remoteEnvConfPath) {
        this.remoteEnvConfPath = remoteEnvConfPath;
    }

    public String getRemotePrivateKeyPath() {
        return remotePrivateKeyPath;
    }

    public void setRemotePrivateKeyPath(String remotePrivateKeyPath) {
        this.remotePrivateKeyPath = remotePrivateKeyPath;
    }

    public String getRemotePassword() {
        return remotePassword;
    }

    public void setRemotePassword(String remotePassword) {
        this.remotePassword = remotePassword;
    }

    public String getRemoteKnownHostsPath() {
        return remoteKnownHostsPath;
    }

    public void setRemoteKnownHostsPath(String remoteKnownHostsPath) {
        this.remoteKnownHostsPath = remoteKnownHostsPath;
    }

    public boolean isRemoteStrictHostKey() {
        return remoteStrictHostKey;
    }

    public void setRemoteStrictHostKey(boolean remoteStrictHostKey) {
        this.remoteStrictHostKey = remoteStrictHostKey;
    }

    public int getRemoteConnectTimeoutMs() {
        return remoteConnectTimeoutMs;
    }

    public void setRemoteConnectTimeoutMs(int remoteConnectTimeoutMs) {
        this.remoteConnectTimeoutMs = remoteConnectTimeoutMs;
    }

    public int getRemoteReadTimeoutMs() {
        return remoteReadTimeoutMs;
    }

    public void setRemoteReadTimeoutMs(int remoteReadTimeoutMs) {
        this.remoteReadTimeoutMs = remoteReadTimeoutMs;
    }

    public boolean isNotificationEmailEnabled() {
        return notificationEmailEnabled;
    }

    public void setNotificationEmailEnabled(boolean notificationEmailEnabled) {
        this.notificationEmailEnabled = notificationEmailEnabled;
    }

    public String getNotificationEmailFrom() {
        return notificationEmailFrom;
    }

    public void setNotificationEmailFrom(String notificationEmailFrom) {
        this.notificationEmailFrom = notificationEmailFrom;
    }

    public String getNotificationEmailRequesterDomain() {
        return notificationEmailRequesterDomain;
    }

    public void setNotificationEmailRequesterDomain(String notificationEmailRequesterDomain) {
        this.notificationEmailRequesterDomain = notificationEmailRequesterDomain;
    }

    public java.util.List<String> getNotificationEmailFallbackRecipients() {
        return notificationEmailFallbackRecipients;
    }

    public void setNotificationEmailFallbackRecipients(java.util.List<String> notificationEmailFallbackRecipients) {
        this.notificationEmailFallbackRecipients = notificationEmailFallbackRecipients;
    }

    public String getNotificationEmailSubjectPrefix() {
        return notificationEmailSubjectPrefix;
    }

    public void setNotificationEmailSubjectPrefix(String notificationEmailSubjectPrefix) {
        this.notificationEmailSubjectPrefix = notificationEmailSubjectPrefix;
    }

    public int getNotificationEmailMaxFiles() {
        return notificationEmailMaxFiles;
    }

    public void setNotificationEmailMaxFiles(int notificationEmailMaxFiles) {
        this.notificationEmailMaxFiles = notificationEmailMaxFiles;
    }

    public String getDataRoot() { return dataRoot; }
    public void setDataRoot(String dataRoot) { this.dataRoot = dataRoot; }

    public String getStagingFolder() { return stagingFolder; }
    public void setStagingFolder(String stagingFolder) { this.stagingFolder = stagingFolder; }

    public String getMgrFilePath() { return mgrFilePath; }
    public void setMgrFilePath(String mgrFilePath) { this.mgrFilePath = mgrFilePath; }

    public long getPendingMonitorIntervalSec() { return pendingMonitorIntervalSec; }
    public void setPendingMonitorIntervalSec(long v) { this.pendingMonitorIntervalSec = v; }

    public int getStuckSessionTimeoutMin() { return stuckSessionTimeoutMin; }
    public void setStuckSessionTimeoutMin(int v) { this.stuckSessionTimeoutMin = v; }

    public String getMgrReadMode() { return mgrReadMode; }
    public void setMgrReadMode(String mgrReadMode) { this.mgrReadMode = mgrReadMode; }

    public String getCfgReadMode() { return cfgReadMode; }
    public void setCfgReadMode(String cfgReadMode) { this.cfgReadMode = cfgReadMode; }

    public String getDploadEnvVar() { return dploadEnvVar; }
    public void setDploadEnvVar(String v) { this.dploadEnvVar = v; }

    public String getDpdataEnvVar() { return dpdataEnvVar; }
    public void setDpdataEnvVar(String v) { this.dpdataEnvVar = v; }

    public String getDpscriptEnvVar() { return dpscriptEnvVar; }
    public void setDpscriptEnvVar(String v) { this.dpscriptEnvVar = v; }

    public String getDplogEnvVar() { return dplogEnvVar; }
    public void setDplogEnvVar(String v) { this.dplogEnvVar = v; }
}
