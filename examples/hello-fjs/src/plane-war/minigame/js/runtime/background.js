import Sprite from '../base/sprite';
import { SCREEN_WIDTH, SCREEN_HEIGHT } from '../render';

const BACKGROUND_IMAGE_SRC = 'images/bg.jpg';
const BACKGROUND_WIDTH = 512;
const BACKGROUND_HEIGHT = 512;
const BACKGROUND_SPEED = 2;

/**
 * 游戏背景类
 * 提供 update 和 render 函数实现无限滚动的背景功能
 */
export default class BackGround extends Sprite {
  constructor() {
    super(BACKGROUND_IMAGE_SRC, BACKGROUND_WIDTH, BACKGROUND_HEIGHT);
    this.top = 0;
  }

  update() {
    if (GameGlobal.databus.isGameOver) {
      return;
    }
  
    this.top += BACKGROUND_SPEED;

    // 如果背景滚动超过屏幕高度，则重置
    if (this.top >= SCREEN_HEIGHT) {
      this.top = 0;
    }
  }

  /**
   * 背景图重绘函数
   * 绘制两张图片，两张图片大小和屏幕一致
   * 第一张漏出高度为 top 部分，其余的隐藏在屏幕上面
   * 第二张补全除了 top 高度之外的部分，其余的隐藏在屏幕下面
   */
  render(ctx) {
    // 绘制第一张背景
    ctx.drawImage(
      this.img,
      0,
      0,
      this.width,
      this.height,
      0,
      -SCREEN_HEIGHT + this.top,
      SCREEN_WIDTH,
      SCREEN_HEIGHT
    );

    // 绘制第二张背景
    ctx.drawImage(
      this.img,
      0,
      0,
      this.width,
      this.height,
      0,
      this.top,
      SCREEN_WIDTH,
      SCREEN_HEIGHT
    );
  }
}
