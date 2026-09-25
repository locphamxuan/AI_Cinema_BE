import { SetMetadata } from '@nestjs/common';
import type { PermissionKey } from 'src/common/auth/permissions';

export const PERMISSIONS_KEY = 'permissions';

/** The caller's role must hold at least one of these permissions (checked by PermissionsGuard). */
export const RequirePermission = (...permissions: PermissionKey[]) => SetMetadata(PERMISSIONS_KEY, permissions);
