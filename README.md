# MapSpring MCP 서버

MapSpring은 엔터프라이즈 데이터베이스 스키마 탐색 및 Spring Boot 에코시스템(MyBatis, JPA) 연동에 특화된 Model Context Protocol (MCP) 서버입니다. 

표준 입출력(`stdio`)을 통해 동작하므로, Claude Desktop이나 Cursor 등의 MCP 호스트 환경에서 손쉽게 연동하여 사용할 수 있습니다.

---

## 주요 기능

* **이중 실행 모드 (Dual Execution Modes)**:
  * **Online 연결 모드 (`--url`)**: PostgreSQL, MySQL, MariaDB, Oracle, Tibero, Microsoft SQL Server (MSSQL)에 직접 연결하여 실시간 스키마 카탈로그 정보를 쿼리합니다.
  * **Offline DDL 모드 (`--ddl-path`)**: 외부 DB 접근이 차단된 **망분리 환경** 등에서 로컬 `.sql` 또는 `.ddl` 테이블 정의서를 직접 파싱해 메타데이터를 추출합니다.
* **코드 생성 엔진 (Code Generation Engine)**:
  * **네이밍 변환**: 데이터베이스 물리 칼럼명(Snake_Case, 예: `USER_ID`)을 Java 표준 카멜케이스(CamelCase, 예: `userId`)로 자동 변환합니다. `TB_` 또는 `V_`와 같은 접두사는 자동으로 제거되어 클래스 이름이 생성됩니다.
  * **MyBatis 지원**: XML `<resultMap>` 맵핑 블록과 전용 DTO 클래스 코드를 한 번에 생성합니다.
  * **JPA 지원**: 표준 JPA 어노테이션 및 유효성 검증 어노테이션(`@NotNull`, `@Size`)이 적용된 `@Entity` 클래스 코드를 빌드합니다.
* **Zero Assumption 제약 (Anti-Hallucination)**: 데이터 구조를 임의로 추측(Hallucination)하지 않으며, 스키마 정의가 발견되지 않을 경우 엄격하게 에러 메세지를 반환합니다.

---

## 설치 및 빌드 방법

**Node.js (>= v18)** 환경이 필요합니다.

1. 저장소를 복사하고 의존성을 설치합니다:
   ```bash
   git clone https://github.com/ghdquddnr/map-spring-MCP.git
   cd map-spring-MCP
   npm install
   ```
2. 프로젝트를 빌드합니다:
   ```bash
   npm run build
   ```

---

## MCP 호스트 환경 설정

Claude Desktop 또는 Cursor 등의 MCP 설정 파일(`mcp_config.json`)에 아래와 같이 MapSpring을 등록하여 사용합니다:

### 1. Offline 모드 (망분리 환경)
```json
{
  "mcpServers": {
    "mapspring": {
      "command": "node",
      "args": [
        "/absolute/path/to/map-spring-MCP/dist/index.js",
        "--ddl-path",
        "/absolute/path/to/your/ddl/folder"
      ]
    }
  }
}
```

### 2. Online 연결 모드
```json
{
  "mcpServers": {
    "mapspring": {
      "command": "node",
      "args": [
        "/absolute/path/to/map-spring-MCP/dist/index.js",
        "--url",
        "postgresql://username:password@localhost:5432/db"
      ]
    }
  }
}
```

---

## 제공되는 MCP 도구 (Tools)

연결이 완료되면 MapSpring은 다음과 같은 도구들을 제공합니다:

### `list_tables`
활성화된 데이터베이스 또는 지정된 DDL 디렉토리에 존재하는 테이블 목록을 조회합니다.

### `get_table_schema`
테이블의 구조와 코멘트 정보를 정교한 Markdown 테이블 형식으로 반환합니다.
* **파라미터**:
  * `table_name` (string, 필수): 조회할 테이블의 물리 명칭 (예: `TB_SETTLE_MASTER`).

### `generate_mybatis_mapper`
테이블에 대응하는 MyBatis XML `<resultMap>` 매핑 블록과 DTO 클래스 소스코드를 생성합니다.
* **파라미터**:
  * `table_name` (string, 필수)
  * `dto_package` (string, 선택): 생성될 DTO의 패키지명 (기본값: `com.company.project.domain.dto`).

### `generate_jpa_entity`
JPA 매핑 선언 및 유효성 어노테이션이 완벽하게 구성된 Spring Boot JPA Entity 클래스 소스코드를 생성합니다.
* **파라미터**:
  * `table_name` (string, 필수)
  * `entity_package` (string, 선택): 생성될 Entity의 패키지명 (기본값: `com.company.project.domain.entity`).

---

## 라이선스

이 프로젝트는 MIT 라이선스 하에 배포됩니다.
