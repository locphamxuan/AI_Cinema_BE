import { CoinStatementQueryDto } from 'src/modules/episode-access/coin-wallet/statement/dto/coin-statement-query.dto';

export function toStatementFilter(userId: string, dto: CoinStatementQueryDto) {
  return {
    userId,
    kind: dto.kind ?? 'ALL',
    entryType: dto.entryType,
    from: dto.from ? new Date(dto.from) : undefined,
    to: dto.to ? new Date(dto.to) : undefined,
  };
}
