import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';

interface FinanceRow {
  movie_id: string;
  title: string;
  project_status: string;
  cost_vnd: bigint;
  unlock_vnd: bigint;
  refund_vnd: bigint;
  plan_vnd: bigint;
}

export interface FilmFinance {
  movieId: string;
  title: string;
  projectStatus: string;
  productionCostVnd: number;
  unlockRevenueVnd: number;
  refundedVnd: number;
  planShareVnd: number;
  revenueVnd: number;
  profitVnd: number;
  /** Profit / production cost in percent, 2 decimals; null while the movie has no cost recorded. */
  roiPercent: number | null;
  breakEven: boolean;
}

/** Profit and ROI of one movie from its raw sums (PROJECT_OVERVIEW §3: Lợi nhuận = Doanh thu − Phí sản xuất). */
export function financeOf(row: FinanceRow): FilmFinance {
  const cost = Number(row.cost_vnd);
  const unlock = Number(row.unlock_vnd) - Number(row.refund_vnd);
  const plan = Number(row.plan_vnd);
  const revenue = unlock + plan;
  const profit = revenue - cost;
  return {
    movieId: row.movie_id,
    title: row.title,
    projectStatus: row.project_status,
    productionCostVnd: cost,
    unlockRevenueVnd: unlock,
    refundedVnd: Number(row.refund_vnd),
    planShareVnd: plan,
    revenueVnd: revenue,
    profitVnd: profit,
    roiPercent: cost > 0 ? Math.round((profit / cost) * 10000) / 100 : null,
    breakEven: profit >= 0,
  };
}

/**
 * MF-5 Financial Dashboard, Admin only: per movie, the production cost (production_cost_entries), the main
 * Coins spent unlocking its episodes less the Coins refunded when an episode was taken down (BR-49, BR-52),
 * its share of the Monthly-plan revenue (BR-48), then profit, ROI and break-even. VND at each row's rate (BR-50).
 */
@Injectable()
export class FilmFinanceService {
  constructor(private readonly prisma: PrismaService) {}

  async films() {
    const rows = await this.prisma.$queryRaw<FinanceRow[]>(Prisma.sql`
      WITH cost AS (
        SELECT project_id AS movie_id, SUM(amount_vnd)::bigint AS vnd FROM production_cost_entries GROUP BY project_id
      ), unlock AS (
        SELECT e.movie_id, SUM(ABS(ct.main_amount)::bigint * ct.rate_vnd)::bigint AS vnd
        FROM episode_accesses ea
        JOIN coin_transactions ct ON ct.id = ea.coin_transaction_id AND ct.entry_type = 'EPISODE_PURCHASE'
        JOIN episodes e ON e.id = ea.episode_id
        GROUP BY e.movie_id
      ), refund AS (
        SELECT e.movie_id, SUM(ABS(ct.main_amount)::bigint * ct.rate_vnd)::bigint AS vnd
        FROM coin_transactions ct
        JOIN episode_accesses ea ON ct.reference_type = 'EPISODE_ACCESS' AND ct.reference_id = ea.id
        JOIN episodes e ON e.id = ea.episode_id
        WHERE ct.entry_type = 'REFUND'
        GROUP BY e.movie_id
      ), plan AS (
        SELECT movie_id, SUM(allocated_vnd)::bigint AS vnd FROM revenue_allocations GROUP BY movie_id
      )
      SELECT m.id AS movie_id, m.title, mp.status::text AS project_status,
        COALESCE(cost.vnd, 0)::bigint AS cost_vnd, COALESCE(unlock.vnd, 0)::bigint AS unlock_vnd,
        COALESCE(refund.vnd, 0)::bigint AS refund_vnd, COALESCE(plan.vnd, 0)::bigint AS plan_vnd
      FROM movies m
      JOIN movie_projects mp ON mp.id = m.id
      LEFT JOIN cost ON cost.movie_id = m.id
      LEFT JOIN unlock ON unlock.movie_id = m.id
      LEFT JOIN refund ON refund.movie_id = m.id
      LEFT JOIN plan ON plan.movie_id = m.id
      ORDER BY m.title`);
    const films = rows.map(financeOf);
    const sum = (pick: (f: FilmFinance) => number) => films.reduce((total, f) => total + pick(f), 0);
    const cost = sum((f) => f.productionCostVnd);
    const profit = sum((f) => f.profitVnd);
    return {
      totals: {
        productionCostVnd: cost,
        revenueVnd: sum((f) => f.revenueVnd),
        profitVnd: profit,
        roiPercent: cost > 0 ? Math.round((profit / cost) * 10000) / 100 : null,
        breakEvenMovies: films.filter((f) => f.productionCostVnd > 0 && f.breakEven).length,
      },
      films,
    };
  }
}
