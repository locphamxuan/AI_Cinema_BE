import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { periodOf } from './finance-period';

interface FinanceRow {
  movie_id: string;
  title: string;
  studio_name: string | null;
  created_at: Date;
  cost_vnd: bigint;
  sales_vnd: bigint;
  refund_vnd: bigint;
  plan_vnd: bigint;
}

/** NO_COST: no production cost recorded yet, so neither ROI nor break-even means anything. */
export type BreakEvenStatus = 'NO_COST' | 'BROKE_EVEN' | 'NOT_YET';

export interface FilmFinance {
  movieId: string;
  title: string;
  /** Studio and creation date tell apart two films with the same title. */
  studioName: string | null;
  createdAt: Date;
  productionCostVnd: number;
  /** Main Coins spent unlocking its episodes, refunds already taken off (BR-49, BR-52). */
  episodeSalesVnd: number;
  /** The refunds taken off `episodeSalesVnd`. */
  refundedVnd: number;
  /** Its share of the Monthly-plan revenue of the months already shared (BR-48). */
  planShareVnd: number;
  revenueVnd: number;
  profitVnd: number;
  /** Profit / production cost in percent, 2 decimals; null while the film has no cost recorded. */
  roiPercent: number | null;
  breakEven: BreakEvenStatus;
}

const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 10000) / 100 : null);

/** Profit and ROI of one film from its raw sums (PROJECT_OVERVIEW §3: Lợi nhuận = Doanh thu − Phí sản xuất). */
export function financeOf(row: FinanceRow): FilmFinance {
  const cost = Number(row.cost_vnd);
  const refunded = Number(row.refund_vnd);
  const sales = Number(row.sales_vnd) - refunded;
  const plan = Number(row.plan_vnd);
  const revenue = sales + plan;
  const profit = revenue - cost;
  return {
    movieId: row.movie_id,
    title: row.title,
    studioName: row.studio_name,
    createdAt: row.created_at,
    productionCostVnd: cost,
    episodeSalesVnd: sales,
    refundedVnd: refunded,
    planShareVnd: plan,
    revenueVnd: revenue,
    profitVnd: profit,
    roiPercent: percent(profit, cost),
    breakEven: cost <= 0 ? 'NO_COST' : profit >= 0 ? 'BROKE_EVEN' : 'NOT_YET',
  };
}

/** Sums of every film; the margin is profit over revenue, ROI profit over cost. */
export function totalsOf(films: FilmFinance[]) {
  const sum = (pick: (f: FilmFinance) => number) => films.reduce((total, f) => total + pick(f), 0);
  const cost = sum((f) => f.productionCostVnd);
  const revenue = sum((f) => f.revenueVnd);
  const profit = sum((f) => f.profitVnd);
  return {
    productionCostVnd: cost,
    episodeSalesVnd: sum((f) => f.episodeSalesVnd),
    planShareVnd: sum((f) => f.planShareVnd),
    revenueVnd: revenue,
    profitVnd: profit,
    roiPercent: percent(profit, cost),
    marginPercent: percent(profit, revenue),
    costedMovies: films.filter((f) => f.breakEven !== 'NO_COST').length,
    brokeEvenMovies: films.filter((f) => f.breakEven === 'BROKE_EVEN').length,
  };
}

/**
 * MF-5 Financial Dashboard, Admin only: per film, the production cost (production_cost_entries) against its revenue
 * from two sources: (a) main Coins spent unlocking its episodes, less the main Coins refunded when an episode was
 * taken down (BR-49, BR-52; bonus Coins are promotion cost, never revenue), both at the rate of the purchase
 * (BR-50); (b) its share of the Monthly-plan revenue (BR-48), which the monthly job shares once a month is over,
 * so the running month is not in it yet (`currentPeriod`, `lastSharedPeriod`).
 */
@Injectable()
export class FilmFinanceService {
  constructor(private readonly prisma: PrismaService) {}

  async films(now = new Date()) {
    const [rows, last] = await Promise.all([
      this.prisma.$queryRaw<FinanceRow[]>(Prisma.sql`
        WITH cost AS (
          SELECT project_id AS movie_id, SUM(amount_vnd)::bigint AS vnd FROM production_cost_entries GROUP BY project_id
        ), sales AS (
          SELECT e.movie_id, SUM(ABS(p.main_amount)::bigint * p.rate_vnd)::bigint AS vnd
          FROM episode_accesses ea
          JOIN coin_transactions p ON p.id = ea.coin_transaction_id AND p.entry_type = 'EPISODE_PURCHASE'
          JOIN episodes e ON e.id = ea.episode_id
          GROUP BY e.movie_id
        ), refund AS (
          SELECT e.movie_id, SUM(ABS(r.main_amount)::bigint * p.rate_vnd)::bigint AS vnd
          FROM coin_transactions r
          JOIN episode_accesses ea ON r.reference_type = 'EPISODE_ACCESS' AND r.reference_id = ea.id
          JOIN coin_transactions p ON p.id = ea.coin_transaction_id AND p.entry_type = 'EPISODE_PURCHASE'
          JOIN episodes e ON e.id = ea.episode_id
          WHERE r.entry_type = 'REFUND'
          GROUP BY e.movie_id
        ), plan AS (
          SELECT movie_id, SUM(allocated_vnd)::bigint AS vnd FROM revenue_allocations GROUP BY movie_id
        )
        SELECT m.id AS movie_id, m.title, s.name AS studio_name, m.created_at,
          COALESCE(cost.vnd, 0)::bigint AS cost_vnd, COALESCE(sales.vnd, 0)::bigint AS sales_vnd,
          COALESCE(refund.vnd, 0)::bigint AS refund_vnd, COALESCE(plan.vnd, 0)::bigint AS plan_vnd
        FROM movies m
        JOIN movie_projects mp ON mp.id = m.id
        LEFT JOIN studios s ON s.id = mp.studio_id
        LEFT JOIN cost ON cost.movie_id = m.id
        LEFT JOIN sales ON sales.movie_id = m.id
        LEFT JOIN refund ON refund.movie_id = m.id
        LEFT JOIN plan ON plan.movie_id = m.id
        ORDER BY m.title, m.created_at`),
      this.prisma.revenueAllocation.findFirst({ orderBy: { period: 'desc' }, select: { period: true } }),
    ]);
    const films = rows.map(financeOf);
    return {
      currentPeriod: periodOf(now),
      lastSharedPeriod: last?.period ?? null,
      totals: totalsOf(films),
      films,
    };
  }
}
