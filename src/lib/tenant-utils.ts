/**
 * Tenant resolution utilities.
 *
 * Key rule: always resolve by ID (contract.tenant, tenant_id) before falling back
 * to room_id. A single room can have many tenants over time (old + new), so
 * room_id-based lookups are unreliable for contract/payment contexts.
 */

/**
 * Get the representative given name (last word of Vietnamese name) from a
 * contract's stored `tenant` field. Always use this for contract/payment
 * display instead of resolving via room_id.
 */
export function getContractTenantName(contract: any): string {
  if (!contract?.tenant) return '';
  const parts = String(contract.tenant).trim().split(/\s+/);
  return parts[parts.length - 1] || '';
}

/**
 * Build a Map<contract_id, givenName> from contracts data.
 * ID-based — the only correct way to resolve tenant names in reports.
 */
export function buildContractTenantNameMap(contracts: any[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of contracts || []) {
    if (c.id && c.tenant) {
      map.set(c.id, getContractTenantName(c));
    }
  }
  return map;
}

/**
 * Find a tenant by their ID. Returns null if not found.
 */
export function findTenantById(tenants: any[], tenantId: string): any | null {
  return (tenants || []).find((t: any) => String(t.id) === String(tenantId)) || null;
}

/**
 * Resolve the representative tenant for a contract.
 *  1. By tenant_id (preferred — exact match)
 *  2. By room_id + name match (fallback for legacy data)
 *  3. By room_id only (last resort, first tenant found)
 *
 * This is intentionally conservative: it prefers to match the correct tenant
 * rather than returning stale data for old contracts.
 */
export function findContractTenant(contract: any, tenants: any[]): any | null {
  if (!contract) return null;

  // 1. Exact tenant_id match
  if (contract.tenant_id) {
    const t = findTenantById(tenants, contract.tenant_id);
    if (t) return t;
  }

  const roomId = String(contract.room_id || '').trim();
  if (!roomId) return null;

  // 2. Same room + same name
  const contractName = String(contract.tenant || '').trim().toLowerCase();
  const roomTenants = (tenants || []).filter(
    (t: any) => String(t.room_id || '').trim() === roomId,
  );
  if (contractName) {
    const byName = roomTenants.find(
      (t: any) => String(t.name || '').trim().toLowerCase() === contractName,
    );
    if (byName) return byName;
  }

  // 3. Last resort: first tenant in that room
  return roomTenants.length > 0 ? roomTenants[0] : null;
}

/**
 * Get the full tenant name for a contract (defers to findContractTenant, then
 * falls back to contract.tenant).
 */
export function getContractFullTenantName(contract: any, tenants: any[]): string {
  const t = findContractTenant(contract, tenants);
  return t ? t.name : (contract?.tenant || '—');
}

/**
 * Get the tenant phone for a contract.
 */
export function getContractTenantPhone(contract: any, tenants: any[]): string {
  const t = findContractTenant(contract, tenants);
  return t ? t.phone : (contract?.phone || '');
}
