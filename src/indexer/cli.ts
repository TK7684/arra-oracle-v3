/**
 * CLI entrypoint for running the Oracle indexer
 */

import fs from 'fs';
import path from 'path';
import { DB_PATH, LANCEDB_DIR } from '../config.ts';
import { getVaultPsiRoot } from '../vault/handler.ts';
import type { IndexerConfig } from '../types.ts';
import { OracleIndexer } from './index.ts';

// Prefer vault repo for centralized indexing, fall back to local psi/ detection
const scriptDir = import.meta.dirname || path.dirname(new URL(import.meta.url).pathname);
const projectRoot = path.resolve(scriptDir, '..', '..');

const vaultResult = getVaultPsiRoot();
const vaultRoot = 'path' in vaultResult ? vaultResult.path : null;

// Vault may have project-first layout (github.com/org/repo/psi/) without a root psi/
const vaultHasContent = vaultRoot && (
  fs.existsSync(path.join(vaultRoot, '\u03c8')) ||
  fs.existsSync(path.join(vaultRoot, 'github.com'))
);
const repoRoot = process.env.ORACLE_REPO_ROOT ||
  (vaultHasContent ? vaultRoot :
   fs.existsSync(path.join(projectRoot, '\u03c8')) ? projectRoot : process.cwd());

const config: IndexerConfig = {
  repoRoot,
  dbPath: DB_PATH,
  // BUG FIX 2026-04-24: was CHROMADB_DIR (~/.chromadb/) — server factory.ts:75
  // defaults LanceDB data path to LANCEDB_DIR (~/.arra-oracle-v2/lancedb/).
  // The mismatch meant indexer wrote vectors into a directory the server never
  // read, so every vector search returned 0 even when SQLite had 3,500+ docs.
  chromaPath: LANCEDB_DIR,
  sourcePaths: {
    resonance: '\u03c8/memory/resonance',
    learnings: '\u03c8/memory/learnings',
    retrospectives: '\u03c8/memory/retrospectives'
  }
};

const indexer = new OracleIndexer(config);

indexer.index()
  .then(async () => {
    console.log('Indexing complete!');
    await indexer.close();
  })
  .catch(async err => {
    console.error('Indexing failed:', err);
    await indexer.close();
    process.exit(1);
  });
