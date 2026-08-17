// consumer.mjs — the fields a prreview engine adapter would rely on, extracted
// from a spawned CLI (real `claude` or fake-claude). Prints a normalized digest.
// Usage: node consumer.mjs <binary> [args...]
import { spawn } from 'node:child_process';

const [bin, ...args] = process.argv.slice(2);
const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });

let buf = '';
const digest = {
  eventTypes: [],          // stable sequence, volatile system noise collapsed
  sessionIdConsistent: null,
  initSeen: false,
  assistantMessageShape: null,
  toolUses: [],            // {name, inputKeys}
  toolResultsSeen: 0,
  result: null,            // stable subset of the result envelope
  exitCode: null,
};
const sessionIds = new Set();

child.stdout.on('data', (d) => {
  buf += d;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
    if (!line.trim()) continue;
    const o = JSON.parse(line); // adapter assumption: every line is JSON
    if (o.session_id) sessionIds.add(o.session_id);
    // collapse environment-dependent noise the adapter must ignore anyway
    const noise = o.type === 'system' && ['hook_started', 'hook_response', 'thinking_tokens', 'status'].includes(o.subtype);
    if (o.type === 'rate_limit_event' || noise) continue;
    digest.eventTypes.push(o.type + (o.subtype ? ':' + o.subtype : ''));
    if (o.type === 'system' && o.subtype === 'init') digest.initSeen = true;
    if (o.type === 'assistant' && !digest.assistantMessageShape) {
      digest.assistantMessageShape = {
        outerKeys: ['type', 'message', 'session_id'].filter((k) => k in o),
        role: o.message.role,
        contentIsArray: Array.isArray(o.message.content),
      };
    }
    if (o.type === 'assistant') {
      for (const b of o.message.content) {
        if (b.type === 'tool_use') digest.toolUses.push({ name: b.name, inputKeys: Object.keys(b.input).sort() });
      }
    }
    if (o.type === 'user') {
      for (const b of o.message.content ?? []) if (b.type === 'tool_result') digest.toolResultsSeen++;
    }
    if (o.type === 'result') {
      digest.result = {
        subtype: o.subtype,
        is_error: o.is_error,
        hasResultText: typeof o.result === 'string',
        structured_output: o.structured_output ?? null,
        hasSessionId: typeof o.session_id === 'string',
        hasCost: typeof o.total_cost_usd === 'number',
        hasUsage: typeof o.usage === 'object',
        num_turns_is_number: typeof o.num_turns === 'number',
      };
    }
  }
});

child.on('close', (code) => {
  digest.sessionIdConsistent = sessionIds.size === 1;
  digest.exitCode = code;
  console.log(JSON.stringify(digest, null, 1));
});
