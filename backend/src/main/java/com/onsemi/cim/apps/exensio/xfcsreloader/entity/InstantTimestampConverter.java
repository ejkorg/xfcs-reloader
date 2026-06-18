package com.onsemi.cim.apps.exensio.xfcsreloader.entity;

import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

import java.sql.Timestamp;
import java.time.Instant;

/**
 * Oracle-safe converter for Instant <-> TIMESTAMP/DATE columns.
 *
 * Hibernate's default Instant mapping may use timezone-aware extraction on Oracle,
 * which can fail for DATE/TIMESTAMP columns in some DB/session configurations
 * (ORA-18716). This converter forces plain java.sql.Timestamp handling.
 */
@Converter(autoApply = false)
public class InstantTimestampConverter implements AttributeConverter<Instant, Timestamp> {

    @Override
    public Timestamp convertToDatabaseColumn(Instant attribute) {
        return attribute == null ? null : Timestamp.from(attribute);
    }

    @Override
    public Instant convertToEntityAttribute(Timestamp dbData) {
        return dbData == null ? null : dbData.toInstant();
    }
}
