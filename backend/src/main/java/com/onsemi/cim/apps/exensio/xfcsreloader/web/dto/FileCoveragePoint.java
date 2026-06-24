package com.onsemi.cim.apps.exensio.xfcsreloader.web.dto;

/**
 * Per-bucket file coverage data, analogous to exensioreload's CoveragePoint.
 * Groups pending files by their created_at date (day/week/month bucket)
 * and breaks them down by processing status.
 */
public record FileCoveragePoint(
        String bucket,
        String environment,
        long total,
        long done,
        long enqueued,
        long staged,
        long failed
) {}
