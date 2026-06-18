import pg from 'pg';
import { DatabaseClient } from './modes/online.js';

const connectionString = 'postgresql://postgres:postgres@localhost:54321/testdb';

async function runDbTest() {
  console.log('Connecting to PostgreSQL database container...');
  const client = new pg.Client({ connectionString });
  
  try {
    await client.connect();
    console.log('Connected. Initializing test database tables...');

    // Drop existing table if it exists
    await client.query('DROP TABLE IF EXISTS TB_SETTLE_MASTER;');

    // Create table
    await client.query(`
      CREATE TABLE TB_SETTLE_MASTER (
          SETTLE_NO VARCHAR(20) NOT NULL,
          MTC_AT INT,
          AMOUNT DECIMAL(15, 2),
          REG_DTM TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (SETTLE_NO)
      );
    `);
    console.log('Table TB_SETTLE_MASTER created.');

    // Add comments
    await client.query("COMMENT ON TABLE TB_SETTLE_MASTER IS '정산 마스터 테이블';");
    await client.query("COMMENT ON COLUMN TB_SETTLE_MASTER.SETTLE_NO IS '정산 일련번호 (PK)';");
    await client.query("COMMENT ON COLUMN TB_SETTLE_MASTER.MTC_AT IS '점검 상태 코드';");
    await client.query("COMMENT ON COLUMN TB_SETTLE_MASTER.AMOUNT IS '정산 금액';");
    console.log('Table comments set.');

    await client.end();
    console.log('DDL execution completed successfully. Starting DatabaseClient test...\n');

    // Run MapSpring DatabaseClient test
    const dbClient = new DatabaseClient(connectionString);
    await dbClient.connect();

    console.log('Listing tables:');
    const tables = await dbClient.listTables();
    console.log('Tables found:', tables);
    if (!tables.includes('tb_settle_master') && !tables.includes('TB_SETTLE_MASTER')) {
      throw new Error('TB_SETTLE_MASTER was not found in database tables!');
    }

    console.log('\nFetching schema for TB_SETTLE_MASTER:');
    const schema = await dbClient.getTableSchema('TB_SETTLE_MASTER');
    console.log('Resolved Schema details:');
    console.log(`Table Name: ${schema.tableName}`);
    console.log(`Source: ${schema.source}`);
    console.log('Columns:');
    console.table(schema.columns);

    // Validate the columns
    const settleNo = schema.columns.find(c => c.physicalColumn.toUpperCase() === 'SETTLE_NO');
    if (!settleNo) throw new Error('SETTLE_NO column not found!');
    if (settleNo.nullable !== false) throw new Error('SETTLE_NO nullable check failed!');
    if (settleNo.isPrimaryKey !== true) throw new Error('SETTLE_NO primary key check failed!');
    if (settleNo.comment !== '정산 일련번호 (PK)') throw new Error('SETTLE_NO comment check failed!');
    if (settleNo.javaType !== 'String') throw new Error(`SETTLE_NO javaType check failed: ${settleNo.javaType}`);

    const mtcAt = schema.columns.find(c => c.physicalColumn.toUpperCase() === 'MTC_AT');
    if (!mtcAt) throw new Error('MTC_AT column not found!');
    if (mtcAt.nullable !== true) throw new Error('MTC_AT nullable check failed!');
    if (mtcAt.comment !== '점검 상태 코드') throw new Error('MTC_AT comment check failed!');
    // since MTC_AT is INT and nullable, it should map to Integer wrapper
    if (mtcAt.javaType !== 'Integer') throw new Error(`MTC_AT javaType check failed: ${mtcAt.javaType}`);

    const amount = schema.columns.find(c => c.physicalColumn.toUpperCase() === 'AMOUNT');
    if (!amount) throw new Error('AMOUNT column not found!');
    if (amount.javaType !== 'BigDecimal') throw new Error(`AMOUNT javaType check failed: ${amount.javaType}`);
    if (amount.comment !== '정산 금액') throw new Error('AMOUNT comment check failed!');

    console.log('\n✔ Database Client test PASSED successfully!');
    await dbClient.disconnect();
    process.exit(0);

  } catch (err: any) {
    console.error('Test failed with error:', err.message);
    try {
      await client.end();
    } catch {}
    process.exit(1);
  }
}

// Wait for database container to boot up
console.log('Waiting 5 seconds for Postgres container to boot up...');
setTimeout(runDbTest, 5000);
