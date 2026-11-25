import { withDemoBoundary } from '@/components/DemoContextBar';
import { Button, Input, View } from '@tarojs/components';
import Taro,{useRouter} from '@tarojs/taro';
import {parseSharedOrderId} from '@/lib/order-share';
import {assertIdentity,currentContext} from '@/lib/session-context';
import { useState } from 'react';
import { errorText } from '@/lib/api';
import { bind } from '@/lib/auth';

function Bind() {
  const orderId=parseSharedOrderId(useRouter().params.orderId);
  const [employeeNo, setEmployeeNo] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!employeeNo.trim() || code.trim().length !== 8) {
      setError('请输入员工编号和 8 位绑定码');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const origin=currentContext();
      await bind(employeeNo.trim(), code.trim().toUpperCase());
      assertIdentity(origin);
      void Taro.showToast({ title: '绑定成功', icon: 'success' });
      await Taro.reLaunch({url:orderId?`/pages/order-share/index?id=${orderId}`:'/pages/index/index'});
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="container">
      <View className="page-intro"><View className="page-intro-kicker">员工账号</View><View className="page-intro-title">永盛集团质检平台</View><View className="page-intro-note">绑定员工账号，开始验布工作</View></View>
      <View className="card">
        <View className="card-title">首次使用请绑定员工账号</View>
        <View className="muted" style={{ marginBottom: '28px' }}>绑定码由管理员在后台生成，只能使用一次。绑定后以后打开小程序会自动登录。</View>
        <View className="field">
          <View className="label">员工编号</View>
          <Input placeholderClass="field-placeholder" className="input" value={employeeNo} onInput={(e) => setEmployeeNo(e.detail.value)} placeholder="填写员工编号" />
        </View>
        <View className="field">
          <View className="label">绑定码（8 位）</View>
          <Input placeholderClass="field-placeholder" className="input" value={code} maxlength={8} onInput={(e) => setCode(e.detail.value.toUpperCase())} placeholder="字母或数字" />
        </View>
        {error && <View className="error-box">{error}</View>}
        <Button className="btn" loading={busy} disabled={busy} onClick={() => void submit()}>绑定</Button>
      </View>
    </View>
  );
}

export default withDemoBoundary(Bind);
