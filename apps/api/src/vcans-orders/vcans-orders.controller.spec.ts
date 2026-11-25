import 'reflect-metadata';
import { RoleCode } from '@fabricqc/shared';
import { ROLES } from '../common/decorators';
import { VcansOrdersController } from './vcans-orders.controller';

describe('H订单路由', () => {
  it('建单只开放已授权的业务角色', () => {
    expect(Reflect.getMetadata(ROLES, VcansOrdersController.prototype.create)).toEqual([RoleCode.SALES, RoleCode.BUSINESS_MANAGER, RoleCode.BUSINESS_CLERK]);
  });
});
