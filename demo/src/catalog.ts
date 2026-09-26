// 首页目录：从生成的路由表推导，不手写页面列表（同 examples/hello-fjs）。
//
// 每个 src/pages/*.vue 在 <route> 块里声明 title / group / desc，新增页面只改
// 页面自己；没写 group 的页面（首页本身）不进目录。
//
// 惰性求值：pages 表 import 了每个页面，首页又 import 这个文件，模块图上是个
// 环。放到函数里，等首页真正渲染时 routes 已经初始化好了。
import { routes } from 'fjs/pages';

export interface Entry {
  title: string;
  /** 一句话说明，显示在标题下面。 */
  desc: string;
  path: string;
}

export interface Category {
  name: string;
  items: Entry[];
}

/** 分组顺序（路由表本身按文件名排）。 */
const GROUPS = ['基础能力', '交互演示', 'Vant', 'NutUI'];

let cache: Category[] | null = null;

export function catalog(): Category[] {
  cache ??= GROUPS.map((name) => ({
    name,
    items: routes
      .filter((route) => route.meta?.group === name)
      .map((route) => ({
        title: String(route.meta?.title ?? route.path),
        desc: String(route.meta?.desc ?? ''),
        path: route.path,
      })),
  })).filter((category) => category.items.length > 0);
  return cache;
}
