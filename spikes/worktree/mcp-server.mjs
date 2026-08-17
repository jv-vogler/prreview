// Minimal MCP stdio server: one tool, get_secret, returning a version-stamped
// secret. Enough protocol (initialize / tools/list / tools/call) to prove the
// CLI spawned THIS file from THIS checkout.
const SECRET = 'WORKTREE-MCP-99-vB';

import { createInterface } from 'node:readline';

const rl = createInterface({ input: process.stdin });
const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');

rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const { id, method } = msg;
  if (method === 'initialize') {
    send({ jsonrpc: '2.0', id, result: {
      protocolVersion: msg.params.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: 'spikesecret', version: '1.0.0' },
    }});
  } else if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools: [{
      name: 'get_secret',
      description: 'Returns the spike secret string.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    }]}});
  } else if (method === 'tools/call') {
    send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: SECRET }] } });
  } else if (id !== undefined) {
    send({ jsonrpc: '2.0', id, result: {} });
  }
});
