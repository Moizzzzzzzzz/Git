/** This entry is inert on import: it never loads .env or creates a DB/application connection. */
export interface DemoSeedHandle { close(): Promise<void> | void }
export interface DemoSeedEntryDependencies {
  validateConfig(): void;
  openReadOnlyDb(): Promise<DemoSeedHandle>;
  /** Must validate connected DB identity, Redis, object storage and outbound controls. */
  attest(db: DemoSeedHandle): Promise<void>;
  openApp(): Promise<DemoSeedHandle>;
  install(app: DemoSeedHandle): Promise<void>;
}
export async function runDemoSeed(d: DemoSeedEntryDependencies): Promise<void> {
  d.validateConfig();
  const db = await d.openReadOnlyDb();
  try { await d.attest(db); } finally { await db.close(); }
  const app = await d.openApp();
  try { await d.install(app); } finally { await app.close(); }
}


/** Runtime dependencies are loaded only after an explicit maintenance-window flag. */
export async function makeStandaloneDependencies(): Promise<DemoSeedEntryDependencies> {
  if (process.env.DEMO_SEED_EXECUTION_WINDOW !== 'authorized-v1' || process.env.DEMO_RUNTIME_MODE !== 'demo') {
    throw new Error('未开启授权的演示种子窗口');
  }
  const { loadEnv } = await import('../config/env');
  const { validateDemoConfig } = await import('../demo/demo-safety');
  const env = loadEnv(process.env); // Deliberately does not load the project .env file.
  let checked = false;
  return {
    validateConfig() {
      if (env.DEMO_RUNTIME_MODE !== 'demo') throw new Error('不是演示环境');
      validateDemoConfig(env);
      const db=new URL(env.DATABASE_URL),redis=new URL(env.REDIS_URL),storage=new URL(env.STORAGE_ENDPOINT!);
      if((db.port||'5432')!=='5432'||(redis.port||'6379')!=='6379'||(storage.port||'80')!=='9000') throw new Error('演示资源端口不符合合同');
      checked=true;
    },
    async openReadOnlyDb() {
      if(!checked)throw new Error('演示配置尚未验证');
      const { PrismaClient }=await import('@prisma/client');
      const prisma=new PrismaClient({datasourceUrl:env.DATABASE_URL});
      return { prisma, close:async()=>prisma.$disconnect() };
    },
    async attest(handle) {
      const { collectReadOnlyEvidence,assertDemoIdentity }=await import('./demo-seed/guard');
      const prisma=(handle as DemoSeedHandle & {prisma:import('@prisma/client').PrismaClient}).prisma;
      const fingerprints={connectionFingerprint:'demo-db:5432/fabricqc_demo',redisFingerprint:'demo-redis:6379',storageFingerprint:'demo-minio:9000/demo-media'};
      const evidence=await collectReadOnlyEvidence({query:sql=>prisma.$queryRawUnsafe<unknown[]>(sql)},fingerprints);
      assertDemoIdentity(evidence,{markerOwner:'fqc_demo_owner',...fingerprints});
      const {default:Redis}=await import('ioredis');
      const redis=new Redis(env.REDIS_URL,{lazyConnect:true,maxRetriesPerRequest:1,connectTimeout:5000});
      try { await redis.connect();if(await redis.get('fqc:demo:guard:identity')!=='fabricqc-demo|v1')throw new Error('演示缓存标识不符'); }
      finally { redis.disconnect(); }
      const {S3Client,HeadBucketCommand}=await import('@aws-sdk/client-s3');
      const s3=new S3Client({endpoint:env.STORAGE_ENDPOINT,region:env.STORAGE_REGION,forcePathStyle:true,credentials:{accessKeyId:env.STORAGE_ACCESS_KEY_ID!,secretAccessKey:env.STORAGE_SECRET_ACCESS_KEY!}});
      try { await s3.send(new HeadBucketCommand({Bucket:'demo-media'})); } finally { s3.destroy(); }
    },
    async openApp() {
      await import('reflect-metadata');
      const {NestFactory}=await import('@nestjs/core');const {AppModule}=await import('../app.module');
      const app=await NestFactory.createApplicationContext(AppModule.register({runWorkers:false}),{logger:false});
      return {app,close:()=>app.close()};
    },
    async install(handle) {
      const app=(handle as DemoSeedHandle & {app:import('@nestjs/common').INestApplicationContext}).app;
      const {PrismaService}=await import('../prisma/prisma.service');const prisma=app.get(PrismaService);
      const {DemoSafetyService}=await import('../demo/demo-safety.service');const safety=app.get(DemoSafetyService);
      const {installBase,createPrismaDemoStore}=await import('./demo-seed/bootstrap');
      await installBase(createPrismaDemoStore(prisma,()=>safety.onModuleInit()));
      const {DEMO_DEPARTMENTS,DEMO_PERSONAS,DEMO_SEED_ACTOR,DEMO_FIXTURE_KEYS,DEMO_TEMPLATES,DEMO_STANDARDS,DEMO_FABRICS}=await import('./demo-seed/manifest');
      const {TasksService}=await import('../tasks/tasks.service');const {InspectionsService}=await import('../inspections/inspections.service');
      const {ReviewsService}=await import('../reviews/reviews.service');const {MediaService}=await import('../media/media.service');
      const {createPrismaFixtureStore,createServiceFixtureDriver,installFixture}=await import('./demo-seed/fixtures');
      const {createSyntheticMediaUploader}=await import('./demo-seed/synthetic-media');
      const {S3Client,PutObjectCommand}=await import('@aws-sdk/client-s3');
      async function actor(p:typeof DEMO_PERSONAS[number] | typeof DEMO_SEED_ACTOR):Promise<import('../common/actor').Actor> {
        const u=await prisma.user.findUnique({where:{id:p.id},include:{roles:{include:{role:true}},wechat:true}});
        if(!u||u.status!=='ACTIVE'||u.employeeNo!==p.employeeNo||u.departmentId!==p.departmentId||u.roles.length!==1||u.roles[0].role.code!==p.role||u.roles[0].departmentId!==p.roleDepartmentId||u.wechat.length||u.username||u.passwordHash)throw new Error('演示身份与清单不符');
        return {userId:u.id,name:u.name,employeeNo:u.employeeNo,departmentId:u.departmentId,roles:[{role:u.roles[0].role.code,departmentId:u.roles[0].departmentId}],sessionId:'00000000-0000-4000-8000-000000000001',clientType:'MINIAPP'};
      }
      const [sales,supervisor,inspector,other]=await Promise.all([actor(DEMO_PERSONAS[0]),actor(DEMO_PERSONAS[3]),actor(DEMO_PERSONAS[4]),actor(DEMO_SEED_ACTOR)]);
      const template=await prisma.inspectionTemplate.findUniqueOrThrow({where:{code:DEMO_TEMPLATES[0].code}});
      const standard=await prisma.qualityStandard.findUniqueOrThrow({where:{code:DEMO_STANDARDS[0].standard.code}});
      const fabric=await prisma.fabric.findUniqueOrThrow({where:{code:DEMO_FABRICS[0].body.code}});
      const s3=new S3Client({endpoint:env.STORAGE_ENDPOINT,region:env.STORAGE_REGION,forcePathStyle:true,credentials:{accessKeyId:env.STORAGE_ACCESS_KEY_ID!,secretAccessKey:env.STORAGE_SECRET_ACCESS_KEY!}});
      const uploadDemoPhoto=createSyntheticMediaUploader({media:app.get(MediaService),prisma,put:async(key,body,contentType)=>{await s3.send(new PutObjectCommand({Bucket:'demo-media',Key:key,Body:body,ContentType:contentType}));}});
      try {
        // Hold an independent advisory lock while services use their own transactions.
        await prisma.$transaction(async tx=>{
          const lock=await tx.$queryRaw<{locked:boolean}[]>`SELECT pg_try_advisory_xact_lock(731561201, 1) AS locked`;
          if(!lock[0]?.locked)throw new Error('演示种子已有执行者');
          for(const key of DEMO_FIXTURE_KEYS) {
            const driver=createServiceFixtureDriver({tasks:app.get(TasksService),inspections:app.get(InspectionsService),reviews:app.get(ReviewsService),prisma,
              actors:{sales,other,supervisor,inspector},store:createPrismaFixtureStore(prisma,key),
              base:{businessDepartmentId:DEMO_DEPARTMENTS[1].id,otherDepartmentId:DEMO_DEPARTMENTS[0].id,templateId:template.id,standardId:standard.id,fabricId:fabric.id},uploadDemoPhoto});
            await installFixture(driver,key);
          }
        },{timeout:600000});
      } finally { s3.destroy(); }
    },
  };
}

if (require.main === module) {
  void makeStandaloneDependencies().then(runDemoSeed).catch(() => {
    // Do not print environment, credentials, URLs, tokens, or low-level driver errors.
    console.error('演示种子未完成；请检查隔离配置和受控维护记录');
    process.exitCode=1;
  });
}
