package com.onsemi.cim.apps.exensio.xfcsreloader.repository;

import com.onsemi.cim.apps.exensio.xfcsreloader.entity.ReloadSessionNotificationEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface ReloadSessionNotificationRepository extends JpaRepository<ReloadSessionNotificationEntity, String> {
}
