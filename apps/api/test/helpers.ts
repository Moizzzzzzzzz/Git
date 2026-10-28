import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';
import { WechatApiError, WechatGateway, type SubscribeMessage, type WechatSession } from '../src/wechat/wechat.gateway';

/** 测试替身：只在测试中注入，生产代码不包含任何模拟逻辑 */
export class FakeWechatGateway extends WechatGateway {
  sent: SubscribeMessage[] = [];
  failNextWith: number | null = null;

  get appId() {
    return 'wx-test-app';
  }
  get configured() {
    return true;
  }
  async code2Session(code: string): Promise<WechatSession> {
    if (!code.startsWith('code-')) throw new WechatApiError(40029, 'invalid code');
    return { openId: `openid-${code.slice(5)}` };
  }
  async sendSubscribeMessage(msg: SubscribeMessage) {
    if (this.failNextWith !== null) {
      const code = this.failNextWith;
      this.failNextWith = null;
      throw new WechatApiError(code, 'fake failure');
    }
    this.sent.push(msg);
  }
}

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
  wechat: FakeWechatGateway;
}

export async function createTestApp(): Promise<TestContext> {
  const wechat = new FakeWechatGateway();
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register({ runWorkers: false, disableRateLimit: true })],
  })
    .overrideProvider(WechatGateway)
    .useValue(wechat)
    .compile();
  const app = moduleRef.createNestApplication({ logger: ['error'] });
  configureApp(app);
  await app.init();
  return { app, prisma: app.get(PrismaService), wechat };
}

export function api(app: INestApplication, token?: string) {
  const agent = request(app.getHttpServer());
  const auth = (r: request.Test) => (token ? r.set('Authorization', `Bearer ${token}`) : r);
  return {
    get: (url: string) => auth(agent.get(`/api${url}`)),
    post: (url: string, body?: object) => auth(agent.post(`/api${url}`)).send(body ?? {}),
    put: (url: string, body?: object) => auth(agent.put(`/api${url}`)).send(body ?? {}),
  };
}

export async function adminLogin(app: INestApplication, username = 'admin', password = 'TestAdmin12345') {
  const r = await api(app).post('/auth/admin/login', { username, password });
  if (r.status !== 200) throw new Error(`admin login failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.accessToken as string;
}

/** 通过真实的绑定流程为员工建立微信身份并返回小程序令牌 */
export async function bindWechat(app: INestApplication, adminToken: string, userId: string, employeeNo: string, openSuffix: string) {
  const code = await api(app, adminToken).post(`/users/${userId}/bind-code`);
  if (code.status !== 201) throw new Error(`bind code failed ${JSON.stringify(code.body)}`);
  const login = await api(app).post('/auth/wechat/login', { code: `code-${openSuffix}` });
  const bind = await api(app).post('/auth/wechat/bind', {
    bindTicket: login.body.bindTicket,
    employeeNo,
    bindCode: code.body.bindCode,
  });
  if (bind.status !== 200) throw new Error(`bind failed ${JSON.stringify(bind.body)}`);
  return bind.body as { accessToken: string; refreshToken: string };
}

/** 直接 PUT 到预签名地址（MinIO / COS） */
export async function putPresigned(url: string, contentType: string, body: Buffer) {
  const r = await fetch(url, { method: 'PUT', headers: { 'Content-Type': contentType }, body });
  if (!r.ok) throw new Error(`presigned PUT failed: ${r.status} ${await r.text()}`);
}
