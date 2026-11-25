import {usePageDidShow} from '@/lib/use-page-show';
import { withDemoBoundary } from '@/components/DemoContextBar';
import { usePageApi } from '@/lib/use-page-context';
import BottomNav from '@/components/BottomNav';
import { Button, Text, View } from '@tarojs/components';
import Taro, { usePullDownRefresh } from '@tarojs/taro';
import { useState } from 'react';
import { api, errorText } from '@/lib/api';

interface Notice { id: string; title: string; body: string; createdAt: string; readAt: string | null; pagePath: string | null }
function Notifications() {
 const api=usePageApi();
  const [items, setItems] = useState<Notice[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  async function load() { try { const r = await api.get<{ items: Notice[] }>('/notifications?page=1&pageSize=100'); setItems(r.items); setError(''); } catch (e) { setError(errorText(e)); } finally { setLoading(false); Taro.stopPullDownRefresh(); } }
  usePageDidShow(() => void load()); usePullDownRefresh(() => void load());
  async function open(n: Notice) { try { if (!n.readAt) await api.post(`/notifications/${n.id}/read`, {}); await load(); if (n.pagePath && /^\/?pages\/(review\/detail|inspect\/index|task\/index|business\/index|orders\/detail)(\?|$)/.test(n.pagePath)) await Taro.navigateTo({ url: n.pagePath.startsWith('/') ? n.pagePath : `/${n.pagePath}` }); } catch (e) { setError(errorText(e)); } }
  async function readAll() { try { await api.post('/notifications/read-all', {}); await load(); } catch (e) { setError(errorText(e)); } }
  return <View className="container"><View className="page-intro"><View className="page-intro-kicker">MESSAGES · 消息中心</View><View className="page-intro-title">工作通知</View><View className="page-intro-note">查看任务与审核消息</View></View><View className="row" style={{ marginBottom: '24px' }}><View className="card-title">工作通知</View><Button className="btn small secondary" onClick={() => void readAll()}>全部已读</Button></View>{error && <View className="error-box">{error}</View>}{loading && <View className="empty">正在加载…</View>}{!loading && !error && !items.length && <View className="empty">暂无消息</View>}{items.map(n => <View className="card" key={n.id} onClick={() => void open(n)}><View className="row"><Text className="card-title">{n.title}</Text>{!n.readAt && <Text className="tag danger">未读</Text>}</View><View>{n.body}</View><View className="muted" style={{ marginTop:'14px' }}>{n.createdAt.replace('T',' ').slice(0,16)}</View></View>)}<BottomNav current="messages" /></View>;
}

export default withDemoBoundary(Notifications);
