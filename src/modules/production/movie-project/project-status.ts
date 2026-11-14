import { ProjectStatus } from '@prisma/client';
import { OPEN_PROJECT_STATUSES } from 'src/modules/production/project-access/project-rules';

/** A project can be edited until it is cancelled, completed projects included (their episodes may be fixed). */
export const EDITABLE_PROJECT_STATUSES: ProjectStatus[] = [
  ...OPEN_PROJECT_STATUSES,
  ProjectStatus.COMPLETED,
  ProjectStatus.UNDER_REVISION,
];
