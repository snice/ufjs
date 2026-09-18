# 写第一个页面

这一篇做一个小小的「待办清单」：首页列出待办、能添加和勾选，点一条进入详情页。做完你会用到页面生成、组件、响应式、事件、样式和路由跳转。

先启动 dev server，边写边看效果：

```bash
npm run dev:web        # 浏览器
npm run dev:pages      # 同时开着它，用 fjs go 在手机上看
```

## 1. 生成页面

```bash
npx fjs create page todo/[id] --title 待办详情
```

这会创建 `src/pages/todo/[id].vue`，对应路由 `/todo/:id`。命令会打印出实际解析到的路由，和构建时看到的完全一致。

`fjs g` 是 `fjs create` 只生成文件时的简写：`fjs g page about` 与 `fjs create page about` 相同。

## 2. 一个共享的 store

两个页面要共享待办数据。先用最简单的办法：一个模块级的 `reactive`。

```ts
// src/store/todos.ts
import { reactive } from 'vue';

export interface Todo { id: number; title: string; done: boolean }

export const todos = reactive<Todo[]>([
  { id: 1, title: '读完快速开始', done: true },
  { id: 2, title: '写第一个页面', done: false },
]);

export function addTodo(title: string) {
  todos.push({ id: Date.now(), title, done: false });
}
```

::: tip
分包构建时，被多个页面引用的模块会自动进入共享 chunk，所以这里的 `todos` 在所有页面之间是同一份。需要更正式的状态管理就用 pinia，见[添加插件](./plugins)。
:::

## 3. 抽一个组件

```vue
<!-- src/components/TodoItem.vue -->
<script setup lang="ts">
import type { Todo } from '@/store/todos';

defineProps<{ todo: Todo }>();
defineEmits<{ toggle: []; open: [] }>();
</script>

<template>
  <view class="item">
    <checkbox :value="todo.done" @value-changed="$emit('toggle')" />
    <text :class="['title', { done: todo.done }]" @tap="$emit('open')">{{ todo.title }}</text>
  </view>
</template>

<style scoped>
.item {
  flex-direction: row;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  background-color: #fff;
}
.title { flex-grow: 1; font-size: 16px; color: #111; }
.title:active { opacity: 0.6; }
.title.done { color: #999; text-decoration: line-through; }
</style>
```

几点和浏览器开发不一样的地方：

- **`view` 默认是纵向 flex**（相当于 `display: flex; flex-direction: column`），要横排写 `flex-direction: row`。
- **事件用 `@tap`**（`@click` 也可以，是同一个事件）。
- 控件的变更事件是 `@value-changed`，载荷**一律是字符串**（checkbox 是 `"1"` / `"0"`）。
- `:active` 按压态由 Flutter 侧直接切换，不经过 JS，按下即亮。

`@/` 是指向 `src/` 的别名，构建和编辑器都认识。

## 4. 首页

```vue
<!-- src/pages/index.vue -->
<route>
{"title": "待办"}
</route>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'fjs/router';
import { todos, addTodo } from '@/store/todos';
import TodoItem from '@/components/TodoItem.vue';

const router = useRouter();
const draft = ref('');

function submit() {
  const title = draft.value.trim();
  if (!title) return;
  addTodo(title);
  draft.value = '';
}
</script>

<template>
  <view class="page">
    <view class="bar">
      <input
        class="input"
        placeholder="要做点什么？"
        :value="draft"
        @text-changed="(t: string) => (draft = t)"
        @submit="submit"
      />
      <button type="primary" size="mini" @tap="submit">添加</button>
    </view>

    <TodoItem
      v-for="t in todos"
      :key="t.id"
      :todo="t"
      @toggle="t.done = !t.done"
      @open="router.push({ name: 'todo-id', params: { id: t.id } })"
    />
  </view>
</template>

<style scoped>
.page { flex-grow: 1; gap: 1px; background-color: #f2f2f2; }
.bar { flex-direction: row; align-items: center; gap: 8px; padding: 12px 16px; background-color: #fff; }
.input { flex-grow: 1; height: 36px; }
</style>
```

::: warning v-model 不可用
Vue 的 `v-model` 指令是为 DOM 写的，在 Flutter 上不可用。输入框用 `:value` + `@text-changed` 这一对替代，效果相同。
:::

路由名 `todo-id` 是从文件路径推出来的（`todo/[id].vue` → `todo-id`）。不确定时运行 `npx fjs routes` 查看完整路由表。写错名字会直接得到类型错误，因为工具链生成了 `src/fjs-routes.d.ts`。

## 5. 详情页

```vue
<!-- src/pages/todo/[id].vue -->
<route>
{"title": "待办详情"}
</route>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'fjs/router';
import { todos } from '@/store/todos';

const route = useRoute();
const router = useRouter();

// route 是响应式的：用 computed 派生，别在 setup 里解构
const todo = computed(() => todos.find((t) => t.id === Number(route.params.id)));
</script>

<template>
  <view class="page">
    <template v-if="todo">
      <text class="title">{{ todo.title }}</text>
      <view class="row">
        <text>已完成</text>
        <switch :value="todo.done" @value-changed="(v: string) => (todo!.done = v === '1')" />
      </view>
    </template>
    <text v-else>没有这条待办</text>
    <button @tap="router.back()">返回</button>
  </view>
</template>

<style scoped>
.page { flex-grow: 1; gap: 16px; padding: 24px; }
.title { font-size: 22px; font-weight: 600; }
.row { flex-direction: row; align-items: center; justify-content: space-between; }
</style>
```

在 App 上，`router.push` 打开的是一个**真正的原生页面**：iOS 可以边缘右滑返回，Android 响应系统返回键。`route.params` 的值**永远是字符串**，要数字自己转。

## 6. 多端看一眼

- 浏览器：`npm run dev:web` 已经在跑
- 手机：fjs go 连 `npm run dev:pages`
- 小程序：`npx fjs build --mp`，用微信开发者工具打开 `dist/mp`

同一份代码，各端行为一致。

## 你学到了

- `fjs create page` 生成页面，文件路径就是路由
- 内置标签 `view` / `text` / `input` / `button` / `checkbox` / `switch`
- `view` 默认纵向，事件载荷是字符串，用 `:value` + 事件代替 `v-model`
- `useRouter().push()` / `useRoute().params` 做跳转和取参

接下来按需阅读[页面与路由](./routing)、[内置组件](./components)、[样式](./styling)。
