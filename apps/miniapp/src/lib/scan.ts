import {currentContext,assertIdentity} from './session-context';
import Taro from '@tarojs/taro';
import { parseRollQr } from '@fabricqc/shared';
import { requestScoped, toastError } from './api';

interface ByQr {
  roll: { id: string; orderId?: string | null; rollNo: string; fabric: { code: string; nameZh: string } | null };
  myTasks: {
    taskRollId: string;
    status: string;
    task: { id: string; taskNo: string; title: string; defaultMode: string | null; defaultScope: string };
    inspection: { id: string; status: string } | null;
  }[];
}

/** 扫描布卷二维码，直接进入对应的检验页面 */
export async function scanRoll() {
 const context=currentContext();
  let raw: string;
  try {
    raw = (await Taro.scanCode({ onlyFromCamera: false, scanType: ['qrCode'] })).result;
  } catch {
    return;
  }
  try{assertIdentity(context);}catch{return;}
  const code = parseRollQr(raw);
  if (!code) {
    void Taro.showModal({ title: '无法识别', content: '这不是 FabricQC 布卷二维码', showCancel: false });
    return;
  }
  void Taro.showLoading({ title: '查询布卷' });
  try {
    const r = await requestScoped<ByQr>(context,'GET',`/rolls/by-qr/${code}`);
    Taro.hideLoading();
    if(r.roll.orderId){await Taro.navigateTo({url:`/pages/orders/detail?id=${encodeURIComponent(r.roll.orderId)}`});return;}
    await openTaskRoll(r.roll.rollNo, r.myTasks);
  } catch (e) {
    Taro.hideLoading();
    toastError(e);
  }
}

export async function openTaskRoll(rollNo: string, tasks: ByQr['myTasks']) {
  if (!tasks.length) {
    void Taro.showModal({ title: `卷 ${rollNo}`, content: '该布卷没有分配给你的进行中任务，请联系主管分配。', showCancel: false });
    return;
  }
  const t = tasks[0];
  if (t.inspection && ['DRAFT', 'RETURNED', 'SUBMITTED'].includes(t.inspection.status)) {
    await Taro.navigateTo({ url: `/pages/inspect/index?id=${t.inspection.id}` });
    return;
  }
  if(t.inspection && ['APPROVED','REJECTED'].includes(t.inspection.status)){
    await Taro.navigateTo({url:`/pages/review/detail?id=${t.inspection.id}`});
    return;
  }
  if (t.status !== 'PENDING') {
    void Taro.showModal({ title: `卷 ${rollNo}`, content: '该布卷已完成检验。', showCancel: false });
    return;
  }
  await Taro.navigateTo({
    url: `/pages/start/index?taskRollId=${t.taskRollId}&rollNo=${encodeURIComponent(rollNo)}&mode=${t.task.defaultMode ?? ''}&scope=${t.task.defaultScope}`,
  });
}
