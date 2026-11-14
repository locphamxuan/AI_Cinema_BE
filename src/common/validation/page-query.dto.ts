import { Allow } from 'class-validator';

/**
 * Lets the `@Paginate()` keys through a filter DTO read with `@Query()`: the global
 * ValidationPipe forbids unknown keys, so without these `?limit=20` answers 400.
 * `@Paginate()` parses and checks them itself.
 */
export class PageQueryDto {
  @Allow()
  page?: string;

  @Allow()
  limit?: string;

  @Allow()
  sortBy?: string | string[];

  @Allow()
  search?: string;

  @Allow()
  after?: string;

  @Allow()
  before?: string;
}
