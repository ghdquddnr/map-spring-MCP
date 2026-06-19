#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { parseDDLDirectory } from './modes/offline.js';
import { DatabaseClient } from './modes/online.js';
import { TableSchema } from './types.js';
import {
  generateJavaDtoClass,
  generateJPAEntity,
  generateMyBatisResultMap
} from './utils/translator.js';

// Load environment variables from .env if present
dotenv.config();

let url = process.env.MAPSPRING_URL || process.env.DATABASE_URL || process.env.URL;
let ddlPath = process.env.MAPSPRING_DDL_PATH || process.env.DDL_PATH || process.env.DDL_DIR;

// Parse CLI arguments
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--url') {
    url = process.argv[++i];
  } else if (arg.startsWith('--url=')) {
    url = arg.substring(6);
  } else if (arg === '--ddl-path') {
    ddlPath = process.argv[++i];
  } else if (arg.startsWith('--ddl-path=')) {
    ddlPath = arg.substring(11);
  }
}

let mode: 'online' | 'offline' | 'unconfigured' = 'unconfigured';
let dbClient: DatabaseClient | null = null;
let cachedOfflineSchemas: TableSchema[] = [];

// Determine running mode
async function initializeMode() {
  if (url) {
    dbClient = new DatabaseClient(url);
    try {
      console.error(`[MapSpring] Connecting in Online Connection Mode to database...`);
      await dbClient.connect();
      mode = 'online';
      console.error(`[MapSpring] Successfully connected to database.`);
    } catch (err: any) {
      console.error(`[MapSpring] Online Connection failed: ${err.message}`);
      if (ddlPath) {
        console.error(`[MapSpring] Falling back to Offline DDL Mode using path: ${ddlPath}`);
        mode = 'offline';
        loadOfflineSchemas();
      } else {
        console.error(`[MapSpring] No fallback DDL path provided. Exiting.`);
        process.exit(1);
      }
    }
  } else if (ddlPath) {
    mode = 'offline';
    console.error(`[MapSpring] Running in Offline DDL Mode using path: ${ddlPath}`);
    loadOfflineSchemas();
  } else {
    // If nothing configured, default to current directory ddl folder if exists, or throw
    const defaultDdlPath = path.join(process.cwd(), 'ddl');
    if (fs.existsSync(defaultDdlPath)) {
      ddlPath = defaultDdlPath;
      mode = 'offline';
      console.error(`[MapSpring] No arguments provided. Defaulting to Offline DDL Mode at: ${ddlPath}`);
      loadOfflineSchemas();
    } else {
      console.error(`[MapSpring ERROR] MapSpring requires either '--url' or '--ddl-path' parameter to boot.`);
      process.exit(1);
    }
  }
}

function loadOfflineSchemas() {
  try {
    if (!ddlPath) return;
    cachedOfflineSchemas = parseDDLDirectory(ddlPath);
    console.error(`[MapSpring] Successfully loaded ${cachedOfflineSchemas.length} table schemas from DDL files.`);
  } catch (err: any) {
    console.error(`[MapSpring ERROR] Failed to load offline DDL files: ${err.message}`);
  }
}

// Helper to find schema for a table
async function resolveTableSchema(tableName: string): Promise<TableSchema> {
  const upperName = tableName.toUpperCase();
  if (mode === 'online' && dbClient) {
    try {
      return await dbClient.getTableSchema(upperName);
    } catch (err: any) {
      // If online schema resolution fails, try offline cache if available before failing
      if (ddlPath) {
        const found = cachedOfflineSchemas.find(s => s.tableName.toUpperCase() === upperName);
        if (found) return found;
      }
      throw err;
    }
  } else {
    // Offline resolution
    const found = cachedOfflineSchemas.find(s => s.tableName.toUpperCase() === upperName);
    if (found) return found;
    throw new Error(`[ERROR] Missing Context: Schema for table '${tableName}' could not be resolved by MapSpring.`);
  }
}

async function listAllTables(): Promise<string[]> {
  if (mode === 'online' && dbClient) {
    try {
      return await dbClient.listTables();
    } catch (err: any) {
      if (ddlPath) {
        return cachedOfflineSchemas.map(s => s.tableName);
      }
      throw err;
    }
  } else {
    return cachedOfflineSchemas.map(s => s.tableName);
  }
}

