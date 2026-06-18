package com.onsemi.cim.apps.exensio.xfcsreloader.repository;

import com.onsemi.cim.apps.exensio.xfcsreloader.entity.ReloadSessionEventEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;

public interface ReloadSessionEventRepository extends JpaRepository<ReloadSessionEventEntity, Long> {
    List<ReloadSessionEventEntity> findBySessionIdOrderByEventTimeAsc(String sessionId);
    List<ReloadSessionEventEntity> findBySessionId(String sessionId);
    long countBySessionIdAndEventType(String sessionId, String eventType);
    long countBySessionIdAndEventTypeIn(String sessionId, Collection<String> eventTypes);
}
