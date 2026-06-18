import { getDatabaseDialect } from './online.js';

describe('Online Mode Dialect Detection', () => {
  it('should parse dialects correctly', () => {
    expect(getDatabaseDialect('postgresql://localhost:5432/mydb')).toBe('postgres');
    expect(getDatabaseDialect('postgres://user:pass@host/db')).toBe('postgres');
    expect(getDatabaseDialect('mysql://root@localhost:3306/db')).toBe('mysql');
    expect(getDatabaseDialect('mariadb://root@localhost:3306/db')).toBe('mysql');
    expect(getDatabaseDialect('oracle://user:pass@host:port/service')).toBe('oracle');
    expect(getDatabaseDialect('jdbc:oracle:thin:@host:port:sid')).toBe('oracle');
    expect(getDatabaseDialect('mssql://sa:password@localhost:1433/database')).toBe('mssql');
    expect(getDatabaseDialect('sqlserver://sa:password@localhost:1433/database')).toBe('mssql');
    expect(getDatabaseDialect('unknown_conn_string')).toBe('unknown');
  });
});
