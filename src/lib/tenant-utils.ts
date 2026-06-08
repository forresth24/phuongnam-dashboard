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
 * Falls back to tenant_id → tenants array when contract.tenant is unavailable
 * (e.g. the tenant column was removed from the contracts sheet).
 */
export function buildContractTenantNameMap(contracts: any[], tenants?: any[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of contracts || []) {
    let name = '';
    if (c.tenant) {
      name = getContractTenantName(c);
    } else if (tenants && c.tenant_id) {
      const t = findTenantById(tenants, c.tenant_id);
      if (t?.name) {
        const parts = String(t.name).trim().split(/\s+/);
        name = parts[parts.length - 1] || '';
      }
    }
    if (c.id && name) {
      map.set(c.id, name);
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
 *  1. By tenant_id (preferred — if set, authoritative, don't fall through)
 *  2. By room_id + name match (fallback for contracts without tenant_id)
 *  3. By room_id only (last resort, first tenant found)
 *
 * Key rule: if tenant_id is set, it's the single source of truth.
 * Don't fall through to room_id — a room can have different tenants over
 * time, and an archived contract's tenant_id may point to a deleted tenant
 * while a new tenant occupies the same room.
 */
export function findContractTenant(contract: any, tenants: any[]): any | null {
  if (!contract) return null;

  // 1. Exact tenant_id match (authoritative — if set, use only this)
  if (contract.tenant_id) {
    return findTenantById(tenants, contract.tenant_id);
  }

  const roomId = String(contract.room_id || '').trim();
  if (!roomId) return null;

  // 2. Same room + same name (for contracts without tenant_id)
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
