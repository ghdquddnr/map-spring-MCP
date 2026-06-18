import {
  snakeToCamel,
  parseDbType,
  translateType,
  generateMyBatisResultMap,
  generateJavaDtoClass,
  generateJPAEntity
} from './translator.js';
import { TableSchema } from '../types.js';

describe('Translator Utilities', () => {
  describe('snakeToCamel', () => {
    it('should convert snake_case to camelCase', () => {
      expect(snakeToCamel('USER_ID')).toBe('userId');
      expect(snakeToCamel('REG_DTM')).toBe('regDtm');
      expect(snakeToCamel('TB_SETTLE_MASTER')).toBe('tbSettleMaster');
      expect(snakeToCamel('MTC_AT')).toBe('mtcAt');
    });
  });

  describe('parseDbType', () => {
    it('should parse precision and scale', () => {
      expect(parseDbType('VARCHAR2(20)')).toEqual({ baseType: 'VARCHAR2', length: 20 });
      expect(parseDbType('NUMBER(10, 2)')).toEqual({ baseType: 'NUMBER', precision: 10, scale: 2 });
      expect(parseDbType('NUMBER(5)')).toEqual({ baseType: 'NUMBER', precision: 5, scale: 0 });
      expect(parseDbType('NUMBER')).toEqual({ baseType: 'NUMBER' });
      expect(parseDbType('TIMESTAMP(6)')).toEqual({ baseType: 'TIMESTAMP', precision: 6, scale: 0 });
    });
  });

  describe('translateType', () => {
    it('should map string types to String', () => {
      expect(translateType('VARCHAR(10)', true).javaType).toBe('String');
      expect(translateType('VARCHAR2(255)', false).javaType).toBe('String');
      expect(translateType('CHAR(1)', true).javaType).toBe('String');
    });

    it('should map date/time types to LocalDateTime', () => {
      expect(translateType('DATE', true).javaType).toBe('LocalDateTime');
      expect(translateType('TIMESTAMP', false).javaType).toBe('LocalDateTime');
      expect(translateType('TIMESTAMP(6)', true).javaType).toBe('LocalDateTime');
    });

    it('should map numbers accurately based on scale and nullability', () => {
      // scale > 0 -> BigDecimal
      expect(translateType('NUMBER(15,2)', true).javaType).toBe('BigDecimal');
      expect(translateType('NUMERIC(10,5)', false).javaType).toBe('BigDecimal');

      // scale = 0, precision <= 9, nullable -> Integer
      expect(translateType('NUMBER(9)', true).javaType).toBe('Integer');
      // scale = 0, precision <= 9, non-nullable -> int
      expect(translateType('NUMBER(9)', false).javaType).toBe('int');

      // scale = 0, precision > 9, nullable -> Long
      expect(translateType('NUMBER(10)', true).javaType).toBe('Long');
      // scale = 0, precision > 9, non-nullable -> long
      expect(translateType('NUMBER(18)', false).javaType).toBe('long');
    });
  });

  describe('Code Generators', () => {
    const mockSchema: TableSchema = {
      tableName: 'TB_SETTLE_MASTER',
      source: 'Mock Source',
      columns: [
        {
          physicalColumn: 'SETTLE_NO',
          dataType: 'VARCHAR2(20)',
          nullable: false,
          fieldProperty: 'settleNo',
          javaType: 'String',
          comment: '정산 일련번호 (PK)',
          isPrimaryKey: true
        },
        {
          physicalColumn: 'MTC_AT',
          dataType: 'NUMBER(2)',
          nullable: true,
          fieldProperty: 'mtcAt',
          javaType: 'Integer',
          comment: '점검 상태 코드',
          isPrimaryKey: false
        },
        {
          physicalColumn: 'AMOUNT',
          dataType: 'NUMBER(15,2)',
          nullable: true,
          fieldProperty: 'amount',
          javaType: 'BigDecimal',
          comment: '정산 금액',
          isPrimaryKey: false
        }
      ]
    };

    it('should generate valid MyBatis resultMap XML', () => {
      const xml = generateMyBatisResultMap(mockSchema);
      expect(xml).toContain('<resultMap id="SettleMasterMap" type="com.company.project.domain.dto.SettleMasterDto">');
      expect(xml).toContain('<id property="settleNo" column="SETTLE_NO" javaType="string" />');
      expect(xml).toContain('<result property="mtcAt" column="MTC_AT" javaType="java.lang.Integer" />');
      expect(xml).toContain('<result property="amount" column="AMOUNT" javaType="java.math.BigDecimal" />');
    });

    it('should generate valid Java DTO class', () => {
      const dtoClass = generateJavaDtoClass(mockSchema);
      expect(dtoClass).toContain('package com.company.project.domain.dto;');
      expect(dtoClass).toContain('import jakarta.validation.constraints.NotNull;');
      expect(dtoClass).toContain('import jakarta.validation.constraints.Size;');
      expect(dtoClass).toContain('import java.math.BigDecimal;');
      expect(dtoClass).toContain('public class SettleMasterDto {');
      expect(dtoClass).toContain('@NotNull');
      expect(dtoClass).toContain('@Size(max = 20)');
      expect(dtoClass).toContain('private String settleNo;');
      expect(dtoClass).toContain('private Integer mtcAt;');
    });

    it('should generate valid JPA Entity class', () => {
      const entityClass = generateJPAEntity(mockSchema);
      expect(entityClass).toContain('package com.company.project.domain.entity;');
      expect(entityClass).toContain('import jakarta.persistence.Column;');
      expect(entityClass).toContain('import jakarta.persistence.Entity;');
      expect(entityClass).toContain('import jakarta.persistence.Table;');
      expect(entityClass).toContain('import jakarta.persistence.Id;');
      expect(entityClass).toContain('@Table(name = "TB_SETTLE_MASTER")');
      expect(entityClass).toContain('public class SettleMaster {');
      expect(entityClass).toContain('@Id');
      expect(entityClass).toContain('@Column(name = "SETTLE_NO", nullable = false)');
      expect(entityClass).toContain('private String settleNo;');
    });
  });
});
