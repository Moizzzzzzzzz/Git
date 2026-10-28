import { Button, Input, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useState } from 'react';
import { errorText } from '@/lib/api';
import { bind } from '@/lib/auth';

export default function Bind() {
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
      await bind(employeeNo.trim(), code.trim().toUpperCase());
      void Taro.showToast({ title: '绑定成功', icon: 'success' });
      setTimeout(() => void Taro.reLaunch({ url: '/pages/index/index' }), 800);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="container">
      <View className="card">
        <View className="card-title">首次使用请绑定员工账号</View>
        <View className="muted" style={{ marginBottom: '28px' }}>绑定码由管理员在后台生成，只能使用一次。绑定后以后打开小程序会自动登录。</View>
        <View className="field">
          <View className="label">员工编号</View>
          <Input className="input" value={employeeNo} onInput={(e) => setEmployeeNo(e.detail.value)} placeholder="如 Q001" />
        </View>
        <View className="field">
          <View className="label">绑定码（8 位）</View>
          <Input className="input" value={code} maxlength={8} onInput={(e) => setCode(e.detail.value.toUpperCase())} placeholder="字母或数字" />
        </View>
        {error && <View className="error-box">{error}</View>}
        <Button className="btn" loading={busy} disabled={busy} onClick={() => void submit()}>绑定</Button>
      </View>
    </View>
  );
}
