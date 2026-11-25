import {useEffect,useRef} from 'react';
import {useDidHide,useDidShow} from '@tarojs/taro';
/** An auth-gated child may mount after Taro's first show. Load on mount, once per visible period. */
export function usePageDidShow(callback:()=>void){
 const latest=useRef(callback);latest.current=callback;
 const loaded=useRef(false);
 const show=()=>{if(loaded.current)return;loaded.current=true;latest.current();};
 useDidShow(show);
 useDidHide(()=>{loaded.current=false;});
 useEffect(show,[]);
}
