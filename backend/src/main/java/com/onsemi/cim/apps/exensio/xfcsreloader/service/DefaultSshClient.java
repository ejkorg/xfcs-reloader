package com.onsemi.cim.apps.exensio.xfcsreloader.service;

import net.schmizz.sshj.SSHClient;
import net.schmizz.sshj.connection.channel.direct.Session;
import net.schmizz.sshj.transport.verification.PromiscuousVerifier;
import net.schmizz.sshj.userauth.keyprovider.KeyProvider;
import org.springframework.stereotype.Component;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.TimeUnit;

@Component
public class DefaultSshClient implements SshClient {

    @Override
    public String readRemoteFile(String host,
                                 int port,
                                 String username,
                                 String privateKeyPath,
                                 String password,
                                 String knownHostsPath,
                                 boolean strictHostKey,
                                 int connectTimeoutMs,
                                 int readTimeoutMs,
                                 String remotePath) {
        if (host == null || host.isBlank()) {
            throw new IllegalArgumentException("Remote host is required");
        }
        if (username == null || username.isBlank()) {
            throw new IllegalArgumentException("Remote username is required");
        }
        if (remotePath == null || remotePath.isBlank()) {
            throw new IllegalArgumentException("Remote path is required");
        }

        try (SSHClient ssh = new SSHClient()) {
            ssh.setConnectTimeout(connectTimeoutMs);
            ssh.setTimeout(readTimeoutMs);

            if (strictHostKey) {
                if (knownHostsPath == null || knownHostsPath.isBlank()) {
                    throw new IllegalStateException("Strict host-key verification is enabled but known_hosts path is missing");
                }
                Path kh = Path.of(knownHostsPath);
                if (!Files.exists(kh)) {
                    throw new IllegalStateException("Known hosts file not found: " + knownHostsPath);
                }
                ssh.loadKnownHosts(kh.toFile());
            } else {
                ssh.addHostKeyVerifier(new PromiscuousVerifier());
            }

            ssh.connect(host, port);
            try {
                if (privateKeyPath != null && !privateKeyPath.isBlank()) {
                    KeyProvider keyProvider = ssh.loadKeys(privateKeyPath);
                    ssh.authPublickey(username, keyProvider);
                } else if (password != null && !password.isBlank()) {
                    ssh.authPassword(username, password);
                } else {
                    ssh.authPublickey(username);
                }

                try (Session session = ssh.startSession()) {
                    String escapedPath = remotePath.replace("'", "'\\''");
                    String cmdText = "cat '" + escapedPath + "'";
                    try (Session.Command cmd = session.exec(cmdText)) {
                        String stdout = new String(cmd.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
                        cmd.join(Math.max(10, readTimeoutMs / 1000), TimeUnit.SECONDS);
                        Integer exitCode = cmd.getExitStatus();
                        if (exitCode != null && exitCode != 0) {
                            String stderr = new String(cmd.getErrorStream().readAllBytes(), StandardCharsets.UTF_8);
                            throw new IllegalStateException("Remote read failed, exit=" + exitCode + ", stderr=" + stderr);
                        }
                        return stdout;
                    }
                }
            } finally {
                ssh.disconnect();
            }
        } catch (Exception ex) {
            throw new IllegalStateException("Unable to read remote env.conf via SSH: " + ex.getMessage(), ex);
        }
    }

    @Override
    public String runRemoteCommand(String host,
                                   int port,
                                   String username,
                                   String privateKeyPath,
                                   String password,
                                   String knownHostsPath,
                                   boolean strictHostKey,
                                   int connectTimeoutMs,
                                   int readTimeoutMs,
                                   String command) {
        if (host == null || host.isBlank()) {
            throw new IllegalArgumentException("Remote host is required");
        }
        if (username == null || username.isBlank()) {
            throw new IllegalArgumentException("Remote username is required");
        }
        if (command == null || command.isBlank()) {
            throw new IllegalArgumentException("Remote command is required");
        }

        try (SSHClient ssh = new SSHClient()) {
            ssh.setConnectTimeout(connectTimeoutMs);
            ssh.setTimeout(readTimeoutMs);

            if (strictHostKey) {
                if (knownHostsPath == null || knownHostsPath.isBlank()) {
                    throw new IllegalStateException("Strict host-key verification is enabled but known_hosts path is missing");
                }
                Path kh = Path.of(knownHostsPath);
                if (!Files.exists(kh)) {
                    throw new IllegalStateException("Known hosts file not found: " + knownHostsPath);
                }
                ssh.loadKnownHosts(kh.toFile());
            } else {
                ssh.addHostKeyVerifier(new PromiscuousVerifier());
            }

            ssh.connect(host, port);
            try {
                if (privateKeyPath != null && !privateKeyPath.isBlank()) {
                    KeyProvider keyProvider = ssh.loadKeys(privateKeyPath);
                    ssh.authPublickey(username, keyProvider);
                } else if (password != null && !password.isBlank()) {
                    ssh.authPassword(username, password);
                } else {
                    ssh.authPublickey(username);
                }

                try (Session session = ssh.startSession()) {
                    try (Session.Command cmd = session.exec(command)) {
                        String stdout = new String(cmd.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
                        String stderr = new String(cmd.getErrorStream().readAllBytes(), StandardCharsets.UTF_8);
                        cmd.join(Math.max(10, readTimeoutMs / 1000), TimeUnit.SECONDS);
                        Integer exitCode = cmd.getExitStatus();

                        // grep returns exit 1 when no matches; treat that as valid/no-result.
                        if (exitCode != null && exitCode > 1) {
                            throw new IllegalStateException("Remote command failed, exit=" + exitCode + ", stderr=" + stderr);
                        }
                        return stdout;
                    }
                }
            } finally {
                ssh.disconnect();
            }
        } catch (Exception ex) {
            throw new IllegalStateException("Unable to execute remote command via SSH: " + ex.getMessage(), ex);
        }
    }
}
