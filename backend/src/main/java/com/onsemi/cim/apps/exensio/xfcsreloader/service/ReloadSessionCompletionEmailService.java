package com.onsemi.cim.apps.exensio.xfcsreloader.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.onsemi.cim.apps.exensio.xfcsreloader.config.XfcsProperties;
import com.onsemi.cim.apps.exensio.xfcsreloader.entity.ReloadSessionEntity;
import com.onsemi.cim.apps.exensio.xfcsreloader.entity.ReloadSessionEventEntity;
import com.onsemi.cim.apps.exensio.xfcsreloader.entity.ReloadSessionNotificationEntity;
import com.onsemi.cim.apps.exensio.xfcsreloader.repository.ReloadSessionEventRepository;
import com.onsemi.cim.apps.exensio.xfcsreloader.repository.ReloadSessionNotificationRepository;
import com.onsemi.cim.apps.exensio.xfcsreloader.repository.ReloadSessionRepository;
import com.onsemi.cim.apps.exensio.xfcsreloader.web.dto.ReloadRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

@Service
public class ReloadSessionCompletionEmailService {

    private static final Logger log = LoggerFactory.getLogger(ReloadSessionCompletionEmailService.class);
    private static final Set<String> NOTIFIABLE = Set.of("completed", "failed", "partially_failed");

    private final ReloadSessionRepository sessionRepository;
    private final ReloadSessionEventRepository eventRepository;
    private final ReloadSessionNotificationRepository notificationRepository;
    private final JavaMailSender mailSender;
    private final XfcsProperties props;
    private final ObjectMapper objectMapper;
    private volatile boolean notificationTableUnavailableLogged = false;

    public ReloadSessionCompletionEmailService(ReloadSessionRepository sessionRepository,
                                               ReloadSessionEventRepository eventRepository,
                                               ReloadSessionNotificationRepository notificationRepository,
                                               JavaMailSender mailSender,
                                               XfcsProperties props,
                                               ObjectMapper objectMapper) {
        this.sessionRepository = sessionRepository;
        this.eventRepository = eventRepository;
        this.notificationRepository = notificationRepository;
        this.mailSender = mailSender;
        this.props = props;
        this.objectMapper = objectMapper;
    }

    @Async("reloadTaskExecutor")
    public void notifyIfTerminal(String sessionId) {
        if (sessionId == null || sessionId.isBlank()) return;
        if (!props.isNotificationEmailEnabled()) return;
        if (alreadyNotified(sessionId)) return;

        Optional<ReloadSessionEntity> opt = sessionRepository.findById(sessionId);
        if (opt.isEmpty()) return;
        ReloadSessionEntity session = opt.get();

        String status = normalize(session.getStatus());
        if (!NOTIFIABLE.contains(status)) return;

        LinkedHashSet<String> recipients = resolveRecipients(session.getRequester());
        if (recipients.isEmpty()) {
            log.warn("[Notify] No recipient resolved for session {} requester='{}'", sessionId, session.getRequester());
            return;
        }

        try {
            List<FileRow> fileRows = buildFileRows(session);
            int completed = 0;
            int failed = 0;
            for (FileRow r : fileRows) {
                if ("completed".equals(r.status)) completed++;
                if ("failed".equals(r.status)) failed++;
            }

            String prefix = props.getNotificationEmailSubjectPrefix() == null
                    ? "[XFCS Reloader]"
                    : props.getNotificationEmailSubjectPrefix().trim();
            String subject = prefix + " Session " + sessionId + " " + status.toUpperCase(Locale.ROOT);

            String html = buildHtmlBody(session, fileRows, completed, failed);
            String text = buildTextBody(session, fileRows, completed, failed);

            var mime = mailSender.createMimeMessage();
            var helper = new MimeMessageHelper(mime, true, java.nio.charset.StandardCharsets.UTF_8.name());
            helper.setFrom(safeFromAddress());
            helper.setTo(recipients.toArray(String[]::new));
            helper.setSubject(subject);
            helper.setText(text, html);

            mailSender.send(mime);

            ReloadSessionNotificationEntity sent = new ReloadSessionNotificationEntity();
            sent.setSessionId(sessionId);
            sent.setStatus(status);
            sent.setRecipient(String.join(",", recipients));
            sent.setSubject(subject);
            sent.setSentAt(Instant.now());
            saveNotificationSafely(sent);

            log.info("[Notify] Completion email sent for session {} to {}", sessionId, recipients);
        } catch (Exception e) {
            log.warn("[Notify] Failed to send completion email for session {}: {}", sessionId, e.getMessage(), e);
        }
    }

    private boolean alreadyNotified(String sessionId) {
        try {
            return notificationRepository.existsById(sessionId);
        } catch (DataAccessException ex) {
            if (isTableMissing(ex)) {
                logNotificationTableMissingOnce(ex);
                // fail-open: allow mail send even if idempotency table is unavailable
                return false;
            }
            throw ex;
        }
    }

