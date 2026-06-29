package com.onsemi.cim.apps.exensio.xfcsreloader.entity;

import jakarta.persistence.*;
import java.time.Instant;

/**
 * Tracks a file that has been staged to the environment inbox and is pending
 * ETL pickup/processing. The background monitor watches for the file to be
 * moved to Processed/ or NotProcessed/ and then finalizes the session.
 */
@Entity
@Table(name = "xfcs_dearchiver_reload_pending_files")
public class ReloadPendingFileEntity {

    /** Absolute path to the staged file in the inbox (used as PK). */
    @Id
    @Column(name = "abs_path", length = 1024, nullable = false)
    private String absPath;

    /** Session this pending file belongs to. */
    @Column(name = "session_id", length = 64, nullable = false)
    private String sessionId;

    @Column(name = "requester", length = 128)
    private String requester;

    @Column(name = "environment", length = 128)
    private String environment;

    /** Final transformed filename (after MD5 strip and timestamp suffix). */
    @Column(name = "file_name", length = 512)
    private String fileName;

    /** Original archive filename before transformation. */
    @Column(name = "original_file_name", length = 512)
    private String originalFileName;

    /**
     * Base inbox root where the file was placed (used by monitor
     * to scope the recursive search for Processed/NotProcessed).
     */
    @Column(name = "inbox_root", length = 1024)
    private String inboxRoot;

    @Column(name = "created_at", nullable = false)
    @Convert(converter = InstantTimestampConverter.class)
    private Instant createdAt;

    /** Last known location of the file (used to throttle events). */
    @Column(name = "last_known_path", length = 1024)
    private String lastKnownPath;

    /** user-provided lotId from the initial reload request. */
    @Column(name = "user_lot_id", length = 128)
    private String userLotId;

    /** Per-file lifecycle state: pending → staging → completed | failed. */
    @Column(name = "file_status", length = 32, nullable = false)
    private String fileStatus = "pending";

    /** Error reason read from the .err sibling file when ETL rejects the file. */
    @Column(name = "error_reason", length = 2000)
    private String errorReason;

    /** Timestamp when the file reached a terminal state (completed or failed). */
    @Column(name = "resolved_at")
    @Convert(converter = InstantTimestampConverter.class)
    private java.time.Instant resolvedAt;

    /** Processing destination detected from the ETL log: "PRODUCTION", "SANDBOX", or null. */
    @Column(name = "destination_folder", length = 32)
    private String destinationFolder;

    @Column(name = "exensio_wafer_key")
    private Long exensioWaferKey;

    @Column(name = "exensio_pg_key")
    private Long exensioPgKey;

    @Column(name = "archive_year")
    private Integer archiveYear;

    @Column(name = "archive_month")
    private Integer archiveMonth;

    public String getAbsPath() { return absPath; }
    public void setAbsPath(String absPath) { this.absPath = absPath; }

    public String getSessionId() { return sessionId; }
    public void setSessionId(String sessionId) { this.sessionId = sessionId; }

    public Integer getArchiveYear() { return archiveYear; }
    public void setArchiveYear(Integer archiveYear) { this.archiveYear = archiveYear; }

    public Integer getArchiveMonth() { return archiveMonth; }
    public void setArchiveMonth(Integer archiveMonth) { this.archiveMonth = archiveMonth; }


    public String getRequester() { return requester; }
    public void setRequester(String requester) { this.requester = requester; }

    public String getEnvironment() { return environment; }
    public void setEnvironment(String environment) { this.environment = environment; }

    public String getFileName() { return fileName; }
    public void setFileName(String fileName) { this.fileName = fileName; }

    public String getOriginalFileName() { return originalFileName; }
    public void setOriginalFileName(String originalFileName) { this.originalFileName = originalFileName; }

    public String getInboxRoot() { return inboxRoot; }
    public void setInboxRoot(String inboxRoot) { this.inboxRoot = inboxRoot; }

    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }

    public String getLastKnownPath() { return lastKnownPath; }
    public void setLastKnownPath(String lastKnownPath) { this.lastKnownPath = lastKnownPath; }

    public String getUserLotId() { return userLotId; }
    public void setUserLotId(String userLotId) { this.userLotId = userLotId; }

    public String getFileStatus() { return fileStatus; }
    public void setFileStatus(String fileStatus) { this.fileStatus = fileStatus; }

    public String getErrorReason() { return errorReason; }
    public void setErrorReason(String errorReason) { this.errorReason = errorReason; }

    public java.time.Instant getResolvedAt() { return resolvedAt; }
    public void setResolvedAt(java.time.Instant resolvedAt) { this.resolvedAt = resolvedAt; }

    public String getDestinationFolder() { return destinationFolder; }
    public void setDestinationFolder(String destinationFolder) { this.destinationFolder = destinationFolder; }

    public Long getExensioWaferKey() { return exensioWaferKey; }
    public void setExensioWaferKey(Long exensioWaferKey) { this.exensioWaferKey = exensioWaferKey; }

    public Long getExensioPgKey() { return exensioPgKey; }
    public void setExensioPgKey(Long exensioPgKey) { this.exensioPgKey = exensioPgKey; }
}
