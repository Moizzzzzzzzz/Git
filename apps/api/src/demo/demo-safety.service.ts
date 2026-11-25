import { Injectable, OnModuleInit } from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { DemoSessionStore } from './demo-session.store';
import { validateDemoConfig } from './demo-safety';

interface Evidence {database:string;currentUser:string;sessionUser:string;owner:string;ownerCanLogin:boolean;isSuperuser:boolean;isOwnerMember:boolean;hasOtherMembership:boolean;ownsObjects:boolean;canCreateDatabase:boolean;canCreateRole:boolean;markerOwner:string;markerSchemaOwner:string;markerSchemaWritable:boolean;markerReadable:boolean;migrationsWritable:boolean;markerWritable:boolean;publicSchemaWritable:boolean}
@Injectable()
export class DemoSafetyService implements OnModuleInit {
 constructor(private readonly config:AppConfig,private readonly prisma:PrismaService,private readonly store:DemoSessionStore) {}
 async onModuleInit():Promise<void> {
  const e=this.config.env;if(e.DEMO_RUNTIME_MODE!=='demo')return;
  validateDemoConfig(e);
  try {
   const rows=await this.prisma.$queryRaw<Evidence[]>`SELECT current_database() AS database,current_user AS "currentUser",session_user AS "sessionUser",
    owner.rolname AS owner,owner.rolcanlogin AS "ownerCanLogin",me.rolsuper AS "isSuperuser",me.rolcreatedb AS "canCreateDatabase",me.rolcreaterole AS "canCreateRole",
    pg_has_role(current_user,owner.oid,'MEMBER') AS "isOwnerMember",
    EXISTS (SELECT 1 FROM pg_roles r WHERE r.oid<>me.oid AND pg_has_role(current_user,r.oid,'MEMBER')) AS "hasOtherMembership",
    (EXISTS (SELECT 1 FROM pg_namespace n3 WHERE n3.nspowner=me.oid) OR EXISTS (SELECT 1 FROM pg_class c3 WHERE c3.relowner=me.oid)) AS "ownsObjects",
    nsowner.rolname AS "markerSchemaOwner",tblowner.rolname AS "markerOwner",
    has_schema_privilege(current_user,n.oid,'CREATE') AS "markerSchemaWritable",
    has_schema_privilege(current_user,n.oid,'USAGE') AND has_table_privilege(current_user,c.oid,'SELECT') AS "markerReadable",
    has_schema_privilege(current_user,'public','CREATE') AS "publicSchemaWritable",
    (has_table_privilege(current_user,'public._prisma_migrations','INSERT') OR has_table_privilege(current_user,'public._prisma_migrations','UPDATE') OR has_table_privilege(current_user,'public._prisma_migrations','DELETE') OR has_table_privilege(current_user,'public._prisma_migrations','TRUNCATE') OR has_table_privilege(current_user,'public._prisma_migrations','REFERENCES') OR has_table_privilege(current_user,'public._prisma_migrations','TRIGGER')) AS "migrationsWritable",
    (has_table_privilege(current_user,c.oid,'INSERT') OR has_table_privilege(current_user,c.oid,'UPDATE') OR has_table_privilege(current_user,c.oid,'DELETE') OR has_table_privilege(current_user,c.oid,'TRUNCATE') OR has_table_privilege(current_user,c.oid,'REFERENCES') OR has_table_privilege(current_user,c.oid,'TRIGGER')) AS "markerWritable"
    FROM pg_database d JOIN pg_roles owner ON owner.oid=d.datdba JOIN pg_roles me ON me.rolname=current_user
    JOIN pg_namespace n ON n.nspname='fqc_demo_guard' JOIN pg_roles nsowner ON nsowner.oid=n.nspowner
    JOIN pg_class c ON c.relnamespace=n.oid AND c.relname='environment_marker' AND c.relkind='r' JOIN pg_roles tblowner ON tblowner.oid=c.relowner
    WHERE d.datname=current_database()`;
   const x=rows[0];
   if(rows.length!==1||!x||x.database!=='fabricqc_demo'||x.currentUser!=='fqc_demo_app'||x.sessionUser!=='fqc_demo_app'||x.owner!=='fqc_demo_owner'||x.ownerCanLogin!==false||x.isSuperuser!==false||x.isOwnerMember!==false||x.hasOtherMembership!==false||x.ownsObjects!==false||x.canCreateDatabase!==false||x.canCreateRole!==false||x.markerOwner!=='fqc_demo_owner'||x.markerSchemaOwner!=='fqc_demo_owner'||x.markerSchemaWritable!==false||x.markerReadable!==true||x.migrationsWritable!==false||x.markerWritable!==false||x.publicSchemaWritable!==false)throw new Error('identity');
   const marker=await this.prisma.$queryRaw<{id:number;environmentId:string;resetVersion:string}[]>`SELECT id,environment_id AS "environmentId",reset_version AS "resetVersion" FROM fqc_demo_guard.environment_marker`;
   if(marker.length!==1||marker[0].id!==1||marker[0].environmentId!=='fabricqc-demo'||marker[0].resetVersion!=='v1')throw new Error('marker');
   if(await this.store.identityMarker()!=='fabricqc-demo|v1')throw new Error('redis marker');
  }catch {throw new Error('演示环境隔离核验失败，禁止启动');}
 }
}