    private void saveNotificationSafely(ReloadSessionNotificationEntity sent) {
        try {
            notificationRepository.save(sent);
        } catch (DataAccessException ex) {
            if (isTableMissing(ex)) {
                logNotificationTableMissingOnce(ex);
                return;
            }
            // concurrent duplicate send protection (PK on session_id)
            log.debug("[Notify] Notification save skipped for session {}: {}", sent.getSessionId(), ex.getMessage());
        } catch (Exception duplicate) {
            // concurrent duplicate send protection (PK on session_id)
        }
    }

    private boolean isTableMissing(Throwable ex) {
        Throwable t = ex;
        while (t != null) {
            String m = t.getMessage();
            if (m != null) {
                String u = m.toUpperCase(Locale.ROOT);
                if (u.contains("ORA-00942") || u.contains("TABLE OR VIEW DOES NOT EXIST")) {
                    return true;
                }
            }
            t = t.getCause();
        }
        return false;
    }

    private void logNotificationTableMissingOnce(Throwable ex) {
        if (notificationTableUnavailableLogged) return;
        synchronized (this) {
            if (notificationTableUnavailableLogged) return;
            notificationTableUnavailableLogged = true;
            log.warn("[Notify] Notification table xfcs_dearchiver_reload_session_notifications is missing (ORA-00942). " +
                    "Emails will continue without DB idempotency until Liquibase changelog 5.7 is applied.", ex);
        }
    }

    private String safeFromAddress() {
        String from = props.getNotificationEmailFrom();
        if (from == null || from.isBlank()) return "no-reply@localhost";
        return from.trim();
    }

    private LinkedHashSet<String> resolveRecipients(String requester) {
        LinkedHashSet<String> out = new LinkedHashSet<>();

        String r = requester == null ? "" : requester.trim();
        if (looksLikeEmail(r)) {
            out.add(r);
        } else if (!r.isBlank()) {
            String domain = props.getNotificationEmailRequesterDomain();
            if (domain != null && !domain.isBlank()) {
                String candidate = r + "@" + domain.trim();
                if (looksLikeEmail(candidate)) out.add(candidate);
            }
        }

        addAllEmails(out, props.getNotificationEmailFallbackRecipients());
        return out;
    }

    private void addAllEmails(LinkedHashSet<String> target, Collection<String> candidates) {
        if (candidates == null) return;
        for (String raw : candidates) {
            if (raw == null) continue;
            for (String token : raw.split(",")) {
                String e = token == null ? "" : token.trim();
                if (looksLikeEmail(e)) target.add(e);
            }
        }
    }

    private boolean looksLikeEmail(String v) {
        if (v == null || v.isBlank()) return false;
        int at = v.indexOf('@');
        int dot = v.lastIndexOf('.');
        return at > 0 && dot > at + 1 && dot < v.length() - 1;
    }

    private List<FileRow> buildFileRows(ReloadSessionEntity session) {
        int maxFiles = Math.max(1, props.getNotificationEmailMaxFiles());
        List<FileRow> rows = new ArrayList<>();

        // 1) Build baseline from original request payload
        String details = session.getDetails();
        if (details != null && !details.isBlank()) {
            try {
                ReloadRequest req = objectMapper.readValue(details, ReloadRequest.class);
                if (req.files() != null && !req.files().isEmpty()) {
                    for (ReloadRequest.ReloadFileItem item : req.files()) {
                        if (rows.size() >= maxFiles) break;
                        String sourcePath = item.path();
                        String fileName = fileNameOf(sourcePath);
                        rows.add(new FileRow(sourcePath, fileName, item.userLotId(), "pending", null));
                    }
                } else if (req.filePaths() != null && !req.filePaths().isEmpty()) {
                    for (String p : req.filePaths()) {
                        if (rows.size() >= maxFiles) break;
                        rows.add(new FileRow(p, fileNameOf(p), null, "pending", null));
                    }
                }
            } catch (Exception e) {
                log.warn("[Notify] Failed to parse details for session {}", session.getSessionId());
            }
        }

        Map<String, FileRow> byFileName = new LinkedHashMap<>();
        Map<String, FileRow> byLot = new LinkedHashMap<>();
        for (FileRow r : rows) {
            if (r.fileName != null && !r.fileName.isBlank()) byFileName.putIfAbsent(r.fileName, r);
            if (r.userLotId != null && !r.userLotId.isBlank()) byLot.putIfAbsent(r.userLotId, r);
        }

        // 2) Overlay ETL outcome from monitor events
        List<ReloadSessionEventEntity> events = eventRepository.findBySessionIdOrderByEventTimeAsc(session.getSessionId());
        for (ReloadSessionEventEntity e : events) {
            String t = normalize(e.getEventType());
            if (!"file_completed".equals(t) && !"file_failed".equals(t)) continue;
            String msg = e.getMessage() == null ? "" : e.getMessage();

            FileRow hit = null;
            String lot = extractLot(msg);
            if (lot != null) hit = byLot.get(lot);
            if (hit == null) {
                for (Map.Entry<String, FileRow> en : byFileName.entrySet()) {
                    if (msg.contains(en.getKey())) {
                        hit = en.getValue();
                        break;
                    }
                }
            }
            if (hit == null && rows.size() < maxFiles) {
                // No match by lot or filename — the event references a file not in the
                // original request (e.g. reloaded filename differs from original).
                // Find the first still-pending row with a matching lot, or the first
                // pending row overall, rather than creating a synthetic duplicate row.
                if (lot != null) {
                    for (FileRow r : rows) {
                        if (lot.equals(r.userLotId) && "pending".equals(r.status)) {
                            hit = r;
                            break;
                        }
                    }
                }
                if (hit == null) {
                    for (FileRow r : rows) {
                        if ("pending".equals(r.status)) {
                            hit = r;
                            break;
                        }
                    }
                }
            }
            if (hit == null) continue;

            if ("file_completed".equals(t)) {
                hit.status = "completed";
                hit.reason = null;
            } else {
                hit.status = "failed";
                hit.reason = extractReason(msg);
            }
        }

        return rows;
    }

