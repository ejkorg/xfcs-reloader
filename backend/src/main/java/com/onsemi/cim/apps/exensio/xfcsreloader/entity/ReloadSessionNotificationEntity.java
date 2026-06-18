package com.onsemi.cim.apps.exensio.xfcsreloader.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;

@Entity
@Table(name = "xfcs_dearchiver_reload_session_notifications")
public class ReloadSessionNotificationEntity {

    @Id
    @Column(name = "session_id", length = 64, nullable = false)
    private String sessionId;

    @Column(name = "status", length = 32, nullable = false)
    private String status;

    @Column(name = "recipient", length = 1024, nullable = false)
    private String recipient;

    @Column(name = "subject", length = 512)
    private String subject;

    @Column(name = "sent_at", nullable = false)
    @jakarta.persistence.Convert(converter = InstantTimestampConverter.class)
    private Instant sentAt;

    public String getSessionId() {
        return sessionId;
    }

    public void setSessionId(String sessionId) {
        this.sessionId = sessionId;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public String getRecipient() {
        return recipient;
    }

    public void setRecipient(String recipient) {
        this.recipient = recipient;
    }

    public String getSubject() {
        return subject;
    }

    public void setSubject(String subject) {
        this.subject = subject;
    }

    public Instant getSentAt() {
        return sentAt;
    }

    public void setSentAt(Instant sentAt) {
        this.sentAt = sentAt;
    }
}
