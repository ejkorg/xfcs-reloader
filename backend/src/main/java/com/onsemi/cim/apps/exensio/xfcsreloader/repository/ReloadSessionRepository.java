package com.onsemi.cim.apps.exensio.xfcsreloader.repository;

import com.onsemi.cim.apps.exensio.xfcsreloader.entity.ReloadSessionEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;

public interface ReloadSessionRepository extends JpaRepository<ReloadSessionEntity, String> {
    long countByStatusIgnoreCase(String status);

    List<ReloadSessionEntity> findByRequester(String requester);

    List<ReloadSessionEntity> findTop20ByOrderByCreatedAtDesc();

    /** Count sessions whose status is NOT in the given collection (case-insensitive). */
    @Query("SELECT COUNT(s) FROM ReloadSessionEntity s WHERE LOWER(s.status) NOT IN :statuses")
    long countByStatusNotIn(@Param("statuses") Collection<String> statuses);
}
