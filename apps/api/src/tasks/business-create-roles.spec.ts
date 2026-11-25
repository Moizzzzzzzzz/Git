import 'reflect-metadata';
import { RoleCode } from '@fabricqc/shared';
import { ROLES } from '../common/decorators';
import { TasksController } from './tasks.controller';

describe('业务建单路由权限', () => {
  it.each(['businessOptions', 'createBusiness'] as const)('%s 开放给本部门业务三角色', (method) => {
    expect(Reflect.getMetadata(ROLES, TasksController.prototype[method])).toEqual(
      expect.arrayContaining([RoleCode.SALES, RoleCode.BUSINESS_MANAGER, RoleCode.BUSINESS_CLERK]),
    );
  });
});
