// 全局配色。亮色沿用 hello uni-app 的观感（iOS 蓝 + 浅灰底 + 白卡片），
// 暗色是同一组语义键的另一套取值。
//
// 主题作为 **CSS 自定义属性** 下发：Shell 把当前这套挂在根节点的内联样式上，
// 组件里只写 `var(--fjs-card)`，切换时不用碰任何组件。
//
// 为什么是自定义属性而不是在根节点上翻一个 `.dark` class：两种写法在
// Flutter 侧的实测开销一样（见 docs/performance.md），所以按可读性选——
// 自定义属性让「有哪些颜色」这件事只写在这一个文件里，而 class 写法会把
// 每个颜色在每个组件的 <style scoped> 里各写两遍。
//
// web 侧是真 CSS 变量，Flutter 侧由 fjs 的样式引擎解析，两端同一套取值。
import { computed, ref } from 'vue';

export interface Palette {
  /** 主色，也是选中态 */
  primary: string;
  success: string;
  warn: string;
  danger: string;
  /** 页面底色 */
  page: string;
  /** 卡片 / 导航栏 / tabBar 的面 */
  card: string;
  /** 卡片被按下时的面 */
  cardActive: string;
  /** 分隔线与描边 */
  border: string;
  /** 标题文字 */
  title: string;
  /** 正文文字 */
  text: string;
  /** 次要文字 */
  muted: string;
  /** 再次一级的说明文字 */
  faint: string;
  /** 悬浮 tabBar 胶囊的面：半透明，让滚到下面的内容透出来（specs/210）。
   * Flutter 端没有模糊 tag，毛玻璃就到不了这一步，靠这个透明度近似。 */
  capsule: string;
}

export const light: Palette = {
  primary: '#007AFF',
  success: '#4CD964',
  warn: '#F0AD4E',
  danger: '#DD524D',
  page: '#F4F5F7',
  card: '#FFFFFF',
  cardActive: '#ECECEF',
  border: '#E5E5E5',
  title: '#1A1A1A',
  text: '#333333',
  muted: '#999999',
  faint: '#B0B0B0',
  capsule: 'rgba(255, 255, 255, 0.78)',
};

export const dark: Palette = {
  primary: '#0A84FF',
  success: '#32D74B',
  warn: '#FF9F0A',
  danger: '#FF453A',
  page: '#000000',
  card: '#1C1C1E',
  cardActive: '#2C2C2E',
  border: '#38383A',
  title: '#F2F2F7',
  text: '#D8D8DC',
  muted: '#8E8E93',
  faint: '#636366',
  capsule: 'rgba(28, 28, 30, 0.78)',
};

export type ThemeMode = 'light' | 'dark';

const mode = ref<ThemeMode>('light');

export function useTheme() {
  return {
    mode,
    palette: computed(() => (mode.value === 'dark' ? dark : light)),
    /** 挂到根节点 :style 上的自定义属性表。 */
    vars: computed(() => paletteVars(mode.value === 'dark' ? dark : light)),
    toggle() {
      mode.value = mode.value === 'dark' ? 'light' : 'dark';
    },
    set(next: ThemeMode) {
      mode.value = next;
    },
  };
}

/** `{ primary: '#007AFF' }` -> `{ '--fjs-primary': '#007AFF' }`。 */
export function paletteVars(p: Palette): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(p) as (keyof Palette)[]) {
    out[`--fjs-${kebab(key)}`] = p[key];
  }
  return out;
}

function kebab(s: string): string {
  return s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
}
