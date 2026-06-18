package com.onsemi.cim.apps.exensio.xfcsreloader.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Lob;
import jakarta.persistence.Table;

import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;

@Entity
@Table(name = "xfcs_dearchiver_reload_sessions")
public class ReloadSessionEntity {

    @Id
    @Column(name = "session_id", length = 64, nullable = false)
    private String sessionId;

    @Column(name = "requester")
    private String requester;

    @Column(name = "environment")
    private String environment;

    @Column(name = "site")
    private String site;

    @Column(name = "area")
    private String area;

    @Column(name = "tester_type")
    private String testerType;

    @Column(name = "status")
    private String status;

    @Column(name = "message", length = 4000)
    private String message;

    @Column(name = "file_count")
    private Integer fileCount;

    @Column(name = "total_bytes")
    private Long totalBytes;

    @Lob
    @Column(name = "details")
    private String details;

    @Column(name = "created_at")
    @JdbcTypeCode(SqlTypes.TIMESTAMP)
    private Instant createdAt;

    @Column(name = "started_at")
    @JdbcTypeCode(SqlTypes.TIMESTAMP)
    private Instant startedAt;

    @Column(name = "completed_at")
    @JdbcTypeCode(SqlTypes.TIMESTAMP)
    private Instant completedAt;

    public String getSessionId() {
        return sessionId;
    }

    public void setSessionId(String sessionId) {
        this.sessionId = sessionId;
    }

    public String getRequester() {
        return requester;
    }

    public void setRequester(String requester) {
        this.requester = requester;
    }

    public String getEnvironment() {
        return environment;
    }

    public void setEnvironment(String environment) {
        this.environment = environment;
    }

    public String getSite() {
        return site;
    }

    public void setSite(String site) {
        this.site = site;
    }

    public String getArea() {
        return area;
    }

    public void setArea(String area) {
        this.area = area;
    }

    public String getTesterType() {
        return testerType;
    }

    public void setTesterType(String testerType) {
        this.testerType = testerType;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public String getMessage() {
        return message;
    }

    public void setMessage(String message) {
        this.message = message;
    }

    public Integer getFileCount() {
        return fileCount;
    }

    public void setFileCount(Integer fileCount) {
        this.fileCount = fileCount;
    }

    public Long getTotalBytes() {
        return totalBytes;
    }

    public void setTotalBytes(Long totalBytes) {
        this.totalBytes = totalBytes;
    }

    public String getDetails() {
        return details;
    }

    public void setDetails(String details) {
        this.details = details;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }

    public Instant getStartedAt() {
        return startedAt;
    }

    public void setStartedAt(Instant startedAt) {
        this.startedAt = startedAt;
    }

    public Instant getCompletedAt() {
        return completedAt;
    }

    public void setCompletedAt(Instant completedAt) {
        this.completedAt = completedAt;
    }
}
