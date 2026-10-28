import { Button, Text, View } from '@tarojs/components';
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro';
import { ROLE_LABELS } from '@fabricqc/shared';
import { useState } from 'react';
import { api, errorText } from '@/lib/api';
import { currentMe, ensureLogin, hasRole } from '@/lib/auth';
import { listLocalDrafts, isDirty } from '@/lib/draft';
import { scanRoll } from '@/lib/scan';
import './index.scss';

interface MyTask {
  id: string;
  taskNo: string;
  title: string;
  rollCount: number;
  doneCount: number;
  pendingCount: number;
  dueAt: string | null;
}

export default function Index() {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [tasks, setTasks] = useState<MyTask[]>([]);
  const [pendingReviews, setPendingReviews] = useState(0);
  const [unsynced, setUnsynced] = useState(0);

  async function load() {
    try {
      const s = await ensureLogin();
      if (s === 'NEED_BIND') {
        await Taro.redirectTo({ url: '/pages/bind/index' });
        return;
      }
      setState('ready');
      const jobs: Promise<unknown>[] = [];
      if (hasRole('INSPECTOR')) jobs.push(api.get<MyTask[]>('/tasks/mine').then(setTasks));
      if (hasRole('QC_SUPERVISOR', 'QUALITY_MANAGER')) {
        jobs.push(api.get<unknown[]>('/reviews/pending').then((r) => setPendingReviews(r.length)));
      }
      await Promise.all(jobs);
    } catch (e) {
      setError(errorText(e));
      setState(currentMe() ? 'ready' : 'error');
    } finally {
      setUnsynced(listLocalDrafts().filter((d) => isDirty(d) || d.photos.some((p) => p.status !== 'uploaded')).length);
      Taro.stopPullDownRefresh();
    }
  }

  useDidShow(() => void load());
  usePullDownRefresh(() => void load());

  const me = currentMe();
  if (state === 'loading') return <View className="empty">正在登录…</View>;
  if (state === 'error') {
    return (
      <View className="container">
        <View className="error-box">{error}</View>
        <Button className="btn" onClick={() => { setState('loading'); void load(); }}>重试</Button>
      </View>
    );
  }

  return (
    <View className="container home">
      <View className="row hello">
        <View>
          <View className="name">{me?.name}</View>
          <View className="muted">{me?.roles.map((r) => ROLE_LABELS[r.role]).join(' · ')}</View>
        </View>
        <Button className="btn small ghost" onClick={() => Taro.navigateTo({ url: '/pages/me/index' })}>我的</Button>
      </View>
      {error && <View className="error-box">{error}</View>}
      {unsynced > 0 && <View className="warn-box">本机有 {unsynced} 条检验数据尚未同步，打开对应检验即可自动同步</View>}

      {hasRole('INSPECTOR') && (
        <Button className="btn btn-xl scan" onClick={() => void scanRoll()}>
          扫码验布
        </Button>
      )}

      {hasRole('QC_SUPERVISOR', 'QUALITY_MANAGER') && (
        <View className="card row" onClick={() => Taro.navigateTo({ url: '/pages/review/list' })}>
          <View>
            <View className="card-title" style={{ marginBottom: 0 }}>审核中心</View>
            <View className="muted">待我审核的检验记录</View>
          </View>
          <View className={`badge ${pendingReviews ? 'on' : ''}`}>{pendingReviews}</View>
        </View>
      )}

      {hasRole('INSPECTOR') && (
        <View>
          <View className="section-title">我的任务</View>
          {!tasks.length && <View className="empty">暂无分配给你的任务</View>}
          {tasks.map((t) => (
            <View key={t.id} className="card" onClick={() => Taro.navigateTo({ url: `/pages/task/index?id=${t.id}` })}>
              <View className="row">
                <Text className="card-title" style={{ marginBottom: 0 }}>{t.title}</Text>
                <Text className="tag">{t.doneCount}/{t.rollCount}</Text>
              </View>
              <View className="muted" style={{ marginTop: '8px' }}>
                {t.taskNo} · 待检 {t.pendingCount} 卷{t.dueAt ? ` · 截止 ${t.dueAt.slice(0, 10)}` : ''}
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
