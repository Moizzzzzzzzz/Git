import Taro from '@tarojs/taro';
import {ensureLogin} from './auth';
/** Resolve the new actor before mounting a Taro page whose first useDidShow loads data. */
export async function finishDemoTransition(transition:()=>Promise<void>){
  await transition();
  await ensureLogin();
  await Taro.reLaunch({url:'/pages/index/index'});
}
