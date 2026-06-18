package com.onsemi.cim.apps.exensio.xfcsreloader.service;

public interface SshClient {
    String readRemoteFile(String host,
                          int port,
                          String username,
                          String privateKeyPath,
                          String password,
                          String knownHostsPath,
                          boolean strictHostKey,
                          int connectTimeoutMs,
                          int readTimeoutMs,
                          String remotePath);

        String runRemoteCommand(String host,
                                                        int port,
                                                        String username,
                                                        String privateKeyPath,
                                                        String password,
                                                        String knownHostsPath,
                                                        boolean strictHostKey,
                                                        int connectTimeoutMs,
                                                        int readTimeoutMs,
                                                        String command);
}
