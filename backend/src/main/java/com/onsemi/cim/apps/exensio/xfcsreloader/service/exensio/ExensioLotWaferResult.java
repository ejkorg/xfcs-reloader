package com.onsemi.cim.apps.exensio.xfcsreloader.service.exensio;

public sealed interface ExensioLotWaferResult {
    record Found(long lotKey, Long waferKey, long pgKey, String ppid) implements ExensioLotWaferResult {}
    record NotFound() implements ExensioLotWaferResult {}
    record Error(String message) implements ExensioLotWaferResult {}
}
