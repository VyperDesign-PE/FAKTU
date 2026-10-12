import { sql } from "../../db/client.js";

export type BusinessRecord = {
  id: string;
  ruc?: string;
  businessName?: string;
  tradeName?: string;
  address?: string;
  ubigeo?: string;
  department?: string;
  province?: string;
  district?: string;
  phone?: string;
  email?: string;
  taxpayerStatus?: string;
  onboardingComplete?: boolean;
};

type TenantRow = {
  id: string;
  ruc: string | null;
  legal_name: string | null;
  trade_name: string | null;
  display_name: string;
  address: string | null;
  ubigeo: string | null;
  department: string | null;
  province: string | null;
  district: string | null;
  phone: string | null;
  email: string | null;
  taxpayer_status: string | null;
  onboarding_completed: boolean;
};

function map(row: TenantRow): BusinessRecord {
  return {
    id: row.id,
    ruc: row.ruc ?? undefined,
    businessName: row.legal_name ?? row.display_name,
    tradeName: row.trade_name ?? undefined,
    address: row.address ?? undefined,
    ubigeo: row.ubigeo ?? undefined,
    department: row.department ?? undefined,
    province: row.province ?? undefined,
    district: row.district ?? undefined,
    phone: row.phone ?? undefined,
    email: row.email ?? undefined,
    taxpayerStatus: row.taxpayer_status ?? undefined,
    onboardingComplete: row.onboarding_completed
  };
}


export async function getBusiness(tenantId: string): Promise<BusinessRecord | null> {
  const rows = await sql<TenantRow[]>`
    select id, ruc, legal_name, trade_name, display_name, address,
      ubigeo, department, province, district,
      phone, email, taxpayer_status, onboarding_completed
    from tenants where id = ${tenantId} limit 1
  `;
  return rows[0] ? map(rows[0]) : null;
}

export async function updateBusiness(tenantId: string, input: Partial<Omit<BusinessRecord, "id">>): Promise<BusinessRecord> {
  const current = await getBusiness(tenantId);
  if (!current) throw new Error("Negocio no encontrado");

  const businessName = input.businessName ?? current.businessName ?? "Mi negocio";
  const rows = await sql<TenantRow[]>`
    update tenants
    set
      ruc = ${input.ruc ?? current.ruc ?? null},
      legal_name = ${businessName},
      display_name = ${input.tradeName ?? current.tradeName ?? businessName},
      trade_name = ${input.tradeName ?? current.tradeName ?? null},
      address = ${input.address ?? current.address ?? null},
      ubigeo = ${input.ubigeo ?? current.ubigeo ?? null},
      department = ${input.department ?? current.department ?? null},
      province = ${input.province ?? current.province ?? null},
      district = ${input.district ?? current.district ?? null},
      phone = ${input.phone ?? current.phone ?? null},
      email = ${input.email ?? current.email ?? null},
      taxpayer_status = ${input.taxpayerStatus ?? current.taxpayerStatus ?? null},
      onboarding_completed = ${input.onboardingComplete ?? current.onboardingComplete ?? false},
      updated_at = now()
    where id = ${tenantId}
    returning id, ruc, legal_name, trade_name, display_name, address,
      ubigeo, department, province, district,
      phone, email, taxpayer_status, onboarding_completed
  `;
  return map(rows[0]);
}
