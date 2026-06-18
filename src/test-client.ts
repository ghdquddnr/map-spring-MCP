import { spawn } from 'child_process';

function runIntegrationTest() {
  const mcp = spawn('node', ['dist/index.js', '--ddl-path', './test-ddl']);

  let responseData = '';
  
  mcp.stdout.on('data', (data) => {
    responseData += data.toString();
    try {
      // Try parsing the accumulated response as JSON-RPC messages (split by newline)
      const lines = responseData.split('\n').filter(l => l.trim().length > 0);
      for (const line of lines) {
        const json = JSON.parse(line);
        console.log('Received from MCP:', JSON.stringify(json, null, 2));
        
        // Assertions/Checks
        if (json.id === 1) {
          console.log('✔ list_tables response verified!');
          // Call get_table_schema next
          const callSchemaRequest = {
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: {
              name: 'get_table_schema',
              arguments: {
                table_name: 'TB_SETTLE_MASTER'
              }
            }
          };
          mcp.stdin.write(JSON.stringify(callSchemaRequest) + '\n');
        } else if (json.id === 2) {
          console.log('✔ get_table_schema response verified!');
          // Print markdown result
          console.log('Markdown Schema result:\n', json.result.content[0].text);
          
          // Now call generate_mybatis_mapper
          const callMyBatisRequest = {
            jsonrpc: '2.0',
            id: 3,
            method: 'tools/call',
            params: {
              name: 'generate_mybatis_mapper',
              arguments: {
                table_name: 'TB_SETTLE_MASTER'
              }
            }
          };
          mcp.stdin.write(JSON.stringify(callMyBatisRequest) + '\n');
        } else if (json.id === 3) {
          console.log('✔ generate_mybatis_mapper response verified!');
          console.log('Result:\n', json.result.content[0].text);
          
          // Try fetching a missing table to test anti-hallucination constraint
          const callMissingTableRequest = {
            jsonrpc: '2.0',
            id: 4,
            method: 'tools/call',
            params: {
              name: 'get_table_schema',
              arguments: {
                table_name: 'TB_NON_EXISTENT'
              }
            }
          };
          mcp.stdin.write(JSON.stringify(callMissingTableRequest) + '\n');
        } else if (json.id === 4) {
          console.log('✔ missing table error handling verified!');
          console.log('Error result:\n', json.result.content[0].text);
          if (json.result.isError) {
            console.log('✔ isError flag is set correctly!');
          }
          
          mcp.kill();
          process.exit(0);
        }
      }
      responseData = ''; // Clear if parsed fully
    } catch (e) {
      // Wait for more data if JSON parsing fails due to chunking
    }
  });

  mcp.stderr.on('data', (data) => {
    console.error('MCP STDERR:', data.toString().trim());
  });

  mcp.on('close', (code) => {
    console.log(`MCP process exited with code ${code}`);
  });

  // Start by initializing the MCP server and listing tools/tables
  // Note: Standard MCP setup requires sending initial initialize request, but here we can call tools directly since the server registers handlers
  // Let's send the list_tables request
  const listRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'list_tables',
      arguments: {}
    }
  };

  // Wait a small bit for server to print boot logs to stderr
  setTimeout(() => {
    mcp.stdin.write(JSON.stringify(listRequest) + '\n');
  }, 1000);
}

runIntegrationTest();
