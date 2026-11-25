export interface DemoIdentityEvidence {
 database:string; currentUser:string; sessionUser:string; owner:string; ownerCanLogin:boolean;
 isSuperuser:boolean; isOwnerMember:boolean; hasOtherRoleMembership:boolean; ownsApplicationObjects:boolean; canCreateDatabase:boolean; canCreateRole:boolean;
 markerOwner:string; markerSchemaOwner:string; markerSchema:string; markerTable:string;
 environmentId:string; resetVersion:string; markerRowCount:number; markerReadable:boolean;
 markerWritable:boolean; markerSchemaWritable:boolean; migrationsWritable:boolean; publicSchemaWritable:boolean; connectionFingerprint:string; storageFingerprint:string; redisFingerprint:string;
}
export interface DemoIdentityContract { markerOwner:string; connectionFingerprint:string; storageFingerprint:string; redisFingerprint:string }
export function assertDemoIdentity(e: DemoIdentityEvidence, expected: DemoIdentityContract): void {
  const valid = expected.markerOwner === 'fqc_demo_owner' && !!expected.connectionFingerprint && !!expected.storageFingerprint && !!expected.redisFingerprint &&
    e.database === 'fabricqc_demo' && e.currentUser === 'fqc_demo_app' && e.sessionUser === 'fqc_demo_app' && e.owner === 'fqc_demo_owner' &&
    e.ownerCanLogin === false && e.isSuperuser === false && e.isOwnerMember === false && e.hasOtherRoleMembership === false && e.ownsApplicationObjects === false &&
    e.canCreateDatabase === false && e.canCreateRole === false && e.markerOwner === expected.markerOwner &&
    e.markerSchemaOwner === expected.markerOwner && e.markerSchema === 'fqc_demo_guard' &&
    e.markerTable === 'environment_marker' && e.environmentId === 'fabricqc-demo' && e.resetVersion === 'v1' &&
    e.markerRowCount === 1 && e.markerReadable === true && e.markerWritable === false && e.markerSchemaWritable === false && e.migrationsWritable === false && e.publicSchemaWritable === false &&
    e.connectionFingerprint === expected.connectionFingerprint && e.storageFingerprint === expected.storageFingerprint && e.redisFingerprint === expected.redisFingerprint;
  if (!valid) throw new Error('演示数据库身份验证失败；禁止执行种子');
}

/** Read-only adapter; caller establishes a dedicated connection only in an authorized window. */
export interface ReadOnlyQuery { query(sql: string): Promise<unknown[]> }
export async function collectReadOnlyEvidence(
  db: ReadOnlyQuery,
  verifiedResources: { connectionFingerprint: string; storageFingerprint: string; redisFingerprint: string },
): Promise<DemoIdentityEvidence> {
  const rows = await db.query(`SELECT current_database() AS database, current_user AS "currentUser", session_user AS "sessionUser",
    owner.rolname AS owner, owner.rolcanlogin AS "ownerCanLogin", me.rolsuper AS "isSuperuser",
    me.rolcreatedb AS "canCreateDatabase", me.rolcreaterole AS "canCreateRole",
    pg_has_role(current_user, owner.oid, 'MEMBER') AS "isOwnerMember",
    EXISTS(SELECT 1 FROM pg_roles possible WHERE possible.oid <> me.oid AND pg_has_role(current_user, possible.oid, 'MEMBER')) AS "hasOtherRoleMembership",
    (EXISTS(SELECT 1 FROM pg_namespace owned WHERE owned.nspowner=me.oid AND owned.nspname NOT LIKE 'pg_%' AND owned.nspname <> 'information_schema') OR
     EXISTS(SELECT 1 FROM pg_class owned JOIN pg_namespace n2 ON n2.oid=owned.relnamespace WHERE owned.relowner=me.oid AND n2.nspname NOT LIKE 'pg_%' AND n2.nspname <> 'information_schema')) AS "ownsApplicationObjects",
    nsowner.rolname AS "markerSchemaOwner", tblowner.rolname AS "markerOwner",
    has_schema_privilege(current_user, n.oid, 'CREATE') AS "markerSchemaWritable",
    has_schema_privilege(current_user, n.oid, 'USAGE') AND has_table_privilege(current_user, c.oid, 'SELECT') AS "markerReadable",
    has_schema_privilege(current_user,'public','CREATE') AS "publicSchemaWritable",
    (has_table_privilege(current_user,'public._prisma_migrations','INSERT') OR has_table_privilege(current_user,'public._prisma_migrations','UPDATE') OR
     has_table_privilege(current_user,'public._prisma_migrations','DELETE') OR has_table_privilege(current_user,'public._prisma_migrations','TRUNCATE') OR
     has_table_privilege(current_user,'public._prisma_migrations','REFERENCES') OR has_table_privilege(current_user,'public._prisma_migrations','TRIGGER')) AS "migrationsWritable",
    (has_table_privilege(current_user,c.oid,'INSERT') OR has_table_privilege(current_user,c.oid,'UPDATE') OR
     has_table_privilege(current_user,c.oid,'DELETE') OR has_table_privilege(current_user,c.oid,'TRUNCATE') OR
     has_table_privilege(current_user,c.oid,'REFERENCES') OR has_table_privilege(current_user,c.oid,'TRIGGER')) AS "markerWritable"
    FROM pg_database d JOIN pg_roles owner ON owner.oid=d.datdba
    JOIN pg_roles me ON me.rolname=current_user
    JOIN pg_namespace n ON n.nspname='fqc_demo_guard'
    JOIN pg_roles nsowner ON nsowner.oid=n.nspowner
    JOIN pg_class c ON c.relnamespace=n.oid AND c.relname='environment_marker' AND c.relkind='r'
    JOIN pg_roles tblowner ON tblowner.oid=c.relowner
    WHERE d.datname=current_database()`);
  if (rows.length !== 1) throw new Error('无法读取独立演示库身份，禁止种子');
  const m = rows[0] as Omit<DemoIdentityEvidence, 'markerSchema'|'markerTable'|'environmentId'|'resetVersion'|'markerRowCount'|'connectionFingerprint'|'storageFingerprint'|'redisFingerprint'>;
  const marker = await db.query('SELECT id, environment_id AS "environmentId", reset_version AS "resetVersion" FROM fqc_demo_guard.environment_marker');
  if (marker.length !== 1) throw new Error('演示库标记行数不符，禁止种子');
  const v = marker[0] as { id: number; environmentId: string; resetVersion: string };
  if (v.id !== 1) throw new Error('演示库标记ID不符，禁止种子');
  return { ...m, markerSchema:'fqc_demo_guard', markerTable:'environment_marker', environmentId:v.environmentId,
    resetVersion:v.resetVersion, markerRowCount:marker.length, ...verifiedResources };
}
