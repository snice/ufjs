// tabbar 风格（specs/212）：应用层状态，「关于」页切换，TabBar.vue 分发。
//
// 持久化只做 Web：仓库里没有 App 端的键值存储原语（不为一个小功能新开 C ABI，
// 宪法 II），App 端重启回默认。通用 storage 模块另立 spec。
import { ref } from 'vue';

export type TabBarStyleName = 'liquid-glass' | 'classic';

const KEY = 'hello-fjs.tabBarStyle';
const NAMES: TabBarStyleName[] = ['liquid-glass', 'classic'];

function load(): TabBarStyleName {
  try {
    const v = (globalThis as { localStorage?: Storage }).localStorage?.getItem(KEY);
    if (v && (NAMES as string[]).includes(v)) return v as TabBarStyleName;
  } catch {
    // 隐私模式 / 无 localStorage：用默认
  }
  return 'liquid-glass';
}

const style = ref<TabBarStyleName>(load());

export function useTabBarStyle() {
  return {
    style,
    names: NAMES,
    set(next: TabBarStyleName) {
      style.value = next;
      try {
        (globalThis as { localStorage?: Storage }).localStorage?.setItem(KEY, next);
      } catch {
        // 同上：写不进去就只留内存态
      }
    },
  };
}
