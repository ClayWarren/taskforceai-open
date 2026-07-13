#!/usr/bin/env node

import fs from 'node:fs';
import readline from 'node:readline';

const startupCounterPath = process.env.TASKFORCEAI_DESKTOP_MCP_FIXTURE_STARTUP_COUNT;
if (startupCounterPath) {
  fs.appendFileSync(startupCounterPath, `${process.pid}\n`);
}

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

const write = (message) => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};

rl.on('line', (line) => {
  if (!line.trim()) {
    return;
  }

  let request;
  try {
    request = JSON.parse(line);
  } catch {
    write({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error' },
    });
    return;
  }

  if (request.id === undefined || request.id === null) {
    return;
  }

  switch (request.method) {
    case 'initialize':
      write({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: {
            name: 'taskforceai-desktop-test-mcp',
            title: 'TaskForceAI Desktop Test MCP',
            version: '1.0.0',
          },
          instructions: 'Local fixture server for desktop MCP tests.',
        },
      });
      break;
    case 'tools/list':
      write({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          tools: [
            {
              name: 'echo',
              title: 'Echo',
              description: 'Returns a deterministic fixture response.',
              inputSchema: {
                type: 'object',
                additionalProperties: true,
              },
            },
          ],
        },
      });
      break;
    case 'tools/call':
      write({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          content: [{ type: 'text', text: 'fixture-ok' }],
          isError: false,
        },
      });
      break;
    default:
      write({
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32601, message: `Unsupported method: ${request.method}` },
      });
      break;
  }
});
