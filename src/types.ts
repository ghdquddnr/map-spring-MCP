export interface ColumnMetadata {
  physicalColumn: string;    // Database physical column name (e.g. SETTLE_NO)
  dataType: string;          // Database physical data type (e.g. VARCHAR2(20))
  nullable: boolean;         // Nullability constraint
  fieldProperty: string;     // Target Java CamelCase property name (e.g. settleNo)
  javaType: string;          // Mapped target Java class type (e.g. String)
  comment: string;           // Korean comment metadata
  isPrimaryKey: boolean;     // Primary key status
}

export interface TableSchema {
  tableName: string;
  source: string;            // Description of metadata source (e.g. Local DDL or DB URL)
  columns: ColumnMetadata[];
}
