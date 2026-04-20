/**
 * Oracle Inbox Handler
 *
 * List and preview pending handoff files from the Oracle inbox.
 */

import path from 'path';
import fs from 'fs';
import type { ToolContext, ToolResponse, OracleInboxInput } from './types.ts';
import { filterBySender, extractHandoffSender } from '../trust/gate.ts';

export const inboxToolDef = {
  name: 'arra_inbox',
  description: 'List and preview pending handoff files from the Oracle inbox. Returns files sorted newest-first with previews.',
  inputSchema: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Maximum files to return (default: 10)',
        default: 10
      },
      offset: {
        type: 'number',
        description: 'Number of files to skip (for pagination)',
        default: 0
      },
      type: {
        type: 'string',
        enum: ['handoff', 'all'],
        description: 'Filter by inbox type (default: all)',
        default: 'all'
      }
    }
  }
};

export async function handleInbox(ctx: ToolContext, input: OracleInboxInput): Promise<ToolResponse> {
  const { limit = 10, offset = 0, type = 'all' } = input;
  const inboxDir = path.join(ctx.repoRoot, 'ψ/inbox');
  const results: Array<{ filename: string; path: string; created: string; preview: string; type: string; _sender: string | null }> = [];

  if (type === 'all' || type === 'handoff') {
    const handoffDir = path.join(inboxDir, 'handoff');
    if (fs.existsSync(handoffDir)) {
      const files = fs.readdirSync(handoffDir)
        .filter(f => f.endsWith('.md'))
        .sort()
        .reverse();

      for (const file of files) {
        const filePath = path.join(handoffDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const dateMatch = file.match(/^(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2})/);
        const created = dateMatch
          ? `${dateMatch[1]}T${dateMatch[2].replace('-', ':')}:00`
          : 'unknown';

        results.push({
          filename: file,
          path: `ψ/inbox/handoff/${file}`,
          created,
          preview: content.substring(0, 500),
          type: 'handoff',
          _sender: extractHandoffSender(file, content),
        });
      }
    }
  }

  // Trust gate — upstream of render. Files whose extracted sender is not in
  // the allowlist go to quarantine; their content is NOT returned.
  const gated = filterBySender(results, {
    gateSite: 'arra_inbox',
    sourceChannel: 'inbox/handoff',
    extractSender: (r) => r._sender,
    serializeForQuarantine: (r) => JSON.stringify(r),
    // Local filesystem: files without a sender are legacy Oracle-authored
    // handoffs, not external injection. Filesystem write-access is outside
    // our threat model.
    trustNullSender: true,
  });

  // Strip the internal _sender field before returning to the MCP client.
  gated.allowed.forEach((r: any) => delete r._sender);

  const total = gated.allowed.length;
  const paginated = gated.allowed.slice(offset, offset + limit);

  console.error(`[MCP:INBOX] ${total} files allowed, ${gated.quarantinedCount} quarantined, returning ${paginated.length} (offset=${offset})`);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        files: paginated,
        total,
        limit,
        offset,
        quarantined: gated.quarantinedCount,
      }, null, 2)
    }]
  };
}
