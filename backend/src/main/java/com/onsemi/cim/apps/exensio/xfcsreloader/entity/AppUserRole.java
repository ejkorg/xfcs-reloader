package com.onsemi.cim.apps.exensio.xfcsreloader.entity;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "app_user_role")
public class AppUserRole {

    @EmbeddedId
    private AppUserRoleId id = new AppUserRoleId();

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt = LocalDateTime.now();

    public AppUserRoleId getId() {
        return id;
    }

    public void setId(AppUserRoleId id) {
        this.id = id;
    }

    public String getUsername() {
        return id != null ? id.getUsername() : null;
    }

    public void setUsername(String username) {
        if (id == null) {
            id = new AppUserRoleId();
        }
        id.setUsername(username);
    }

    public String getRole() {
        return id != null ? id.getRole() : null;
    }

    public void setRole(String role) {
        if (id == null) {
            id = new AppUserRoleId();
        }
        id.setRole(role);
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
    }
}
