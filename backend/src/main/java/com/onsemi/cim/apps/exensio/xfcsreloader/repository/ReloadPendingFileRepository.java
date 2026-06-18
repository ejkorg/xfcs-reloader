package com.onsemi.cim.apps.exensio.xfcsreloader.repository;

import com.onsemi.cim.apps.exensio.xfcsreloader.entity.ReloadPendingFileEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface ReloadPendingFileRepository extends JpaRepository<ReloadPendingFileEntity, String> {

    /** Find all pending files for a given session. */
    List<ReloadPendingFileEntity> findBySessionId(String sessionId);

    /** Find all pending files for a given environment. */
    List<ReloadPendingFileEntity> findByEnvironment(String environment);

    /** Delete all pending files for a given session. */
    void deleteBySessionId(String sessionId);

    /** Count remaining pending files for a session. */
    long countBySessionId(String sessionId);

    /** Find pending files by file status (e.g. "exensio_loading") */
    List<ReloadPendingFileEntity> findByFileStatus(String fileStatus);
}
