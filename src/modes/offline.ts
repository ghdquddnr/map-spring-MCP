import * as fs from 'fs';
import * as path from 'path';
import { ColumnMetadata, TableSchema } from '../types.js';
import { snakeToCamel, translateType } from '../utils/translator.js';

/**
 * Splits a string by commas, but only when those commas are NOT inside parentheses.
 * Useful for splitting column definitions: "COL1 VARCHAR2(10) NOT NULL, COL2 NUMBER(5, 2)"
 */
function splitByCommaOutsideParens(str: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;

  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (char === '(') {
      depth++;
      current += char;
    } else if (char === ')') {
      depth--;
      current += char;
    } else if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim().length > 0) {
    parts.push(current.trim());
  }
  return parts;
}

/**
 * Normalizes quotes and whitespace from identifier names.
 * e.g., "TB_SETTLE_MASTER" -> TB_SETTLE_MASTER
 */
function cleanIdentifier(id: string): string {
  return id.replace(/['"`]/g, '').trim().toUpperCase();
}

export interface OfflineParserResult {
  tables: Map<string, TableSchema>;
}

export function parseDDLDirectory(directoryPath: string): TableSchema[] {
  if (!fs.existsSync(directoryPath)) {
    throw new Error(`DDL directory does not exist: ${directoryPath}`);
  }

  const stat = fs.statSync(directoryPath);
  let files: string[] = [];
  if (stat.isFile()) {
    files = [directoryPath];
  } else {
    files = fs.readdirSync(directoryPath)
      .filter(f => f.endsWith('.sql') || f.endsWith('.ddl'))
      .map(f => path.join(directoryPath, f));
  }

  const schemas: TableSchema[] = [];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const fileSchemas = parseDDLContent(content, path.basename(file));
    schemas.push(...fileSchemas);
  }

  return schemas;
}

export function parseDDLContent(sqlContent: string, sourceName: string): TableSchema[] {
  // Normalize line endings and comments
  // Remove block comments /* ... */
  let cleanSql = sqlContent.replace(/\/\*[\s\S]*?\*\//g, '');
  // Remove inline comments -- ... (but avoid removing URLs or standard sql string literals containing --)
  cleanSql = cleanSql.split('\n')
    .map(line => {
      const idx = line.indexOf('--');
      if (idx !== -1) {
        // Keep string literals before '--'
        return line.substring(0, idx);
      }
      return line;
    })
    .join('\n');

  // Split by semicolons to get individual SQL commands
  const commands = cleanSql.split(';').map(cmd => cmd.trim()).filter(cmd => cmd.length > 0);

  const schemasMap = new Map<string, TableSchema>();
  const columnComments = new Map<string, string>(); // Key: "TABLE_NAME.COLUMN_NAME", Value: comment

  for (const cmd of commands) {
    // 1. Check for CREATE TABLE
    const createTableMatch = cmd.match(/CREATE\s+(?:TEMP\s+|TEMPORARY\s+)?TABLE\s+([A-Za-z0-9_`".]+)\s*\(([\s\S]+)\)/i);
    if (createTableMatch) {
      let fullTableName = cleanIdentifier(createTableMatch[1]);
      // Remove schema prefix if present (e.g. DBO.TB_SETTLE -> TB_SETTLE)
      const parts = fullTableName.split('.');
      const tableName = parts[parts.length - 1];

      const columnsAndConstraintsBody = createTableMatch[2];
      const clauses = splitByCommaOutsideParens(columnsAndConstraintsBody);

      const columns: ColumnMetadata[] = [];
      const pkColumnsSet = new Set<string>();

      for (const clause of clauses) {
        const upperClause = clause.toUpperCase();

        // Check for table level PK: CONSTRAINT PK_NAME PRIMARY KEY (COL1, COL2) or PRIMARY KEY (COL1)
        const tablePkMatch = clause.match(/(?:CONSTRAINT\s+\w+\s+)?PRIMARY\s+KEY\s*\(([^)]+)\)/i);
        if (tablePkMatch) {
          const cols = tablePkMatch[1].split(',').map(c => cleanIdentifier(c));
          cols.forEach(c => pkColumnsSet.add(c));
          continue;
        }

        // Check for other table level constraints to ignore
        if (upperClause.startsWith('CONSTRAINT') || upperClause.startsWith('FOREIGN KEY') || upperClause.startsWith('UNIQUE') || upperClause.startsWith('CHECK')) {
          continue;
        }

        // It is a column definition: COLUMN_NAME DATA_TYPE [NOT NULL/NULL] [PRIMARY KEY] [DEFAULT ...]
        // We match column name, data type (which might contain parens), and the rest of constraints
        const colMatch = clause.match(/^([A-Za-z0-9_`"]+)\s+([A-Za-z0-9_]+\s*(?:\(\s*\d+\s*(?:,\s*\d+\s*)?\))?)([\s\S]*)$/i);
        if (colMatch) {
          const rawColName = colMatch[1];
          const physicalColumn = cleanIdentifier(rawColName);
          const dataType = colMatch[2].trim();
          const rest = colMatch[3] ? colMatch[3].toUpperCase() : '';

          const nullable = !rest.includes('NOT NULL');
          const isPrimaryKey = rest.includes('PRIMARY KEY');
          if (isPrimaryKey) {
            pkColumnsSet.add(physicalColumn);
          }

          const fieldProperty = snakeToCamel(physicalColumn);
          const javaTranslation = translateType(dataType, nullable);

          columns.push({
            physicalColumn,
            dataType,
            nullable,
            fieldProperty,
            javaType: javaTranslation.javaType,
            comment: '', // Filled in later if COMMENT statement is found
            isPrimaryKey: false // Patched later after scanning all PK constraints
          });
        }
      }

      // Patch PK flags
      columns.forEach(col => {
        if (pkColumnsSet.has(col.physicalColumn)) {
          col.isPrimaryKey = true;
        }
      });

      if (columns.length > 0) {
        schemasMap.set(tableName, {
          tableName,
          source: `Local DDL File (${sourceName})`,
          columns
        });
      }
      continue;
    }

    // 2. Check for COMMENT ON COLUMN
    const colCommentMatch = cmd.match(/COMMENT\s+ON\s+COLUMN\s+([A-Za-z0-9_`".]+)\s+IS\s+'([\s\S]*?)'/i);
    if (colCommentMatch) {
      const fullColPath = cleanIdentifier(colCommentMatch[1]); // e.g. TB_SETTLE_MASTER.SETTLE_NO
      const comment = colCommentMatch[2].trim();
      columnComments.set(fullColPath, comment);
      continue;
    }

    // 3. Check for COMMENT ON TABLE (optional)
    const tableCommentMatch = cmd.match(/COMMENT\s+ON\s+TABLE\s+([A-Za-z0-9_`".]+)\s+IS\s+'([\s\S]*?)'/i);
    if (tableCommentMatch) {
      // We can log table comment if we want, but column comments are key
      continue;
    }
  }

  // Bind column comments to schemas
  for (const [tableName, schema] of schemasMap.entries()) {
    for (const col of schema.columns) {
      const commentKey = `${tableName}.${col.physicalColumn}`;
      if (columnComments.has(commentKey)) {
        col.comment = columnComments.get(commentKey)!;
      }
    }
  }

  return Array.from(schemasMap.values());
}
