import { MovieStatus } from '@prisma/client';
import { OPEN_PROJECT_STATUSES } from 'src/modules/production/project-access/project-rules';

/** A project can be edited until it is cancelled, completed projects included (their episodes may be fixed). */
export const EDITABLE_PROJECT_STATUSES: MovieStatus[] = [
  ...OPEN_PROJECT_STATUSES,
  MovieStatus.COMPLETED,
  MovieStatus.UNDER_REVISION,
];
