import {beforeEach,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({mount:()=>{},show:()=>{},hide:()=>{}}));
vi.mock('react',()=>({useRef:(value:unknown)=>({current:value}),useEffect:(fn:()=>void)=>{h.mount=fn;}}));
vi.mock('@tarojs/taro',()=>({useDidShow:(fn:()=>void)=>{h.show=fn;},useDidHide:(fn:()=>void)=>{h.hide=fn;}}));
beforeEach(()=>{vi.resetModules();h.mount=()=>{};h.show=()=>{};h.hide=()=>{};});
it('late mounted verified page loads once even after the initial Taro show already passed',async()=>{const fn=vi.fn();const {usePageDidShow}=await import('../src/lib/use-page-show');h.show();expect(fn).not.toHaveBeenCalled();usePageDidShow(fn);expect(fn).not.toHaveBeenCalled();h.mount();expect(fn).toHaveBeenCalledTimes(1);});
it('normal first show and mount do not duplicate load; hide and show refresh again',async()=>{const fn=vi.fn();const {usePageDidShow}=await import('../src/lib/use-page-show');usePageDidShow(fn);h.show();h.mount();expect(fn).toHaveBeenCalledTimes(1);h.hide();h.show();expect(fn).toHaveBeenCalledTimes(2);});
it('mount before native first show also loads exactly once',async()=>{const fn=vi.fn();const {usePageDidShow}=await import('../src/lib/use-page-show');usePageDidShow(fn);h.mount();h.show();expect(fn).toHaveBeenCalledTimes(1);});
