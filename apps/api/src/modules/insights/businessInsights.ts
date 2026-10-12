import { sql } from "../../db/client.js";
import { limaToday } from "../reports/salesReports.js";
import { listOpenReceivables } from "../receivables/receivableRepository.js";

const LIMA = "America/Lima";

type DayRow = { day: string; sales: string; credit_notes: string; count: string };

function addDays(date: string, days: number) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const money = (value: number) => Math.round(value * 100) / 100;

/**
 * Resumen "Mi negocio": lo que un bodeguero quiere saber sin abrir reportes.
 * Las ventas se muestran netas de notas de crédito (anulaciones y devoluciones)
 * del mismo día, en hora de Lima.
 */
export async function businessInsights(tenantId: string) {
  const today = limaToday();
  const since = addDays(today, -13);

  const days = await sql<DayRow[]>`
    select to_char(d.day, 'YYYY-MM-DD') as day,
      coalesce(sum(case when d.document_type in ('BOLETA','FACTURA') then d.total end), 0) as sales,
      coalesce(sum(case when d.document_type = 'NOTA_CREDITO' then d.total end), 0) as credit_notes,
      count(*) filter (where d.document_type in ('BOLETA','FACTURA')) as count
    from (
      select (issue_date at time zone ${LIMA})::date as day, document_type, total
      from receipts
      where tenant_id = ${tenantId} and sunat_status <> 'RECHAZADO'
        and (issue_date at time zone ${LIMA})::date >= ${since}::date
    ) d
    group by d.day order by d.day
  `;
  const byDay = new Map(days.map((row) => [row.day, row]));
  const net = (date: string) => {
    const row = byDay.get(date);
    return row ? money(Number(row.sales) - Number(row.credit_notes)) : 0;
  };
  const series = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(today, index - 6);
    return { date, total: net(date), count: Number(byDay.get(date)?.count ?? 0) };
  });

  const topProducts = await sql<{ name: string; quantity: string; revenue: string }[]>`
    select i.description as name, sum(i.quantity) as quantity, sum(i.line_total) as revenue
    from receipt_items i join receipts r on r.id = i.receipt_id
    where r.tenant_id = ${tenantId} and r.document_type in ('BOLETA','FACTURA') and r.sunat_status <> 'RECHAZADO'
      and r.issue_date >= now() - interval '30 days'
      and not exists (
        select 1 from receipts n where n.related_receipt_id = r.id and n.document_type = 'NOTA_CREDITO'
          and n.sunat_status = 'ACEPTADO' and n.note_reason_code in ('01','02','06')
      )
    group by i.description order by revenue desc limit 5
  `;

  const peak = await sql<{ hour: string; count: string }[]>`
    select extract(hour from issue_date at time zone ${LIMA})::int as hour, count(*) as count
    from receipts
    where tenant_id = ${tenantId} and document_type in ('BOLETA','FACTURA') and sunat_status <> 'RECHAZADO'
      and issue_date >= now() - interval '30 days'
    group by 1 order by count desc limit 1
  `;

  const methods = await sql<{ method: string; total: string }[]>`
    select payment_method as method, sum(total) as total
    from receipts
    where tenant_id = ${tenantId} and document_type in ('BOLETA','FACTURA') and sunat_status <> 'RECHAZADO'
      and issue_date >= now() - interval '7 days'
    group by 1 order by total desc
  `;

  const lowStock = await sql<{ client_product_id: string; name: string; stock_qty: string; min_stock: string }[]>`
    select client_product_id, name, stock_qty, min_stock from products
    where tenant_id = ${tenantId} and active = true and stock_qty is not null and stock_qty <= min_stock
    order by (stock_qty - min_stock) asc, lower(name) limit 10
  `;

  const open = await listOpenReceivables(tenantId);
  const oldest = open[0] ? Math.max(0, Math.floor((Date.now() - new Date(open[0].issueDate).getTime()) / 86_400_000)) : 0;

  const todayTotal = net(today);
  const yesterdayTotal = net(addDays(today, -1));
  const lastWeekTotal = net(addDays(today, -7));
  const weekTotal = money(series.reduce((sum, day) => sum + day.total, 0));

  return {
    date: today,
    today: { total: todayTotal, count: Number(byDay.get(today)?.count ?? 0) },
    yesterday: yesterdayTotal,
    sameDayLastWeek: lastWeekTotal,
    week: { total: weekTotal, series },
    topProducts: topProducts.map((row) => ({ name: row.name, quantity: Number(row.quantity), revenue: money(Number(row.revenue)) })),
    peakHour: peak[0] ? Number(peak[0].hour) : null,
    paymentMix: methods.map((row) => ({ method: row.method, total: money(Number(row.total)) })),
    lowStock: lowStock.map((row) => ({ clientProductId: row.client_product_id, name: row.name, stockQty: Number(row.stock_qty), minStock: Number(row.min_stock) })),
    receivables: { total: money(open.reduce((sum, item) => sum + item.balance, 0)), customers: new Set(open.map((item) => item.customerDocument ?? item.customerName)).size, oldestDays: oldest }
  };
}
