import { ColumnMetadata, TableSchema } from '../types.js';
import { snakeToCamel, translateType } from '../utils/translator.js';

export type DbDialect = 'postgres' | 'mysql' | 'oracle' | 'mssql' | 'unknown';

export function getDatabaseDialect(url: string): DbDialect {
  const normalized = url.toLowerCase();
  if (normalized.startsWith('postgres://') || normalized.startsWith('postgresql://')) {
    return 'postgres';
  }
  if (normalized.startsWith('mysql://') || normalized.startsWith('mariadb://')) {
    return 'mysql';
  }
  if (normalized.startsWith('oracle://') || normalized.includes('oracle') || normalized.includes('thin')) {
    return 'oracle';
  }
  if (normalized.startsWith('mssql://') || normalized.startsWith('sqlserver://') || normalized.includes('sqlserver')) {
    return 'mssql';
  }
  return 'unknown';
}

export class DatabaseClient {
  private url: string;
  private dialect: DbDialect;
  private connection: any = null;

  constructor(url: string) {
    this.url = url;
    this.dialect = getDatabaseDialect(url);
  }

  async connect(): Promise<void> {
    if (this.dialect === 'postgres') {
      const pg = await import('pg');
      const client = new pg.default.Client({ connectionString: this.url });
      await client.connect();
      this.connection = client;
    } else if (this.dialect === 'mysql') {
      const mysql = await import('mysql2/promise');
      const connection = await mysql.createConnection(this.url);
      this.connection = connection;
    } else if (this.dialect === 'oracle') {
      const oracledb = await import('oracledb');
      oracledb.default.initOracleClient();
      const connection = await oracledb.default.getConnection({
        connectString: this.url
      });
      this.connection = connection;
    } else if (this.dialect === 'mssql') {
      const mssql = await import('mssql');
      const connection = await mssql.default.connect(this.url);
      this.connection = connection;
    } else {
      throw new Error(`Unsupported database dialect: ${this.dialect}`);
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connection) return;

    if (this.dialect === 'postgres') {
      await this.connection.end();
    } else if (this.dialect === 'mysql') {
      await this.connection.end();
    } else if (this.dialect === 'oracle') {
      await this.connection.close();
    } else if (this.dialect === 'mssql') {
      await this.connection.close();
    }
    this.connection = null;
  }

  async listTables(): Promise<string[]> {
    if (!this.connection) throw new Error('Database not connected');

    if (this.dialect === 'postgres') {
      const query = `
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
          AND table_type = 'BASE TABLE'
        ORDER BY table_name;
      `;
      const res = await this.connection.query(query);
      return res.rows.map((row: any) => row.table_name);
    } else if (this.dialect === 'mysql') {
      const query = `
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = DATABASE() 
          AND table_type = 'BASE TABLE'
        ORDER BY table_name;
      `;
      const [rows] = await this.connection.query(query);
      return (rows as any[]).map((row: any) => row.table_name || row.TABLE_NAME);
    } else if (this.dialect === 'oracle') {
      const query = `
        SELECT table_name 
        FROM user_tables 
        ORDER BY table_name
      `;
      const res = await this.connection.execute(query);
      return res.rows.map((row: any) => row[0]);
    } else if (this.dialect === 'mssql') {
      const query = `
        SELECT TABLE_NAME 
        FROM INFORMATION_SCHEMA.TABLES 
        WHERE TABLE_TYPE = 'BASE TABLE'
        ORDER BY TABLE_NAME;
      `;
      const result = await this.connection.request().query(query);
      return result.recordset.map((row: any) => row.TABLE_NAME || row.table_name);
    }
    return [];
  }

