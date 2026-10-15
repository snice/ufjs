// Made-up catalogue. Names, developers and copy are invented and the "icons"
// are gradient + emoji placeholders: no Apple (or third-party) artwork or
// trademarks are bundled (specs/217 non-goals).

export interface AppItem {
  id: string;
  name: string;
  subtitle: string;
  developer: string;
  category: string;
  /** 'linear-gradient(...)' string used for the icon and the detail cover */
  gradient: string;
  emoji: string;
  rating: number;
  ratings: string;
  age: string;
  rank: string;
  version: string;
  notes: string;
  /** Initial install state: owned on iCloud / already installed / not owned */
  initial: 'none' | 'cloud' | 'installed';
  inApp: boolean;
}

const g = (a: string, b: string) => `linear-gradient(135deg, ${a}, ${b})`;

export const APPS: AppItem[] = [
  {
    id: 'kitty', name: '小猫咪大城市', subtitle: '休闲猫咪冒险游戏', developer: 'Paw Studio',
    category: '游戏', gradient: g('#2b2b3a', '#7a4a8a'), emoji: '🐈‍⬛', rating: 4.8, ratings: '2.1 万个评分',
    age: '4+', rank: '#3', version: '1.4.0', notes: '新增雨天场景，修复若干崩溃问题。', initial: 'none', inApp: true,
  },
  {
    id: 'spark', name: 'Spark 助手', subtitle: '你的日常 AI 助理', developer: 'Spark Labs',
    category: '效率', gradient: g('#4285f4', '#ea4335'), emoji: '✨', rating: 4.7, ratings: '98 万个评分',
    age: '12+', rank: '#1', version: '3.2.1', notes: '更快的回复，改进了长对话的稳定性。', initial: 'installed', inApp: false,
  },
  {
    id: 'chatly', name: 'Chatly', subtitle: '你的 AI 聊天伙伴', developer: 'Chatly Inc.',
    category: '效率', gradient: g('#10a37f', '#0b6e57'), emoji: '💬', rating: 4.6, ratings: '51 万个评分',
    age: '12+', rank: '#2', version: '2.9.0', notes: '性能优化与错误修复。', initial: 'installed', inApp: false,
  },
  {
    id: 'canvas', name: '画板 Canvas', subtitle: '海报、简历、视频一键制作', developer: 'Canvas Works',
    category: '图形和设计', gradient: g('#00c4cc', '#7d2ae8'), emoji: '🎨', rating: 4.8, ratings: '120 万个评分',
    age: '4+', rank: '#5', version: '5.1.0', notes: '新增模板与批量导出。', initial: 'cloud', inApp: true,
  },
  {
    id: 'owl', name: '绿猫头鹰学语言', subtitle: '玩着就能学 40 门外语', developer: 'Owl Learn',
    category: '教育', gradient: g('#58cc02', '#2f8f00'), emoji: '🦉', rating: 4.8, ratings: '86 万个评分',
    age: '4+', rank: '#4', version: '8.7.0', notes: '每日任务更新。', initial: 'none', inApp: true,
  },
  {
    id: 'nova', name: 'Nova 日历', subtitle: '把时间排得明明白白', developer: 'Nova Apps',
    category: '效率', gradient: g('#ff9f0a', '#ff375f'), emoji: '📅', rating: 4.5, ratings: '3.4 万个评分',
    age: '4+', rank: '#12', version: '2.3.4', notes: '支持小组件与快捷指令。', initial: 'none', inApp: false,
  },
  {
    id: 'beat', name: '节拍盒子', subtitle: '随手做出一首歌', developer: 'BeatBox Co.',
    category: '音乐', gradient: g('#ff375f', '#8e1ea8'), emoji: '🎧', rating: 4.6, ratings: '7.2 万个评分',
    age: '4+', rank: '#8', version: '4.0.2', notes: '新增 20 个音色包。', initial: 'none', inApp: true,
  },
  {
    id: 'trek', name: '山径 Trek', subtitle: '徒步路线与离线地图', developer: 'Trail Co.',
    category: '健康健美', gradient: g('#34c759', '#0a7d4a'), emoji: '🥾', rating: 4.9, ratings: '9.1 万个评分',
    age: '4+', rank: '#2', version: '6.2.0', notes: '离线地图体积减小 30%。', initial: 'cloud', inApp: true,
  },
  {
    id: 'pixel', name: 'Pixel 工坊', subtitle: '像素画与动图编辑', developer: 'Pixel Forge',
    category: '摄影与录像', gradient: g('#5e5ce6', '#0a84ff'), emoji: '🖼️', rating: 4.4, ratings: '1.8 万个评分',
    age: '4+', rank: '#21', version: '1.9.0', notes: '新增图层混合模式。', initial: 'none', inApp: false,
  },
  {
    id: 'dash', name: '极速跑酷', subtitle: '无尽奔跑，挑战极限', developer: 'Dash Games',
    category: '游戏', gradient: g('#ff453a', '#ff9f0a'), emoji: '🏃', rating: 4.3, ratings: '15 万个评分',
    age: '9+', rank: '#6', version: '3.5.1', notes: '新增赛季通行证。', initial: 'none', inApp: true,
  },
  {
    id: 'puzzle', name: '方块大师', subtitle: '轻松又上头的益智游戏', developer: 'Block Lab',
    category: '游戏', gradient: g('#64d2ff', '#5e5ce6'), emoji: '🧩', rating: 4.7, ratings: '33 万个评分',
    age: '4+', rank: '#7', version: '2.0.8', notes: '新增 100 个关卡。', initial: 'none', inApp: true,
  },
  {
    id: 'garden', name: '口袋花园', subtitle: '种花、装饰、慢慢来', developer: 'Garden Tales',
    category: '游戏', gradient: g('#ffd60a', '#30d158'), emoji: '🌻', rating: 4.6, ratings: '12 万个评分',
    age: '4+', rank: '#11', version: '1.2.3', notes: '新增秋季主题。', initial: 'cloud', inApp: true,
  },
];

export const appById = (id: string): AppItem | undefined => APPS.find((a) => a.id === id);
export const appsOf = (ids: string[]): AppItem[] =>
  ids.map(appById).filter((a): a is AppItem => !!a);
