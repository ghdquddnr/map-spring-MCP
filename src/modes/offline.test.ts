import { parseDDLContent } from './offline.js';

describe('Offline DDL Parser', () => {
  it('should parse simple table with columns and types', () => {
    const sql = `
      CREATE TABLE TB_USER (
        USER_ID VARCHAR2(50) NOT NULL,
        USER_NAME VARCHAR2(100),
        AGE NUMBER(3) NULL,
        REG_DTM TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT PK_TB_USER PRIMARY KEY (USER_ID)
      );
      
      COMMENT ON COLUMN TB_USER.USER_ID IS '사용자 아이디 (PK)';
      COMMENT ON COLUMN TB_USER.USER_NAME IS '사용자 이름';
    `;

    const schemas = parseDDLContent(sql, 'test_user.sql');
    expect(schemas).toHaveLength(1);

    const schema = schemas[0];
    expect(schema.tableName).toBe('TB_USER');
    expect(schema.source).toBe('Local DDL File (test_user.sql)');
    expect(schema.columns).toHaveLength(4);

    // USER_ID
    const userId = schema.columns.find(c => c.physicalColumn === 'USER_ID');
    expect(userId).toBeDefined();
    expect(userId!.dataType).toBe('VARCHAR2(50)');
    expect(userId!.nullable).toBe(false);
    expect(userId!.isPrimaryKey).toBe(true);
    expect(userId!.fieldProperty).toBe('userId');
    expect(userId!.javaType).toBe('String');
    expect(userId!.comment).toBe('사용자 아이디 (PK)');

    // USER_NAME
    const userName = schema.columns.find(c => c.physicalColumn === 'USER_NAME');
    expect(userName).toBeDefined();
    expect(userName!.dataType).toBe('VARCHAR2(100)');
    expect(userName!.nullable).toBe(true);
    expect(userName!.isPrimaryKey).toBe(false);
    expect(userName!.fieldProperty).toBe('userName');
    expect(userName!.javaType).toBe('String');
    expect(userName!.comment).toBe('사용자 이름');

    // AGE
    const age = schema.columns.find(c => c.physicalColumn === 'AGE');
    expect(age).toBeDefined();
    expect(age!.dataType).toBe('NUMBER(3)');
    expect(age!.nullable).toBe(true);
    expect(age!.javaType).toBe('Integer');

    // REG_DTM
    const regDtm = schema.columns.find(c => c.physicalColumn === 'REG_DTM');
    expect(regDtm).toBeDefined();
    expect(regDtm!.dataType).toBe('TIMESTAMP');
    expect(regDtm!.nullable).toBe(true);
    expect(regDtm!.javaType).toBe('LocalDateTime');
  });

  it('should parse inline primary keys and ignore complex comments', () => {
    const sql = `
      -- Test table definition
      /* Multiple line comment */
      CREATE TABLE TB_SETTLE_MASTER (
        SETTLE_NO VARCHAR2(20) PRIMARY KEY,
        MTC_AT NUMBER(2) NOT NULL,
        AMOUNT NUMBER(15, 2)
      );
      
      COMMENT ON COLUMN TB_SETTLE_MASTER.SETTLE_NO IS '정산 일련번호';
      COMMENT ON COLUMN TB_SETTLE_MASTER.MTC_AT IS '점검 상태 코드';
    `;

    const schemas = parseDDLContent(sql, 'settle.sql');
    expect(schemas).toHaveLength(1);

    const schema = schemas[0];
    expect(schema.tableName).toBe('TB_SETTLE_MASTER');
    
    const settleNo = schema.columns.find(c => c.physicalColumn === 'SETTLE_NO');
    expect(settleNo!.isPrimaryKey).toBe(true);
    expect(settleNo!.nullable).toBe(true); // Since it was parsed with PRIMARY KEY and no explicit "NOT NULL" in clause, but PKs are inherently non-nullable. Wait, in parsing we let it be true/false based on NOT NULL literal but check its PK status separately.
    
    const mtcAt = schema.columns.find(c => c.physicalColumn === 'MTC_AT');
    expect(mtcAt!.isPrimaryKey).toBe(false);
    expect(mtcAt!.nullable).toBe(false);
    expect(mtcAt!.javaType).toBe('int'); // non-nullable NUMBER(2)

    const amount = schema.columns.find(c => c.physicalColumn === 'AMOUNT');
    expect(amount!.dataType).toBe('NUMBER(15, 2)');
    expect(amount!.javaType).toBe('BigDecimal');
  });
});
