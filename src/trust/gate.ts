/**
 * Oracle P0 Trust Gate
 *
 * Upstream-of-render sender gate. All ingress must pass through checkSender()
 * before content is included in the tool response. Unapproved senders get
 * diverted to ψ/quarantine/ — their content is NEVER returned in the MCP response.
 *
 * Design: name-based MVP. Full SHA+hostname binding requires signed handoff
 * frontmatter and DB schema change — deferred post-MVP.
 *
 * Fail closed: missing allowlist → all senders quarantined.
 */

import fs from 'fs';
import path from 'path';

export type GateDecision =
  | { allowed: true; identityId: string; identityName: string }
  | { allowed: false; reason: GateReason };

export type GateReason =
  | 'allowlist-missing'
  | 'schema-version-mismatch'
  | 'allowlist-miss'
  | 'empty-sender';

export interface Identity {
  id: string;
  name: string;
  claude_md_sha: string;
  hostname: string;
  paired_at: string;
  scope: string;
  trust_level: string;
  notes?: string;
  expiry?: string;
  trusted_names?: string[];
  trusted_patterns?: string[];
  metadata?: {
    last_seen?: string;
    message_count?: number;
    key_fingerprint?: string | null;
  };
}

export interface Allowlist {
  schema_version: string;
  identities: Identity[];
  metadata?: unknown;
}

const EXPECTED_SCHEMA = '1.0.0';

function allowlistPath(): string {
  return process.env.ORACLE_ALLOWLIST
    ?? path.join(process.env.HOME || '/root', 'luna-oracle/ψ/allowlist.json');
}

function quarantineDir(): string {
  return process.env.ORACLE_QUARANTINE
    ?? path.join(process.env.HOME || '/root', 'luna-oracle/ψ/quarantine');
}

function loadAllowlist(): Allowlist | null {
  const p = allowlistPath();
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as Allowlist;
  } catch {
    return null;
  }
}

/**
 * Decide whether a sender's message should be rendered or quarantined.
 * Normalizes sender to lowercase for match; checks against each identity's
 * `trusted_names` array. Exact-match only — no fuzzy/partial matching.
 */
export function checkSender(senderName: string | null | undefined): GateDecision {
  const allowlist = loadAllowlist();
  if (!allowlist) return { allowed: false, reason: 'allowlist-missing' };
  if (allowlist.schema_version !== EXPECTED_SCHEMA) {
    return { allowed: false, reason: 'schema-version-mismatch' };
  }

  const raw = (senderName || '').trim();
  if (!raw) return { allowed: false, reason: 'empty-sender' };

  // Normalize: strip parenthetical suffix ("luna (session x)" → "luna"),
  // strip trailing " session X" / " end of session" style metadata, lowercase.
  const normalized = raw
    .replace(/\s*\(.*?\)\s*$/, '')
    .replace(/\s+(session|end\s+of\s+session|this\s+session|evening\s+session).*$/i, '')
    .trim()
    .toLowerCase();
  if (!normalized) return { allowed: false, reason: 'empty-sender' };

  // Check expiry for provisional entries
  const now = new Date();
  for (const id of allowlist.identities) {
    if (id.trust_level === 'provisional' && id.expiry) {
      if (new Date(id.expiry) < now) continue;
    }
    const names = (id.trusted_names || []).map(n => n.toLowerCase());
    if (names.includes(normalized)) {
      return { allowed: true, identityId: id.id, identityName: id.name };
    }
    for (const pat of (id.trusted_patterns || [])) {
      try {
        if (new RegExp(pat).test(normalized)) {
          return { allowed: true, identityId: id.id, identityName: id.name };
        }
      } catch { /* malformed regex in allowlist, skip */ }
    }
  }

  return { allowed: false, reason: 'allowlist-miss' };
}

/**
 * Write a quarantine entry. Returns the path written, for logging.
 */
export function quarantine(opts: {
  gateSite: string;
  sourceChannel: string;
  senderName: string | null | undefined;
  reason: GateReason;
  rawPayload: string;
}): string {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const tsFile = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const nowIso = now.toISOString();

  const dir = path.join(quarantineDir(), day);
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ok */ }

  const filename = `${tsFile}-${opts.gateSite}-${opts.reason}.json`;
  const outPath = path.join(dir, filename);

  const entry = {
    received_at: nowIso,
    original_sender: { name: opts.senderName || null },
    source_channel: opts.sourceChannel,
    gate_site: opts.gateSite,
    divert_reason: opts.reason,
    raw_message_base64: Buffer.from(opts.rawPayload, 'utf-8').toString('base64'),
  };

  try { fs.writeFileSync(outPath, JSON.stringify(entry, null, 2)); } catch { /* ok */ }
  console.error(`[TRUST-GATE] quarantined (${opts.reason}) at ${outPath} — sender=${opts.senderName}`);
  return outPath;
}

/**
 * Filter an array of items through the gate. Items whose extracted sender
 * is not allowed are removed from the output AND written to quarantine.
 * Returns { allowed, quarantined } counts for callers to surface in their
 * response metadata.
 */
export function filterBySender<T>(items: T[], opts: {
  gateSite: string;
  sourceChannel: string;
  extractSender: (item: T) => string | null | undefined;
  serializeForQuarantine: (item: T) => string;
  /**
   * When true, items with no identifiable sender (null/empty) are allowed
   * through without quarantine. Use for local-filesystem ingress (e.g.
   * ψ/inbox/handoff/) where lack of a sender indicates a legacy locally-
   * authored file rather than an external injection attempt. Threat model:
   * anyone with write access to the filesystem already bypasses the gate
   * entirely, so treating null-sender as local-trust does not weaken it.
   */
  trustNullSender?: boolean;
}): { allowed: T[]; quarantinedCount: number } {
  const out: T[] = [];
  let qCount = 0;
  for (const item of items) {
    const sender = opts.extractSender(item);
    if (opts.trustNullSender && !(sender && String(sender).trim())) {
      out.push(item);
      continue;
    }
    const decision = checkSender(sender);
    if (decision.allowed) {
      out.push(item);
    } else {
      quarantine({
        gateSite: opts.gateSite,
        sourceChannel: opts.sourceChannel,
        senderName: sender,
        reason: decision.reason,
        rawPayload: opts.serializeForQuarantine(item),
      });
      qCount++;
    }
  }
  return { allowed: out, quarantinedCount: qCount };
}

/**
 * Parse a handoff filename like `20260420_212100_three-new-projects-bootstrap_from_tabby.md`
 * and return the `_from_<name>` segment, or null if the pattern isn't present.
 */
export function parseHandoffSender(filename: string): string | null {
  const m = filename.match(/_from_([a-zA-Z0-9-_]+)(?:\.md)?$/);
  return m ? m[1] : null;
}

/**
 * Extract sender from a handoff file. Preference order:
 * 1. YAML frontmatter `from:` field (most reliable)
 * 2. Filename `_from_<name>` suffix (Discord-routed messages)
 * 3. null (no identifiable sender → gate will quarantine)
 */
export function extractHandoffSender(filename: string, content: string): string | null {
  // Frontmatter: between first two `---\n` markers (YAML block scalar)
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const fromMatch = fmMatch[1].match(/^from:\s*["']?([^"'\n]+?)["']?\s*$/m);
    if (fromMatch) return fromMatch[1].trim();
  }
  return parseHandoffSender(filename);
}
