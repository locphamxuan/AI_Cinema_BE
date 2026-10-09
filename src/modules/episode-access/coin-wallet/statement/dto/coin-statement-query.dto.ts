import { ApiPropertyOptional } from '@nestjs/swagger';
import { CoinEntryType } from '@prisma/client';
import { IsEnum, IsISO8601, IsIn, IsOptional, IsUUID } from 'class-validator';

/** Filters of `GET /api/wallet/statements` and `GET /api/admin/coin-transactions`. */
export class CoinStatementQueryDto {
  @ApiPropertyOptional({ enum: ['MAIN', 'BONUS', 'ALL'], default: 'ALL' })
  @IsIn(['MAIN', 'BONUS', 'ALL'])
  @IsOptional()
  kind?: 'MAIN' | 'BONUS' | 'ALL';

  @ApiPropertyOptional({ enum: CoinEntryType, description: 'Only one kind of movement' })
  @IsEnum(CoinEntryType)
  @IsOptional()
  entryType?: CoinEntryType;

  @ApiPropertyOptional({ description: 'Wallet to read; admin ledger only, ignored on the own statement' })
  @IsUUID()
  @IsOptional()
  walletId?: string;

  @ApiPropertyOptional({ example: '2026-10-01T00:00:00.000Z', description: 'Oldest line to show' })
  @IsISO8601()
  @IsOptional()
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31T23:59:59.000Z', description: 'Newest line to show' })
  @IsISO8601()
  @IsOptional()
  to?: string;
}