// Main MCP Server Setup
const server = new Server(
  {
    name: 'mapspring',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register list of tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'list_tables',
        description: 'List all database tables available in the currently configured data source. In online mode, queries the connected database directly. In offline mode, reads table names from parsed DDL files in the configured directory. Returns a JSON array of table name strings.',
        annotations: {
          title: 'List Tables',
          readOnlyHint: true,
          openWorldHint: false,
        },
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_table_schema',
        description: 'Retrieve the complete physical schema of a specific database table. Returns column names, data types, nullable constraints, Java field names (camelCase), and Korean business comments in a formatted Markdown table. Use this before generating code to understand the table structure.',
        annotations: {
          title: 'Get Table Schema',
          readOnlyHint: true,
          openWorldHint: false,
        },
        inputSchema: {
          type: 'object',
          properties: {
            table_name: {
              type: 'string',
              description: 'Physical name of the database table in uppercase (e.g., TB_SETTLE_MASTER, TB_USER_INFO, TB_ORDER_DETAIL). Use list_tables first if the exact name is unknown.',
            },
          },
          required: ['table_name'],
        },
      },
      {
        name: 'generate_mybatis_mapper',
        description: 'Generate ready-to-use MyBatis integration code for a database table. Produces two artifacts: (1) an XML ResultMap that maps columns to Java fields, and (2) a Java DTO class with camelCase field names and appropriate Java types. Output is based on the actual live schema — no manual mapping required.',
        annotations: {
          title: 'Generate MyBatis Mapper',
          readOnlyHint: true,
          openWorldHint: false,
        },
        inputSchema: {
          type: 'object',
          properties: {
            table_name: {
              type: 'string',
              description: 'Physical name of the database table to generate code for (e.g., TB_SETTLE_MASTER). The table must exist in the configured database or DDL directory.',
            },
            dto_package: {
              type: 'string',
              description: 'Java package path for the generated DTO class (e.g., com.example.settlement.domain.dto). If omitted, defaults to com.company.project.domain.dto.',
            },
          },
          required: ['table_name'],
        },
      },
      {
        name: 'generate_jpa_entity',
        description: 'Generate a Spring Data JPA Entity class for a database table. Includes @Entity, @Table, @Column, @Id, and @GeneratedValue annotations derived from the actual database schema. The generated class is compatible with Spring Boot and Hibernate. Column constraints (nullable, length) are reflected in the annotations.',
        annotations: {
          title: 'Generate JPA Entity',
          readOnlyHint: true,
          openWorldHint: false,
        },
        inputSchema: {
          type: 'object',
          properties: {
            table_name: {
              type: 'string',
              description: 'Physical name of the database table to generate the JPA Entity for (e.g., TB_USER_INFO). The table must exist in the configured database or DDL directory.',
            },
            entity_package: {
              type: 'string',
              description: 'Java package path for the generated Entity class (e.g., com.example.settlement.domain.entity). If omitted, defaults to com.company.project.domain.entity.',
            },
          },
          required: ['table_name'],
        },
      },
    ],
  };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === 'list_tables') {
      const tables = await listAllTables();
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(tables, null, 2),
          },
        ],
      };
    }

    if (name === 'get_table_schema') {
      const tableName = String(args?.table_name);
      if (!tableName) {
        throw new Error('Argument table_name is required.');
      }

      try {
        const schema = await resolveTableSchema(tableName);

        // Format Markdown output strictly as required by AGENT.md
        let markdown = `### [MapSpring Engine] Resolved Schema: ${schema.tableName}\n`;
        markdown += `* **Source:** ${schema.source}\n\n`;
        markdown += `| Physical Column | Data Type | Nullable | Field Property | Korean Comment |\n`;
        markdown += `| :--- | :--- | :--- | :--- | :--- |\n`;

        for (const col of schema.columns) {
          const nullableText = col.nullable ? 'YES' : 'NO';
          markdown += `| ${col.physicalColumn} | ${col.dataType} | ${nullableText} | ${col.fieldProperty} | ${col.comment} |\n`;
        }

        return {
          content: [
            {
              type: 'text',
              text: markdown,
            },
          ],
        };
      } catch (err: any) {
        // Strict anti-hallucination constraint error message
        if (err.message.includes('Missing Context')) {
          return {
            content: [
              {
                type: 'text',
                text: err.message,
              },
            ],
            isError: true
          };
        }
        throw err;
      }
    }

    if (name === 'generate_mybatis_mapper') {
      const tableName = String(args?.table_name);
      const dtoPackage = args?.dto_package ? String(args.dto_package) : 'com.company.project.domain.dto';
      if (!tableName) {
        throw new Error('Argument table_name is required.');
      }

      const schema = await resolveTableSchema(tableName);
      const xmlResultMap = generateMyBatisResultMap(schema, dtoPackage);
      const dtoClass = generateJavaDtoClass(schema, dtoPackage);

      let text = `### Generated MyBatis ResultMap\n\`\`\`xml\n${xmlResultMap}\n\`\`\`\n\n`;
      text += `### Generated MyBatis DTO Class\n\`\`\`java\n${dtoClass}\n\`\`\``;

      return {
        content: [
          {
            type: 'text',
            text,
          },
        ],
      };
    }

    if (name === 'generate_jpa_entity') {
      const tableName = String(args?.table_name);
      const entityPackage = args?.entity_package ? String(args.entity_package) : 'com.company.project.domain.entity';
      if (!tableName) {
        throw new Error('Argument table_name is required.');
      }

      const schema = await resolveTableSchema(tableName);
      const entityClass = generateJPAEntity(schema, entityPackage);

      let text = `### Generated JPA Entity Class\n\`\`\`java\n${entityClass}\n\`\`\``;

      return {
        content: [
          {
            type: 'text',
            text,
          },
        ],
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (err: any) {
    return {
      content: [
        {
          type: 'text',
          text: `[ERROR] ${err.message}`,
        },
      ],
      isError: true,
    };
  }
});

// Run the server
async function main() {
  await initializeMode();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[MapSpring] MCP Server running on Stdio transport');
}

main().catch((err) => {
  console.error('[MapSpring] Fatal startup error:', err);
  process.exit(1);
});
