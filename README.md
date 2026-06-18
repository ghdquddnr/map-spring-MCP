# MapSpring MCP Server

MapSpring is a Model Context Protocol (MCP) server tailored for enterprise database schema exploration and seamless integration with the Spring Boot ecosystem (MyBatis, JPA). 

It operates via standard input/output (`stdio`), making it compatible with MCP hosts such as Claude Desktop, Cursor, and more.

---

## Key Features

* **Dual Execution Modes**:
  * **Online Connection Mode (`--url`)**: Connects directly to PostgreSQL, MySQL, MariaDB, Oracle, Tibero, and Microsoft SQL Server (MSSQL) to query system catalogs for real-time schemas.
  * **Offline DDL Mode (`--ddl-path`)**: Works in air-gapped (망분리) environments by parsing `.sql` and `.ddl` table definition files.
* **Code Generation Engine**:
  * **Name Conversion**: Converts physical Snake_Case names (`USER_ID`) to standard Java CamelCase (`userId`).
  * **MyBatis Harness**: Generates full MyBatis `<resultMap>` XML blocks and matching DTOs.
  * **JPA Harness**: Generates Spring Boot `@Entity` classes with validation annotations (`@NotNull`, `@Size`).
* **Zero Assumption Constraint**: Ensures zero hallucination by returning explicit errors when schema structures cannot be resolved.

---

## Installation & Setup

Ensure you have **Node.js (>= v18)** installed.

1. Clone the repository and install dependencies:
   ```bash
   git clone https://github.com/ghdquddnr/map-spring-MCP.git
   cd map-spring-MCP
   npm install
   ```
2. Build the project:
   ```bash
   npm run build
   ```

---

## MCP Host Configuration

To register MapSpring with your MCP client (e.g. Claude Desktop or Cursor), add the configuration below to your `mcp_config.json`:

### 1. Offline Mode (Air-gapped)
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

### 2. Online Mode
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

## Exposed MCP Tools

Once connected, MapSpring exposes the following tools:

### `list_tables`
Lists all tables available in either the active database schema or the offline DDL directory.

### `get_table_schema`
Resolves table properties and outputs a compact Markdown table.
* **Arguments**:
  * `table_name` (string, required): e.g., `TB_SETTLE_MASTER`.

### `generate_mybatis_mapper`
Generates MyBatis XML `<resultMap>` mappings and DTO source code.
* **Arguments**:
  * `table_name` (string, required)
  * `dto_package` (string, optional): Target package (defaults to `com.company.project.domain.dto`).

### `generate_jpa_entity`
Generates Spring Boot JPA Entity class code with database mapping and validation constraints.
* **Arguments**:
  * `table_name` (string, required)
  * `entity_package` (string, optional): Target package (defaults to `com.company.project.domain.entity`).

---

## License

This project is licensed under the MIT License.