  async getTableSchema(tableName: string): Promise<TableSchema> {
    if (!this.connection) throw new Error('Database not connected');
    const upperTableName = tableName.toUpperCase();

    const columns: ColumnMetadata[] = [];

    if (this.dialect === 'postgres') {
      const query = `
        SELECT 
            c.column_name as physical_column,
            CASE 
                WHEN c.character_maximum_length IS NOT NULL THEN c.data_type || '(' || c.character_maximum_length || ')'
                WHEN c.numeric_precision IS NOT NULL AND c.numeric_scale IS NOT NULL AND c.numeric_scale > 0 THEN c.data_type || '(' || c.numeric_precision || ',' || c.numeric_scale || ')'
                WHEN c.numeric_precision IS NOT NULL THEN c.data_type || '(' || c.numeric_precision || ')'
                ELSE c.data_type
            END as data_type,
            c.is_nullable = 'YES' as nullable,
            pg_catalog.col_description(pgc.oid, c.ordinal_position) as column_comment,
            COALESCE((
                SELECT COUNT(1) > 0 
                FROM information_schema.key_column_usage kcu
                JOIN information_schema.table_constraints tc 
                    ON kcu.constraint_name = tc.constraint_name 
                    AND kcu.table_schema = tc.table_schema
                WHERE tc.constraint_type = 'PRIMARY KEY'
                  AND kcu.table_name = c.table_name
                  AND kcu.column_name = c.column_name
            ), false) as is_primary_key
        FROM information_schema.columns c
        JOIN pg_catalog.pg_class pgc ON pgc.relname = c.table_name
        JOIN pg_catalog.pg_namespace pgn ON pgn.oid = pgc.relnamespace AND pgn.nspname = c.table_schema
        WHERE UPPER(c.table_name) = $1 
          AND c.table_schema = 'public'
        ORDER BY c.ordinal_position;
      `;
      const res = await this.connection.query(query, [upperTableName]);
      if (res.rows.length === 0) {
        throw new Error(`[ERROR] Missing Context: Schema for table '${tableName}' could not be resolved by MapSpring.`);
      }

      for (const row of res.rows) {
        const physicalColumn = row.physical_column;
        const dataType = row.data_type;
        const nullable = row.nullable;
        const comment = row.column_comment || '';
        const isPrimaryKey = row.is_primary_key;

        const fieldProperty = snakeToCamel(physicalColumn);
        const trans = translateType(dataType, nullable);

        columns.push({
          physicalColumn,
          dataType,
          nullable,
          fieldProperty,
          javaType: trans.javaType,
          comment,
          isPrimaryKey
        });
      }
    } else if (this.dialect === 'mysql') {
      const query = `
        SELECT 
            column_name as physical_column,
            column_type as data_type,
            is_nullable = 'YES' as nullable,
            column_comment,
            column_key = 'PRI' as is_primary_key
        FROM information_schema.columns
        WHERE UPPER(table_name) = ?
          AND table_schema = DATABASE()
        ORDER BY ordinal_position;
      `;
      const [rows] = await this.connection.query(query, [upperTableName]);
      const rowsArray = rows as any[];
      if (rowsArray.length === 0) {
        throw new Error(`[ERROR] Missing Context: Schema for table '${tableName}' could not be resolved by MapSpring.`);
      }

      for (const row of rowsArray) {
        const physicalColumn = row.physical_column || row.COLUMN_NAME;
        const dataType = row.data_type || row.COLUMN_TYPE;
        const nullable = row.nullable !== undefined ? row.nullable : (row.IS_NULLABLE === 'YES');
        const comment = row.column_comment || row.COLUMN_COMMENT || '';
        const isPrimaryKey = row.is_primary_key !== undefined ? row.is_primary_key : (row.COLUMN_KEY === 'PRI');

        const fieldProperty = snakeToCamel(physicalColumn);
        const trans = translateType(dataType, nullable);

        columns.push({
          physicalColumn,
          dataType,
          nullable,
          fieldProperty,
          javaType: trans.javaType,
          comment,
          isPrimaryKey
        });
      }
    } else if (this.dialect === 'oracle') {
      const query = `
        SELECT 
            col.column_name as physical_column,
            CASE 
                WHEN col.data_type IN ('VARCHAR', 'VARCHAR2', 'CHAR', 'NVARCHAR2') THEN col.data_type || '(' || col.data_length || ')'
                WHEN col.data_type = 'NUMBER' AND col.data_precision IS NOT NULL AND col.data_scale IS NOT NULL THEN col.data_type || '(' || col.data_precision || ',' || col.data_scale || ')'
                WHEN col.data_type = 'NUMBER' AND col.data_precision IS NOT NULL THEN col.data_type || '(' || col.data_precision || ')'
                ELSE col.data_type
            END as data_type,
            CASE WHEN col.nullable = 'Y' THEN 1 ELSE 0 END as nullable,
            comm.comments as column_comment,
            (
                SELECT COUNT(1)
                FROM user_constraints cons
                JOIN user_cons_columns cols ON cons.constraint_name = cols.constraint_name
                WHERE cons.constraint_type = 'P'
                  AND cons.table_name = col.table_name
                  AND cols.column_name = col.column_name
            ) as is_primary_key
        FROM user_tab_columns col
        LEFT JOIN user_col_comments comm 
            ON col.table_name = comm.table_name 
            AND col.column_name = comm.column_name
        WHERE col.table_name = :tableName
        ORDER BY col.column_id
      `;
      const res = await this.connection.execute(query, { tableName: upperTableName });
      if (res.rows.length === 0) {
        throw new Error(`[ERROR] Missing Context: Schema for table '${tableName}' could not be resolved by MapSpring.`);
      }

      for (const row of res.rows) {
        const physicalColumn = row[0];
        const dataType = row[1];
        const nullable = row[2] === 1;
        const comment = row[3] || '';
        const isPrimaryKey = row[4] > 0;

        const fieldProperty = snakeToCamel(physicalColumn);
        const trans = translateType(dataType, nullable);

        columns.push({
          physicalColumn,
          dataType,
          nullable,
          fieldProperty,
          javaType: trans.javaType,
          comment,
          isPrimaryKey
        });
      }
    } else if (this.dialect === 'mssql') {
      const query = `
        SELECT 
            c.name AS physical_column,
            t.name + CASE 
                WHEN t.name IN ('varchar', 'char', 'nvarchar', 'nchar') THEN '(' + CAST(c.max_length AS VARCHAR) + ')'
                WHEN t.name IN ('decimal', 'numeric') THEN '(' + CAST(c.precision AS VARCHAR) + ',' + CAST(c.scale AS VARCHAR) + ')'
                ELSE ''
            END AS data_type,
            c.is_nullable AS nullable,
            ep.value AS column_comment,
            CAST(CASE WHEN pk.column_id IS NOT NULL THEN 1 ELSE 0 END AS BIT) AS is_primary_key
        FROM sys.columns c
        JOIN sys.tables tbl ON c.object_id = tbl.object_id
        JOIN sys.types t ON c.user_type_id = t.user_type_id
        LEFT JOIN sys.extended_properties ep ON ep.major_id = c.object_id AND ep.minor_id = c.column_id AND ep.name = 'MS_Description'
        LEFT JOIN (
            SELECT ic.object_id, ic.column_id
            FROM sys.index_columns ic
            JOIN sys.indexes idx ON ic.object_id = idx.object_id AND ic.index_id = idx.index_id
            WHERE idx.is_primary_key = 1
        ) pk ON pk.object_id = c.object_id AND pk.column_id = c.column_id
        WHERE UPPER(tbl.name) = @tableName;
      `;
      const request = this.connection.request();
      request.input('tableName', upperTableName);
      const result = await request.query(query);
      const rows = result.recordset;

      if (rows.length === 0) {
        throw new Error(`[ERROR] Missing Context: Schema for table '${tableName}' could not be resolved by MapSpring.`);
      }

      for (const row of rows) {
        const physicalColumn = row.physical_column || row.PHYSICAL_COLUMN;
        const dataType = row.data_type || row.DATA_TYPE;
        const nullable = row.nullable !== undefined ? row.nullable : row.NULLABLE;
        const comment = row.column_comment || row.COLUMN_COMMENT || '';
        const isPrimaryKey = row.is_primary_key !== undefined ? !!row.is_primary_key : false;

        const fieldProperty = snakeToCamel(physicalColumn);
        const trans = translateType(dataType, nullable);

        columns.push({
          physicalColumn,
          dataType,
          nullable: !!nullable,
          fieldProperty,
          javaType: trans.javaType,
          comment,
          isPrimaryKey
        });
      }
    }

    return {
      tableName: upperTableName,
      source: `Active Database Connection (${this.dialect})`,
      columns
    };
  }
}
