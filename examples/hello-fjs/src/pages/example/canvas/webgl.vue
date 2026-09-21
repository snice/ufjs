<route>
{"title": "WebGL 三角形", "group": "画布演示"}
</route>

<script setup lang="ts">
// webgl：两端同一份 GL 代码。App 侧 GL 调用编码成指令流（op 11）交给
// Flutter 经 ANGLE 执行，web 侧就是浏览器原生 context——同一页面在两端
// 应当画出同样的旋转三角形。
import { ref } from 'vue';
// WebGL 是模块(spec 022):import 即把 'webgl'/'webgl2' 注册进 runtime 的
// context 注册表;不 import 的页面两端都是 null + 一条告警。
import '@ufjs/webgl';
import type { FjsWebGLRenderingContextWithConstants } from '@ufjs/webgl';
import type { FjsCanvasApi } from 'fjs';
import Panel from '@/components/Panel.vue';

defineOptions({ name: 'WebglPage' });

type Gl = FjsWebGLRenderingContextWithConstants;

const cv = ref();
const shown = ref(false);

// 顶点着色器：把 2D 坐标直接当裁剪空间坐标，旋转放进来。
// 呈现方向不在这里补偿：GL 的 bottom-up 输出由 Flutter 侧的呈现层拉平
// （spec 023），页面看到的方向两端一致。
const VS = `
attribute vec2 aPos;
uniform float uAngle;
void main() {
  float c = cos(uAngle);
  float s = sin(uAngle);
  gl_Position = vec4(aPos.x * c - aPos.y * s, aPos.x * s + aPos.y * c, 0.0, 1.0);
}`;

// 片元着色器：按位置混个色，顺便验证 varying/精度声明链路
const FS = `
precision mediump float;
void main() {
  gl_FragColor = vec4(0.03, 0.76, 0.37, 1.0);
}`;

// 单位三角形，够所有顶点落到裁剪空间里
const VERTICES = new Float32Array([0.0, 0.6, -0.6, -0.5, 0.6, -0.5]);

let gl: Gl | null = null;
let angleLoc: ReturnType<Gl['getUniformLocation']> = null;
let raf = 0;

// 方向由页面决定,uniform 每帧重算——切换即时生效,两端同步
const dir = ref(1);
const angle = ref(0);

function draw(now: number) {
  if (!gl) return;
  const period = Math.PI * 2;
  angle.value = (((dir.value * now) / 1000) % period + period) % period;
  gl.uniform1f(angleLoc, angle.value);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  raf = requestAnimationFrame(draw);
}

function flip() {
  dir.value = -dir.value;
}

function onResize() {
  // 首绘写在 @resize 里，理由与 2d 相同：onMounted 时尺寸还没量出来
  const cvv = cv.value as FjsCanvasApi | undefined;
  if (!cvv || shown.value) return;
  // 标准的 webgl2 → webgl 回落(three.js 同款):新 Chromium 只给 webgl2,
  // 老 webview 只有 webgl1;GL 代码是 GLES2 子集,两种上下文都能跑。
  gl = (cvv.getContext('webgl') ?? cvv.getContext('webgl2')) as Gl | null;
  if (!gl) return;
  shown.value = true;

  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
  gl.clearColor(0.08, 0.09, 0.1, 1.0);
  gl.enable(gl.DEPTH_TEST);

  const vs = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vs, VS);
  gl.compileShader(vs);
  if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
    console.error('[webgl] vertex:', gl.getShaderInfoLog(vs));
    return;
  }

  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(fs, FS);
  gl.compileShader(fs);
  if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
    console.error('[webgl] fragment:', gl.getShaderInfoLog(fs));
    return;
  }

  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('[webgl] link:', gl.getProgramInfoLog(program));
    return;
  }
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, VERTICES, gl.STATIC_DRAW);

  const aPos = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  angleLoc = gl.getUniformLocation(program, 'uAngle');

  // 页面坐标系是逻辑像素（见 canvas-compat），GL 用位图像素——
  // 所以 viewport 在 resize 回调里按 gl.canvas 尺寸设置
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(draw);
}
</script>

<template>
  <Panel title="WebGL" desc="同一份 GL 代码：web 原生 context，App 经 ANGLE 执行">
    <canvas ref="cv" class="gl" @resize="onResize" />
    <button class="toggle" @click="flip">切换方向</button>
    <text class="tip">绿色三角形匀速旋转</text>
  </Panel>
</template>

<style scoped>
.gl {
  width: 300px;
  height: 220px;
  border-radius: 8px;
}
.toggle {
  width: 100%;
  margin-top: 8px;
  align-self: flex-start;
}
.tip {
  font-size: 12px;
  color: #888;
  margin-top: 8px;
}
</style>
