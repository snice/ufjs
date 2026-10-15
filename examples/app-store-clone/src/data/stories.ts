// Today / featured content. Same rule as apps.ts: invented copy, gradient and
// emoji stand-ins for artwork.

export interface Story {
  id: string;
  kicker: string;
  title: string;
  subtitle: string;
  gradient: string;
  emoji: string;
  body: string;
  /** Apps listed at the bottom of the expanded story */
  appIds: string[];
}

const g = (a: string, b: string) => `linear-gradient(160deg, ${a}, ${b})`;

export const STORIES: Story[] = [
  {
    id: 'cat',
    kicker: '独立游戏周',
    title: "This cat's ready to play",
    subtitle: 'Explore a cosy city as you guide a furry feline home.',
    gradient: g('#6d5fd0', '#2a2550'),
    emoji: '🐈‍⬛',
    body:
      '在一座温暖的小城里，你要带着一只迷路的黑猫回家。穿过屋顶、集市和雨后的街道，' +
      '每一个转角都有新的小惊喜。\n\n这一周，我们收集了几款同样让人安心的独立游戏，适合在通勤路上慢慢玩。',
    appIds: ['kitty', 'puzzle', 'garden'],
  },
  {
    id: 'popular',
    kicker: '时下热门',
    title: '试试这些人气 iPhone App',
    subtitle: '从 AI 助理到效率工具，看看大家都在用什么。',
    gradient: g('#ff9f0a', '#ff375f'),
    emoji: '🔥',
    body: '本周下载量增长最快的一批 App：它们也许正好能帮你省下一点时间。',
    appIds: ['spark', 'chatly', 'canvas', 'owl', 'nova', 'beat'],
  },
];

export interface Featured {
  kicker: string;
  title: string;
  subtitle: string;
  gradient: string;
  emoji: string;
  /** Optional app strip on the card */
  appId?: string;
}

export const GAME_FEATURED: Featured[] = [
  { kicker: '独立游戏周', title: 'Play an Indie Gem', subtitle: 'Celebrate Indie Games Week', gradient: g('#0f3d3e', '#7a1f4a'), emoji: '💎' },
  { kicker: '本周精选', title: '换个姿势玩游戏', subtitle: '轻松上手，一玩就停不下来', gradient: g('#5e5ce6', '#0a84ff'), emoji: '🎮' },
  { kicker: '新游预告', title: '即将上线', subtitle: '提前预约，上线第一时间提醒你', gradient: g('#ff453a', '#ff9f0a'), emoji: '🚀' },
];

export const APP_FEATURED: Featured[] = [
  { kicker: '现已推出', title: 'Plan Spooky Season With Spark', subtitle: 'From Halloween costumes to decor', gradient: g('#ffb199', '#ff0844'), emoji: '🎃', appId: 'spark' },
  { kicker: '效率达人', title: '让每一天都井井有条', subtitle: '日历、待办与笔记的最佳搭档', gradient: g('#a1c4fd', '#c2e9fb'), emoji: '🗓️', appId: 'nova' },
  { kicker: '创作灵感', title: '一个人也能做出大片', subtitle: '剪辑、配乐、海报全搞定', gradient: g('#f093fb', '#f5576c'), emoji: '🎬', appId: 'canvas' },
];

export const GAME_CHIPS = ['独立', '体育', '策略', '益智解谜', '动作', '模拟'];
export const APP_CHIPS = ['健康健美', 'AR App', '音乐', '娱乐', '教育', '效率'];
export const ARCADE_CHIPS = ['所有游戏', 'Word', 'Adventure', 'Puzzle', 'Racing'];

export const BROWSE = [
  { title: '热门下载 App', gradient: g('#a1c4fd', '#5b8def'), emoji: '🏆' },
  { title: '热门下载游戏', gradient: g('#fbc2a0', '#f08a4b'), emoji: '🏆' },
  { title: '畅销 App', gradient: g('#a8e6a1', '#4fb36a'), emoji: '🥇' },
  { title: '畅销游戏', gradient: g('#b8a9ff', '#7a5cff'), emoji: '🥇' },
  { title: '新上架', gradient: g('#bfd9ff', '#7fb2ff'), emoji: '✈️' },
  { title: '编辑精选', gradient: g('#ffd9a0', '#ffad4d'), emoji: '📖' },
];