    private String fileNameOf(String path) {
        if (path == null || path.isBlank()) return "(unknown)";
        try {
            Path p = Path.of(path);
            Path name = p.getFileName();
            return name == null ? path : name.toString();
        } catch (Exception ignored) {
            return path;
        }
    }

    private String extractLot(String message) {
        if (message == null) return null;
        int idx = message.indexOf("(Lot:");
        if (idx < 0) return null;
        int end = message.indexOf(')', idx);
        if (end < 0) return null;
        String lot = message.substring(idx + 5, end).trim();
        return lot.isEmpty() ? null : lot;
    }

    private String extractReason(String message) {
        if (message == null) return null;
        int idx = message.indexOf("| Reason:");
        if (idx < 0) return null;
        String r = message.substring(idx + 9).trim();
        return r.isEmpty() ? null : r;
    }

    private String buildHtmlBody(ReloadSessionEntity session, List<FileRow> rows, int completed, int failed) {
        StringBuilder sb = new StringBuilder();
        sb.append("<html><body style='font-family:Arial,sans-serif'>");
        sb.append("<h3>XFCS Reload Session Finished</h3>");
        sb.append("<p><b>Session ID:</b> ").append(esc(session.getSessionId())).append("<br/>");
        sb.append("<b>Status:</b> ").append(esc(session.getStatus())).append("<br/>");
        sb.append("<b>Requester:</b> ").append(esc(session.getRequester())).append("<br/>");
        sb.append("<b>Environment:</b> ").append(esc(session.getEnvironment())).append("<br/>");
        sb.append("<b>Completed:</b> ").append(completed).append(" | <b>Failed:</b> ").append(failed).append("</p>");

        sb.append("<table border='1' cellpadding='6' cellspacing='0' style='border-collapse:collapse'>");
        sb.append("<tr style='background:#f3f3f3'><th>#</th><th>File</th><th>Lot</th><th>Status</th><th>Reason</th></tr>");
        int i = 1;
        for (FileRow r : rows) {
            sb.append("<tr>")
                    .append("<td>").append(i++).append("</td>")
                    .append("<td>").append(esc(r.fileName)).append("</td>")
                    .append("<td>").append(esc(r.userLotId)).append("</td>")
                    .append("<td>").append(esc(r.status)).append("</td>")
                    .append("<td>").append(esc(r.reason)).append("</td>")
                    .append("</tr>");
        }
        sb.append("</table>");
        sb.append("</body></html>");
        return sb.toString();
    }

    private String buildTextBody(ReloadSessionEntity session, List<FileRow> rows, int completed, int failed) {
        StringBuilder sb = new StringBuilder();
        sb.append("XFCS Reload Session Finished\n");
        sb.append("Session ID: ").append(session.getSessionId()).append("\n");
        sb.append("Status: ").append(session.getStatus()).append("\n");
        sb.append("Requester: ").append(session.getRequester()).append("\n");
        sb.append("Environment: ").append(session.getEnvironment()).append("\n");
        sb.append("Completed: ").append(completed).append(" | Failed: ").append(failed).append("\n\n");
        sb.append("Files:\n");
        int i = 1;
        for (FileRow r : rows) {
            sb.append(i++)
                    .append(") ")
                    .append(Optional.ofNullable(r.fileName).orElse("(unknown)"))
                    .append(" | Lot=")
                    .append(Optional.ofNullable(r.userLotId).orElse("-"))
                    .append(" | Status=")
                    .append(Optional.ofNullable(r.status).orElse("pending"));
            if (r.reason != null && !r.reason.isBlank()) sb.append(" | Reason=").append(r.reason);
            sb.append("\n");
        }
        return sb.toString();
    }

    private String esc(String v) {
        if (v == null) return "";
        return v.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&#39;");
    }

    private String normalize(String v) {
        return v == null ? "" : v.trim().toLowerCase(Locale.ROOT);
    }

    private static final class FileRow {
        private final String sourcePath;
        private final String fileName;
        private final String userLotId;
        private String status;
        private String reason;

        private FileRow(String sourcePath, String fileName, String userLotId, String status, String reason) {
            this.sourcePath = sourcePath;
            this.fileName = fileName;
            this.userLotId = userLotId;
            this.status = status;
            this.reason = reason;
        }
    }
}
