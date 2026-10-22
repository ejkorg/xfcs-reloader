package com.onsemi.cim.apps.exensio.xfcsreloader.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import java.io.Serializable;

@Embeddable
public class AppUserRoleId implements Serializable {

    @Column(name = "username", length = 255)
    private String username;

    @Column(name = "role", length = 255)
    private String role;

    public String getUsername() {
        return username;
    }

    public void setUsername(String username) {
        this.username = username;
    }

    public String getRole() {
        return role;
    }

    public void setRole(String role) {
        this.role = role;
    }
}
