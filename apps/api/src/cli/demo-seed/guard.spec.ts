import { assertDemoIdentity, type DemoIdentityEvidence } from './guard';

const valid: DemoIdentityEvidence = {
  database: 'fabricqc_demo', currentUser: 'fqc_demo_app', sessionUser: 'fqc_demo_app', owner: 'fqc_demo_owner', ownerCanLogin: false,
  isSuperuser: false, isOwnerMember: false, hasOtherRoleMembership:false, ownsApplicationObjects:false, canCreateDatabase: false, canCreateRole: false,
  markerOwner: 'fqc_demo_owner', markerSchemaOwner: 'fqc_demo_owner', markerSchema: 'fqc_demo_guard', markerTable: 'environment_marker',
  environmentId: 'fabricqc-demo', resetVersion: 'v1', markerRowCount: 1,
  markerReadable: true, markerWritable: false, markerSchemaWritable: false, migrationsWritable: false, publicSchemaWritable: false,
  connectionFingerprint: 'isolated-connection', storageFingerprint: 'isolated-storage', redisFingerprint:'isolated-redis',
};
const expected = { markerOwner: 'fqc_demo_owner', connectionFingerprint: 'isolated-connection', storageFingerprint: 'isolated-storage', redisFingerprint:'isolated-redis' };

describe('demo database guard', () => {
  it('accepts a fully verified isolated identity', () => expect(() => assertDemoIdentity(valid, expected)).not.toThrow());
  it.each([
    ['database','production'], ['currentUser','postgres'], ['sessionUser','postgres'], ['owner','postgres'], ['ownerCanLogin',true],
    ['isSuperuser',true], ['isOwnerMember',true], ['hasOtherRoleMembership',true], ['ownsApplicationObjects',true], ['canCreateDatabase',true], ['canCreateRole',true],
    ['markerOwner','postgres'], ['markerSchemaOwner','postgres'], ['markerSchema','public'], ['markerTable','other'], ['environmentId','production'],
    ['resetVersion','v2'], ['markerRowCount',0], ['markerRowCount',2], ['markerReadable',false],
    ['markerWritable',true], ['markerSchemaWritable',true], ['migrationsWritable',true], ['publicSchemaWritable',true], ['connectionFingerprint','prod'], ['storageFingerprint','prod'], ['redisFingerprint','prod'],
  ] as const)('rejects mismatched evidence %s=%s', (key,value) => {
    expect(() => assertDemoIdentity({ ...valid, [key]: value }, expected)).toThrow();
  });
  it('rejects missing trusted fingerprints even if evidence matches', () => {
    expect(() => assertDemoIdentity({...valid,connectionFingerprint:''},{...expected,connectionFingerprint:''})).toThrow();
  });
});

describe('read-only marker collection', () => {
  it('does not attempt marker read when identity metadata is absent', async () => {
    const { collectReadOnlyEvidence } = require('./guard');
    const query = jest.fn().mockResolvedValue([]);
    await expect(collectReadOnlyEvidence({ query }, {connectionFingerprint:'a',storageFingerprint:'b',redisFingerprint:'c'})).rejects.toThrow();
    expect(query).toHaveBeenCalledTimes(1);
  });
});
