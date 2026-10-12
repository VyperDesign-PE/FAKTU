import { sql } from "./client.js";

const MIGRATION_ID = "20260827_001_mvp_persistence";
const ONBOARDING_MIGRATION_ID = "20260827_002_tenant_onboarding_state";
const BILLING_STATE_MIGRATION_ID = "20260827_003_billing_connection_state";
const DELIVERY_MIGRATION_ID = "20260827_004_receipt_delivery_queue";
const SUNAT_RUC_REGISTRY_MIGRATION_ID = "20260828_005_sunat_ruc_registry";
const APISPERU_SANDBOX_MIGRATION_ID = "20260828_006_apisperu_sandbox";
const PILOT_FEATURES_MIGRATION_ID = "20261012_007_payments_credit_notes";

/**
 * Migración idempotente del MVP 1.0.
 *
 * En producción conviene ejecutar migraciones como paso separado del deploy.
 * Para el MVP, el servidor puede ejecutarlas al iniciar si DB_AUTO_MIGRATE=true.
 */
export async function runMigrations() {
  await sql`
    create table if not exists schema_migrations (
      id text primary key,
      applied_at timestamptz not null default now()
    )
  `;

  const alreadyApplied = await sql`
    select id from schema_migrations where id = ${MIGRATION_ID} limit 1
  `;

  if (!alreadyApplied.length) await sql.begin(async (tx) => {
    await tx`
      create table if not exists app_users (
        id uuid primary key,
        email text not null unique,
        password_hash text not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `;

    await tx`
      create table if not exists tenants (
        id uuid primary key,
        display_name text not null,
        ruc varchar(11),
        legal_name text,
        trade_name text,
        address text,
        phone text,
        email text,
        taxpayer_status text,
        status text not null default 'ACTIVE',
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `;

    // Compatibilidad con bases creadas por versiones anteriores.
    await tx`alter table tenants add column if not exists legal_name text`;
    await tx`alter table tenants add column if not exists trade_name text`;
    await tx`alter table tenants add column if not exists address text`;
    await tx`alter table tenants add column if not exists phone text`;
    await tx`alter table tenants add column if not exists email text`;
    await tx`alter table tenants add column if not exists taxpayer_status text`;

    await tx`
      create unique index if not exists uq_tenants_ruc_not_null
      on tenants (ruc)
      where ruc is not null
    `;

    await tx`
      create table if not exists tenant_memberships (
        tenant_id uuid not null references tenants(id) on delete cascade,
        user_id uuid not null references app_users(id) on delete cascade,
        role text not null default 'OWNER',
        created_at timestamptz not null default now(),
        primary key (tenant_id, user_id)
      )
    `;

    await tx`
      create table if not exists subscriptions (
        tenant_id uuid primary key references tenants(id) on delete cascade,
        plan_code text not null default 'MVP',
        status text not null default 'TRIALING',
        trial_ends_at timestamptz,
        current_period_end timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `;

    await tx`
      create table if not exists tenant_billing_settings (
        tenant_id uuid primary key references tenants(id) on delete cascade,
        provider_code text not null default 'mock',
        environment text not null default 'sandbox',
        provider_account_ref text,
        credential_secret_ref text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `;

    await tx`
      create table if not exists customers (
        id uuid primary key,
        tenant_id uuid not null references tenants(id) on delete cascade,
        document_type varchar(3) not null check (document_type in ('DNI', 'RUC')),
        document_number varchar(11) not null,
        full_name text not null,
        address text,
        phone text,
        email text,
        data_source text not null default 'MANUAL',
        verified_at timestamptz,
        active boolean not null default true,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (tenant_id, document_type, document_number)
      )
    `;

    await tx`
      create index if not exists idx_customers_tenant_document
      on customers (tenant_id, document_type, document_number)
    `;
    await tx`
      create index if not exists idx_customers_tenant_name
      on customers (tenant_id, lower(full_name))
    `;

    await tx`
      create table if not exists products (
        id uuid primary key,
        tenant_id uuid not null references tenants(id) on delete cascade,
        client_product_id text not null,
        sku text,
        name text not null,
        unit_price numeric(14,2) not null check (unit_price >= 0),
        unit_code text not null default 'NIU',
        favorite boolean not null default false,
        active boolean not null default true,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (tenant_id, client_product_id)
      )
    `;

    await tx`
      create index if not exists idx_products_tenant_active_name
      on products (tenant_id, active, lower(name))
    `;
    await tx`
      create index if not exists idx_products_tenant_favorite
      on products (tenant_id, favorite)
      where active = true
    `;

    await tx`
      create table if not exists document_series (
        id uuid primary key,
        tenant_id uuid not null references tenants(id) on delete cascade,
        document_type varchar(10) not null check (document_type in ('BOLETA', 'FACTURA')),
        series varchar(4) not null,
        last_correlative bigint not null default 0 check (last_correlative >= 0),
        active boolean not null default true,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (tenant_id, document_type, series)
      )
    `;

    await tx`
      create table if not exists receipts (
        id uuid primary key,
        tenant_id uuid not null references tenants(id) on delete restrict,
        customer_id uuid references customers(id) on delete set null,
        client_transaction_id text not null,
        temporary_number text not null,
        document_type varchar(10) not null check (document_type in ('BOLETA', 'FACTURA')),
        series varchar(4) not null,
        correlative bigint not null,
        official_number text,
        issue_date timestamptz not null default now(),
        currency varchar(3) not null default 'PEN',
        subtotal numeric(14,2) not null,
        igv numeric(14,2) not null,
        total numeric(14,2) not null,
        igv_rate numeric(5,2) not null default 18.00,
        sunat_status varchar(20) not null default 'PENDIENTE'
          check (sunat_status in ('PENDIENTE', 'ENVIANDO', 'ACEPTADO', 'OBSERVADO', 'RECHAZADO', 'ERROR')),
        customer_document_type varchar(3),
        customer_document_number varchar(11),
        customer_name text,
        customer_address text,
        provider_code text,
        provider_document_id text,
        provider_message text,
        provider_pdf_url text,
        provider_xml_url text,
        provider_cdr_url text,
        json_storage_key text,
        pdf_storage_key text,
        xml_storage_key text,
        cdr_storage_key text,
        attempt_count integer not null default 0,
        last_attempt_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (tenant_id, client_transaction_id),
        unique (tenant_id, document_type, series, correlative)
      )
    `;

    await tx`
      create index if not exists idx_receipts_tenant_date
      on receipts (tenant_id, issue_date desc)
    `;
    await tx`
      create index if not exists idx_receipts_tenant_status
      on receipts (tenant_id, sunat_status, issue_date desc)
    `;
    await tx`
      create index if not exists idx_receipts_tenant_customer
      on receipts (tenant_id, customer_id, issue_date desc)
    `;

    await tx`
      create table if not exists receipt_items (
        id uuid primary key,
        receipt_id uuid not null references receipts(id) on delete cascade,
        product_ref text,
        description text not null,
        quantity numeric(14,4) not null check (quantity > 0),
        unit_code text not null default 'NIU',
        unit_price numeric(14,6) not null check (unit_price >= 0),
        line_subtotal numeric(14,2) not null,
        line_igv numeric(14,2) not null,
        line_total numeric(14,2) not null,
        igv_rate numeric(5,2) not null default 18.00,
        created_at timestamptz not null default now()
      )
    `;
    await tx`create index if not exists idx_receipt_items_receipt on receipt_items (receipt_id)`;

    await tx`
      create table if not exists document_lookup_usage (
        id uuid primary key,
        tenant_id uuid not null references tenants(id) on delete cascade,
        document_type varchar(3) not null check (document_type in ('DNI', 'RUC')),
        document_number varchar(11) not null,
        lookup_source text not null,
        provider_code text,
        external_lookup boolean not null default false,
        estimated_cost numeric(10,4) not null default 0,
        successful boolean not null,
        created_at timestamptz not null default now()
      )
    `;
    await tx`
      create index if not exists idx_lookup_usage_tenant_date
      on document_lookup_usage (tenant_id, created_at desc)
    `;
    await tx`
      create index if not exists idx_lookup_usage_tenant_external
      on document_lookup_usage (tenant_id, external_lookup, created_at desc)
    `;

    await tx`
      insert into schema_migrations (id)
      values (${MIGRATION_ID})
      on conflict do nothing
    `;
  });

  const onboardingApplied = await sql`
    select id from schema_migrations where id = ${ONBOARDING_MIGRATION_ID} limit 1
  `;
  if (!onboardingApplied.length) {
    await sql.begin(async (tx) => {
      await tx`alter table tenants add column if not exists onboarding_completed boolean not null default false`;
      await tx`
        insert into schema_migrations (id)
        values (${ONBOARDING_MIGRATION_ID})
        on conflict do nothing
      `;
    });
  }

  const billingStateApplied = await sql`
    select id from schema_migrations where id = ${BILLING_STATE_MIGRATION_ID} limit 1
  `;
  if (!billingStateApplied.length) {
    await sql.begin(async (tx) => {
      await tx`alter table tenant_billing_settings add column if not exists connection_status text not null default 'NOT_TESTED'`;
      await tx`alter table tenant_billing_settings add column if not exists last_tested_at timestamptz`;
      await tx`alter table tenant_billing_settings add column if not exists last_error text`;
      await tx`
        insert into schema_migrations (id)
        values (${BILLING_STATE_MIGRATION_ID})
        on conflict do nothing
      `;
    });
  }

  const deliveryApplied = await sql`
    select id from schema_migrations where id = ${DELIVERY_MIGRATION_ID} limit 1
  `;
  if (!deliveryApplied.length) {
    await sql.begin(async (tx) => {
      await tx`
        create table if not exists receipt_deliveries (
          id uuid primary key,
          tenant_id uuid not null references tenants(id) on delete cascade,
          receipt_id uuid not null references receipts(id) on delete cascade,
          channel text not null check (channel in ('WHATSAPP', 'EMAIL', 'SMS')),
          destination text not null,
          status text not null default 'PENDING' check (status in ('WAITING_RECEIPT', 'PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED')),
          idempotency_key text not null,
          attempt_count integer not null default 0,
          next_attempt_at timestamptz not null default now(),
          last_attempt_at timestamptz,
          sent_at timestamptz,
          provider_code text,
          provider_message_id text,
          last_error text,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),
          unique (tenant_id, idempotency_key)
        )
      `;
      await tx`create index if not exists idx_deliveries_pending on receipt_deliveries (tenant_id, status, next_attempt_at)`;
      await tx`create index if not exists idx_deliveries_receipt on receipt_deliveries (tenant_id, receipt_id, created_at desc)`;
      await tx`
        insert into schema_migrations (id)
        values (${DELIVERY_MIGRATION_ID})
        on conflict do nothing
      `;
    });
  }


  const sunatRucRegistryApplied = await sql`
    select id from schema_migrations where id = ${SUNAT_RUC_REGISTRY_MIGRATION_ID} limit 1
  `;
  if (!sunatRucRegistryApplied.length) {
    await sql.begin(async (tx) => {
      await tx`
        create table if not exists sunat_ruc_registry (
          ruc varchar(11) primary key,
          legal_name text not null,
          taxpayer_status text,
          domicile_condition text,
          ubigeo varchar(6),
          fiscal_address text,
          data_version text not null,
          source_updated_at date,
          imported_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),
          check (ruc ~ '^[0-9]{11}$')
        )
      `;
      await tx`create index if not exists idx_sunat_ruc_registry_status on sunat_ruc_registry (taxpayer_status)`;
      await tx`create index if not exists idx_sunat_ruc_registry_condition on sunat_ruc_registry (domicile_condition)`;

      await tx`
        create table if not exists sunat_ruc_import_runs (
          id uuid primary key,
          source_url text not null,
          source_updated_at date,
          source_sha256 varchar(64),
          status text not null check (status in ('RUNNING', 'COMPLETED', 'FAILED')),
          row_count bigint not null default 0,
          error_message text,
          started_at timestamptz not null default now(),
          completed_at timestamptz
        )
      `;
      await tx`create index if not exists idx_sunat_ruc_import_runs_started on sunat_ruc_import_runs (started_at desc)`;

      await tx`
        insert into schema_migrations (id)
        values (${SUNAT_RUC_REGISTRY_MIGRATION_ID})
        on conflict do nothing
      `;
    });
  }

  const apiPeruSandboxApplied = await sql`
    select id from schema_migrations where id = ${APISPERU_SANDBOX_MIGRATION_ID} limit 1
  `;
  if (!apiPeruSandboxApplied.length) {
    await sql.begin(async (tx) => {
      await tx`alter table tenants add column if not exists ubigeo varchar(6)`;
      await tx`alter table tenants add column if not exists department text`;
      await tx`alter table tenants add column if not exists province text`;
      await tx`alter table tenants add column if not exists district text`;

      await tx`
        create table if not exists receipt_provider_artifacts (
          receipt_id uuid primary key references receipts(id) on delete cascade,
          provider_code text not null,
          provider_hash text,
          xml_content text,
          cdr_zip_base64 text,
          raw_response jsonb,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        )
      `;

      await tx`
        insert into schema_migrations (id)
        values (${APISPERU_SANDBOX_MIGRATION_ID})
        on conflict do nothing
      `;
    });
  }


  const pilotFeaturesApplied = await sql`
    select id from schema_migrations where id = ${PILOT_FEATURES_MIGRATION_ID} limit 1
  `;
  if (!pilotFeaturesApplied.length) {
    await sql.begin(async (tx) => {
      // Notas de crédito como un tipo más de comprobante (reutiliza correlativos,
      // idempotencia, conciliación y compartir).
      await tx`alter table receipts drop constraint if exists receipts_document_type_check`;
      await tx`
        alter table receipts add constraint receipts_document_type_check
        check (document_type in ('BOLETA', 'FACTURA', 'NOTA_CREDITO'))
      `;
      await tx`alter table receipts alter column document_type type varchar(12)`;
      await tx`alter table document_series drop constraint if exists document_series_document_type_check`;
      await tx`alter table document_series alter column document_type type varchar(12)`;
      await tx`
        alter table document_series add constraint document_series_document_type_check
        check (document_type in ('BOLETA', 'FACTURA', 'NOTA_CREDITO'))
      `;
      await tx`alter table receipts add column if not exists related_receipt_id uuid references receipts(id) on delete restrict`;
      await tx`alter table receipts add column if not exists credit_note_reason text`;
      // Una sola nota de crédito vigente por comprobante (una rechazada por
      // SUNAT no impide volver a intentar la anulación).
      await tx`
        create unique index if not exists uq_receipts_credit_note_per_receipt
        on receipts (related_receipt_id)
        where document_type = 'NOTA_CREDITO' and sunat_status <> 'RECHAZADO'
      `;

      // Medios de pago (Yape/Plin dominan en pequeños comercios) y vuelto.
      await tx`alter table receipts add column if not exists payment_method varchar(20) not null default 'EFECTIVO'`;
      await tx`alter table receipts drop constraint if exists receipts_payment_method_check`;
      await tx`
        alter table receipts add constraint receipts_payment_method_check
        check (payment_method in ('EFECTIVO', 'YAPE', 'PLIN', 'TARJETA', 'TRANSFERENCIA'))
      `;
      await tx`alter table receipts add column if not exists amount_received numeric(14,2)`;
      await tx`alter table receipts add column if not exists change_amount numeric(14,2)`;

      // Datos para la representación impresa oficial.
      await tx`alter table receipts add column if not exists provider_qr_data text`;
      await tx`alter table receipts add column if not exists provider_hash text`;

      await tx`
        create index if not exists idx_receipts_pending_worker
        on receipts (last_attempt_at)
        where sunat_status in ('PENDIENTE', 'ENVIANDO', 'ERROR', 'OBSERVADO')
      `;

      await tx`
        insert into schema_migrations (id)
        values (${PILOT_FEATURES_MIGRATION_ID})
        on conflict do nothing
      `;
    });
  }
}
