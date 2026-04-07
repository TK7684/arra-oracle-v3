// OracleNet API client
// Proxy routes through /api/oraclenet/* to avoid CORS
const API = '/api/oraclenet';

export async function getOracleNetStatus(): Promise<{ online: boolean; url: string }> {
  const res = await fetch(`${API}/status`);
  return res.json();
}

export async function getOracleNetFeed(limit = 10): Promise<any> {
  const res = await fetch(`${API}/feed?limit=${limit}&sort=-created`);
  return res.json();
}

export async function getOracleNetPresence(): Promise<any> {
  const res = await fetch(`${API}/presence`);
  return res.json();
}

export async function getOracleNetOracles(limit = 20): Promise<any> {
  const res = await fetch(`${API}/oracles?limit=${limit}`);
  return res.json();
}
