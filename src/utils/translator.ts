import { ColumnMetadata, TableSchema } from '../types.js';

/**
 * Converts a snake_case database column name into standard camelCase.
 * e.g., SETTLE_NO -> settleNo, MTC_AT -> mtcAt
 */
export function snakeToCamel(str: string): string {
  const lowercase = str.toLowerCase();
  return lowercase.replace(/(_[a-z])/g, (group) =>
    group.toUpperCase().replace('_', '')
  );
}

/**
 * Converts table name to Java class name, stripping common prefixes like TB_ or V_
 * e.g., TB_SETTLE_MASTER -> SettleMaster
 */
export function tableNameToClassName(tableName: string): string {
  let cleanName = tableName;
  if (tableName.toUpperCase().startsWith('TB_')) {
    cleanName = tableName.substring(3);
  } else if (tableName.toUpperCase().startsWith('V_')) {
    cleanName = tableName.substring(2);
  }
  const camel = snakeToCamel(cleanName);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

/**
 * Parses database type string to extract precision and scale.
 * e.g., VARCHAR2(20) -> { type: 'VARCHAR2', length: 20 }
 * e.g., NUMBER(10, 2) -> { type: 'NUMBER', precision: 10, scale: 2 }
 */
export interface ParsedDbType {
  baseType: string;
  length?: number;
  precision?: number;
  scale?: number;
}

export function parseDbType(dbType: string): ParsedDbType {
  const match = dbType.match(/^([A-Za-z0-9_]+)(?:\s*\(\s*(\d+)(?:\s*,\s*(\d+))?\s*\))?/);
  if (!match) {
    return { baseType: dbType.toUpperCase() };
  }

  const baseType = match[1].toUpperCase();
  const firstParam = match[2] ? parseInt(match[2], 10) : undefined;
  const secondParam = match[3] ? parseInt(match[3], 10) : undefined;

  if (secondParam !== undefined) {
    return { baseType, precision: firstParam, scale: secondParam };
  } else if (firstParam !== undefined) {
    // For VARCHAR(20), firstParam is length. For NUMBER(10), it is precision (scale = 0)
    if (['VARCHAR', 'VARCHAR2', 'CHAR', 'NVARCHAR', 'NVARCHAR2'].includes(baseType)) {
      return { baseType, length: firstParam };
    } else {
      return { baseType, precision: firstParam, scale: 0 };
    }
  }

  return { baseType };
}

/**
 * Mappings between physical DB types and Java target types.
 * Standard implementation as defined in AGENT.md
 */
export function translateType(dbTypeStr: string, nullable: boolean): { javaType: string; fullType: string } {
  const parsed = parseDbType(dbTypeStr);
  const base = parsed.baseType;

  // 1. Strings
  if (['VARCHAR', 'VARCHAR2', 'CHAR', 'NVARCHAR', 'NVARCHAR2', 'TEXT', 'CLOB'].includes(base)) {
    return { javaType: 'String', fullType: 'java.lang.String' };
  }

  // 2. Numbers (NUMBER, NUMERIC, DECIMAL)
  if (['NUMBER', 'NUMERIC', 'DECIMAL'].includes(base)) {
    const scale = parsed.scale ?? 0;
    const precision = parsed.precision ?? 0;

    if (scale > 0) {
      return { javaType: 'BigDecimal', fullType: 'java.math.BigDecimal' };
    } else {
      // scale = 0
      if (precision > 0 && precision <= 9) {
        return nullable
          ? { javaType: 'Integer', fullType: 'java.lang.Integer' }
          : { javaType: 'int', fullType: 'int' };
      } else {
        // Default to long/Long for large or unspecified precision
        return nullable
          ? { javaType: 'Long', fullType: 'java.lang.Long' }
          : { javaType: 'long', fullType: 'long' };
      }
    }
  }

  // 3. Other Integers
  if (['INT', 'INTEGER', 'SMALLINT', 'TINYINT'].includes(base)) {
    return nullable
      ? { javaType: 'Integer', fullType: 'java.lang.Integer' }
      : { javaType: 'int', fullType: 'int' };
  }
  if (['BIGINT'].includes(base)) {
    return nullable
      ? { javaType: 'Long', fullType: 'java.lang.Long' }
      : { javaType: 'long', fullType: 'long' };
  }

  // 4. Floating points
  if (['DOUBLE', 'DOUBLE PRECISION', 'FLOAT', 'REAL'].includes(base)) {
    return nullable
      ? { javaType: 'Double', fullType: 'java.lang.Double' }
      : { javaType: 'double', fullType: 'double' };
  }

  // 5. Date & Time
  if (['DATE', 'TIMESTAMP', 'DATETIME', 'DATETIME2', 'SMALLDATETIME'].includes(base) || base.startsWith('TIMESTAMP')) {
    return { javaType: 'LocalDateTime', fullType: 'java.time.LocalDateTime' };
  }

  // Fallback
  return { javaType: 'String', fullType: 'java.lang.String' };
}

/**
 * Resolves MyBatis javaType mapping for ResultMap.
 * Handles primitive type names vs wrapper packages.
 */
export function getMyBatisJavaType(fullType: string): string {
  if (fullType === 'java.lang.String') return 'string';
  if (fullType === 'int') return 'int';
  if (fullType === 'long') return 'long';
  if (fullType === 'double') return 'double';
  return fullType;
}

/**
 * Generates MyBatis XML <resultMap> configuration.
 */
export function generateMyBatisResultMap(schema: TableSchema, dtoPackage: string = 'com.company.project.domain.dto'): string {
  const className = tableNameToClassName(schema.tableName);
  const dtoClassName = className + 'Dto';
  const resultMapId = className + 'Map';

  let xml = `<resultMap id="${resultMapId}" type="${dtoPackage}.${dtoClassName}">\n`;

  // Place PKs first
  const pkColumns = schema.columns.filter(col => col.isPrimaryKey);
  const otherColumns = schema.columns.filter(col => !col.isPrimaryKey);

  for (const col of pkColumns) {
    const parsedType = translateType(col.dataType, col.nullable);
    const mType = getMyBatisJavaType(parsedType.fullType);
    xml += `    <id property="${col.fieldProperty}" column="${col.physicalColumn}" javaType="${mType}" />\n`;
  }

  for (const col of otherColumns) {
    const parsedType = translateType(col.dataType, col.nullable);
    const mType = getMyBatisJavaType(parsedType.fullType);
    xml += `    <result property="${col.fieldProperty}" column="${col.physicalColumn}" javaType="${mType}" />\n`;
  }

  xml += `</resultMap>`;
  return xml;
}

/**
 * Generates Spring-compliant DTO Class with Lombok & validation annotations.
 */
export function generateJavaDtoClass(schema: TableSchema, dtoPackage: string = 'com.company.project.domain.dto'): string {
  const className = tableNameToClassName(schema.tableName);
  const dtoClassName = className + 'Dto';

  let hasBigDecimal = false;
  let hasLocalDateTime = false;
  let hasSize = false;
  let hasNotNull = false;

  const fieldsCode = schema.columns.map(col => {
    const parsedType = translateType(col.dataType, col.nullable);
    if (parsedType.javaType === 'BigDecimal') hasBigDecimal = true;
    if (parsedType.javaType === 'LocalDateTime') hasLocalDateTime = true;

    const annotations: string[] = [];

    // Validation annotations
    if (!col.nullable) {
      hasNotNull = true;
      annotations.push('    @NotNull');
    }

    const parsedDb = parseDbType(col.dataType);
    if (parsedDb.length !== undefined) {
      hasSize = true;
      annotations.push(`    @Size(max = ${parsedDb.length})`);
    }

    let fieldStr = '';
    if (col.comment) {
      fieldStr += `    /**\n     * ${col.comment}\n     */\n`;
    }
    if (annotations.length > 0) {
      fieldStr += annotations.join('\n') + '\n';
    }
    fieldStr += `    private ${parsedType.javaType} ${col.fieldProperty};`;
    return fieldStr;
  }).join('\n\n');

  // Imports list
  const imports: string[] = [
    'import lombok.Data;',
    'import lombok.NoArgsConstructor;',
    'import lombok.AllArgsConstructor;',
    'import lombok.Builder;'
  ];

  if (hasBigDecimal) imports.push('import java.math.BigDecimal;');
  if (hasLocalDateTime) imports.push('import java.time.LocalDateTime;');
  if (hasNotNull) imports.push('import jakarta.validation.constraints.NotNull;');
  if (hasSize) imports.push('import jakarta.validation.constraints.Size;');

  imports.sort();

  return `package ${dtoPackage};

${imports.join('\n')}

/**
 * DTO for table ${schema.tableName}
 * Generated by MapSpring MCP Engine
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ${dtoClassName} {

${fieldsCode}
}`;
}

/**
 * Generates Spring-compliant JPA Entity Class.
 */
export function generateJPAEntity(schema: TableSchema, entityPackage: string = 'com.company.project.domain.entity'): string {
  const entityClassName = tableNameToClassName(schema.tableName);

  let hasBigDecimal = false;
  let hasLocalDateTime = false;
  let hasSize = false;
  let hasNotNull = false;
  let hasId = false;

  const fieldsCode = schema.columns.map(col => {
    const parsedType = translateType(col.dataType, col.nullable);
    if (parsedType.javaType === 'BigDecimal') hasBigDecimal = true;
    if (parsedType.javaType === 'LocalDateTime') hasLocalDateTime = true;

    const annotations: string[] = [];

    if (col.isPrimaryKey) {
      hasId = true;
      annotations.push('    @Id');
      // If numeric and PK, usually we might have sequence or identity, but let's keep it simple or default
    }

    const columnAttribs: string[] = [`name = "${col.physicalColumn}"`];
    if (!col.nullable) {
      columnAttribs.push('nullable = false');
    }
    annotations.push(`    @Column(${columnAttribs.join(', ')})`);

    // Validations
    if (!col.nullable) {
      hasNotNull = true;
      annotations.push('    @NotNull');
    }

    const parsedDb = parseDbType(col.dataType);
    if (parsedDb.length !== undefined) {
      hasSize = true;
      annotations.push(`    @Size(max = ${parsedDb.length})`);
    }

    let fieldStr = '';
    if (col.comment) {
      fieldStr += `    /**\n     * ${col.comment}\n     */\n`;
    }
    fieldStr += annotations.join('\n') + '\n';
    fieldStr += `    private ${parsedType.javaType} ${col.fieldProperty};`;
    return fieldStr;
  }).join('\n\n');

  // Imports list
  const imports: string[] = [
    'import jakarta.persistence.Column;',
    'import jakarta.persistence.Entity;',
    'import jakarta.persistence.Table;',
    'import lombok.Data;',
    'import lombok.NoArgsConstructor;',
    'import lombok.AllArgsConstructor;',
    'import lombok.Builder;'
  ];

  if (hasId) imports.push('import jakarta.persistence.Id;');
  if (hasBigDecimal) imports.push('import java.math.BigDecimal;');
  if (hasLocalDateTime) imports.push('import java.time.LocalDateTime;');
  if (hasNotNull) imports.push('import jakarta.validation.constraints.NotNull;');
  if (hasSize) imports.push('import jakarta.validation.constraints.Size;');

  imports.sort();

  return `package ${entityPackage};

${imports.join('\n')}

/**
 * Entity for table ${schema.tableName}
 * Generated by MapSpring MCP Engine
 */
@Entity
@Table(name = "${schema.tableName}")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ${entityClassName} {

${fieldsCode}
}`;
}
