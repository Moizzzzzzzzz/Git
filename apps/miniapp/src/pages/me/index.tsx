import { Button, Text, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { ROLE_LABELS } from '@fabricqc/shared';
import { useState } from 'react';
import { api } from '@/lib/api';
import { currentMe, logout } from '@/lib/auth';
import { isDirty, listLocalDrafts } from '@/lib/draft';
import { API_BASE_URL } from '@/lib/config';

export default function Me() {
  const me = currentMe();
  const [subs, setSubs] = useState<{ templateId: string; remaining: number }[]>([]);
  const drafts = listLocalDrafts();
  useDidShow(() => {
    api.get<{ subscriptions: { templateId: string; remaining: number }[] }>('/notifications/wechat-subscriptions')
      .then((r) => setSubs(r.subscriptions))
      .catch(() => undefined);
  });

  async function doLogout() {
    const unsynced = drafts.filter((d) => isDirty(d) || d.photos.some((p) => p.status !== 'uploaded')).length;
    const r = await Taro.showModal({
      title: '退出登录？',
      content: unsynced ? `本机还有 ${unsynced} 条未同步的检验数据，退出后仍保留在本机，重新登录可继续同步。` : '退出后需要重新进入小程序登录',
    });
    if (!r.confirm) return;
    await logout();
    void Taro.reLaunch({ url: '/pages/index/index' });
  }

  return (
    <View className="container">
      <View className="card">
        <View style={{ fontSize: '40px', fontWeight: 700 }}>{me?.name}</View>
        <View className="muted" style={{ marginTop: '8px' }}>员工编号 {me?.employeeNo} · {me?.department?.name ?? '未设置部门'}</View>
        <View className="muted">{me?.roles.map((r) => ROLE_LABELS[r.role]).join(' · ')}</View>
      </View>
      <View className="card">
        <View className="card-title">微信提醒授权余量</View>
        {!subs.length && <View className="muted">暂无授权。审核人可在"审核中心"点击"接收提醒"。</View>}
        {subs.map((s) => (
          <View key={s.templateId} className="kv"><Text className="k">{s.templateId.slice(0, 12)}…</Text><Text>{s.remaining} 次</Text></View>
        ))}
      </View>
      <View className="card">
        <View className="card-title">本机数据</View>
        <View className="kv"><Text className="k">本机检验草稿</Text><Text>{drafts.length} 条</Text></View>
        <View className="kv"><Text className="k">服务地址</Text><Text style={{ fontSize: '22px' }}>{API_BASE_URL}</Text></View>
      </View>
      <Button className="btn ghost" onClick={() => void doLogout()}>退出登录</Button>
    </View>
  );
}
