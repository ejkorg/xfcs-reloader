package com.onsemi.cim.apps.exensio.xfcsreloader.repository;

import com.onsemi.cim.apps.exensio.xfcsreloader.entity.AppUser;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface AppUserRepository extends JpaRepository<AppUser, String> {
    Optional<AppUser> findByUsername(String username);
    boolean existsByUsername(String username);
}
