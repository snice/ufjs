<route>
{"title": "WebGL 实例化", "group": "画布演示", "desc": "drawElementsInstanced / drawArraysInstanced，一次调用画一组"}
</route>

<script setup lang="ts">
// Instanced draws (spec 033), hand-written GL so each command has exactly one
// visible call site: the grid of squares is ONE drawElementsInstanced, the
// row of triangles is ONE drawArraysInstanced. Position and color are
// per-instance attributes (divisor 1); the pulse is a single uniform, so the
// instance buffers are uploaded once and never touched again.
//
// Instancing is WebGL2 core. A webgl1 fallback context has no such methods on
// either end (ANGLE_instanced_arrays is not offered, getExtension stays
// null), so the page checks for the method and says so instead of throwing.
import { onActivated, onDeactivated, onUnmounted, ref } from 'vue';
import '@ufjs/webgl';
import type { FjsWebGLRenderingContextWithConstants } from '@ufjs/webgl';
import type { FjsCanvasApi } from 'fjs';
import Panel from '@/components/Panel.vue';

defineOptions({ name: 'WebglInstancedPage' });

type Gl = FjsWebGLRenderingContextWithConstants;
type UniformLoc = ReturnType<Gl['getUniformLocation']>;
type Buffer = ReturnType<Gl['createBuffer']>;

const GRID_COLS = 10;
const GRID_ROWS = 6;
const ROW = 12;

const cv = ref<FjsCanvasApi>();
const status = ref('等待画布…');

// GLSL ES 1.00: valid in a WebGL2 context too, and the same source the
// triangle page uses, so this page tests instancing and nothing else
const VS = `
attribute vec2 aPos;
attribute vec2 aOffset;
attribute vec3 aColor;
uniform float uTime;
uniform float uScale;
uniform float uAspect;
varying vec3 vColor;
void main() {
  // each instance pulses on its own phase, taken from its offset
  float pulse = 0.6 + 0.4 * sin(uTime * 3.0 + aOffset.x * 4.0 + aOffset.y * 3.0);
  vec2 p = aPos * uScale * pulse;
  gl_Position = vec4(aOffset.x + p.x * uAspect, aOffset.y + p.y, 0.0, 1.0);
  vColor = aColor;
}`;

const FS = `
precision mediump float;
varying vec3 vColor;
void main() {
  gl_FragColor = vec4(vColor, 1.0);
}`;

const QUAD = new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]);
const QUAD_INDEX = new Uint16Array([0, 1, 2, 0, 2, 3]);
const TRIANGLE = new Float32Array([0, 1, -0.87, -0.5, 0.87, -0.5]);
/** Interleaved per-instance record: vec2 offset + vec3 color. */
const STRIDE = 5 * 4;

/** HSV(h, 0.65, 0.95) → linear-ish rgb; enough for a rainbow. */
function hue(h: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h * 6) % 6;
    return 0.95 - 0.95 * 0.65 * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)];
}

function gridInstances(): Float32Array {
  const out = new Float32Array(GRID_COLS * GRID_ROWS * 5);
  let o = 0;
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      const x = -0.82 + (c / (GRID_COLS - 1)) * 1.64;
      const y = 0.85 - (r / (GRID_ROWS - 1)) * 0.95;
      out.set([x, y, ...hue((c + r) / (GRID_COLS + GRID_ROWS))], o);
      o += 5;
    }
  }
  return out;
}

function rowInstances(): Float32Array {
  const out = new Float32Array(ROW * 5);
  for (let i = 0; i < ROW; i++) {
    out.set([-0.84 + (i / (ROW - 1)) * 1.68, -0.62, ...hue(i / ROW)], i * 5);
  }
  return out;
}

let gl: Gl | null = null;
let raf = 0;
let aPos = -1;
let aOffset = -1;
let aColor = -1;
let uTime: UniformLoc = null;
let uScale: UniformLoc = null;
let uAspect: UniformLoc = null;
let quadVbo: Buffer | null = null;
let quadIbo: Buffer | null = null;
let triVbo: Buffer | null = null;
let gridInst: Buffer | null = null;
let rowInst: Buffer | null = null;

function compile(g: Gl, type: number, source: string): ReturnType<Gl['createShader']> | null {
  const shader = g.createShader(type);
  g.shaderSource(shader, source);
  g.compileShader(shader);
  if (!g.getShaderParameter(shader, g.COMPILE_STATUS)) {
    status.value = `着色器编译失败：${g.getShaderInfoLog(shader)}`;
    return null;
  }
  return shader;
}

function staticBuffer(g: Gl, target: number, data: Float32Array | Uint16Array): Buffer {
  const buffer = g.createBuffer();
  g.bindBuffer(target, buffer);
  g.bufferData(target, data, g.STATIC_DRAW);
  return buffer;
}

/** Point the shared attributes at one shape + its instance buffer. There is
 * no VAO here on purpose: re-pointing per draw keeps the page to the
 * commands spec 033 is about plus the ones 021 already carried. */
function bindShape(g: Gl, shape: Buffer | null, instances: Buffer | null): void {
  g.bindBuffer(g.ARRAY_BUFFER, shape);
  g.vertexAttribPointer(aPos, 2, g.FLOAT, false, 0, 0);
  g.vertexAttribDivisor(aPos, 0);
  g.bindBuffer(g.ARRAY_BUFFER, instances);
  g.vertexAttribPointer(aOffset, 2, g.FLOAT, false, STRIDE, 0);
  g.vertexAttribPointer(aColor, 3, g.FLOAT, false, STRIDE, 8);
  g.vertexAttribDivisor(aOffset, 1);
  g.vertexAttribDivisor(aColor, 1);
}

function frame(now: number): void {
  raf = requestAnimationFrame(frame);
  const g = gl;
  if (!g) return;
  g.clear(g.COLOR_BUFFER_BIT);
  g.uniform1f(uTime, now / 1000);

  bindShape(g, quadVbo, gridInst);
  g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, quadIbo);
  g.uniform1f(uScale, 0.055);
  g.drawElementsInstanced(g.TRIANGLES, QUAD_INDEX.length, g.UNSIGNED_SHORT, 0, GRID_COLS * GRID_ROWS);

  bindShape(g, triVbo, rowInst);
  g.uniform1f(uScale, 0.1);
  g.drawArraysInstanced(g.TRIANGLES, 0, 3, ROW);
}

function start(): void {
  if (!gl || raf) return;
  raf = requestAnimationFrame(frame);
}

function stop(): void {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}

function onResize(): void {
  const instance = cv.value;
  if (!instance) return;
  if (gl) {
    // later resizes: the buffer changed size, the scene did not
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.uniform1f(uAspect, gl.canvas.height / (gl.canvas.width || 1));
    return;
  }

  const g = (instance.getContext('webgl2') ?? instance.getContext('webgl')) as Gl | null;
  if (!g) {
    status.value = '此环境没有 WebGL';
    return;
  }
  if (typeof (g as { drawArraysInstanced?: unknown }).drawArraysInstanced !== 'function') {
    status.value = '当前 context 不支持实例化绘制（需要 WebGL2）';
    return;
  }

  const vs = compile(g, g.VERTEX_SHADER, VS);
  const fs = compile(g, g.FRAGMENT_SHADER, FS);
  if (!vs || !fs) return;
  const program = g.createProgram();
  g.attachShader(program, vs);
  g.attachShader(program, fs);
  g.linkProgram(program);
  if (!g.getProgramParameter(program, g.LINK_STATUS)) {
    status.value = `链接失败：${g.getProgramInfoLog(program)}`;
    return;
  }
  g.useProgram(program);

  aPos = g.getAttribLocation(program, 'aPos');
  aOffset = g.getAttribLocation(program, 'aOffset');
  aColor = g.getAttribLocation(program, 'aColor');
  g.enableVertexAttribArray(aPos);
  g.enableVertexAttribArray(aOffset);
  g.enableVertexAttribArray(aColor);
  uTime = g.getUniformLocation(program, 'uTime');
  uScale = g.getUniformLocation(program, 'uScale');
  uAspect = g.getUniformLocation(program, 'uAspect');

  quadVbo = staticBuffer(g, g.ARRAY_BUFFER, QUAD);
  triVbo = staticBuffer(g, g.ARRAY_BUFFER, TRIANGLE);
  gridInst = staticBuffer(g, g.ARRAY_BUFFER, gridInstances());
  rowInst = staticBuffer(g, g.ARRAY_BUFFER, rowInstances());
  quadIbo = staticBuffer(g, g.ELEMENT_ARRAY_BUFFER, QUAD_INDEX);

  g.clearColor(0.08, 0.09, 0.1, 1.0);
  g.viewport(0, 0, g.canvas.width, g.canvas.height);
  g.uniform1f(uAspect, g.canvas.height / (g.canvas.width || 1));

  gl = g;
  status.value =
    `上：${GRID_COLS * GRID_ROWS} 个方块，一次 drawElementsInstanced\n` +
    `下：${ROW} 个三角形，一次 drawArraysInstanced`;
  start();
}

// keep-alive route: no frame callbacks while the page is off screen
onActivated(start);
onDeactivated(stop);
onUnmounted(stop);
</script>

<template>
  <Panel title="实例化绘制" desc="每组图形一次 draw call，位置和颜色走 divisor=1 的实例属性">
    <canvas ref="cv" class="gl" @resize="onResize" />
    <text class="tip">{{ status }}</text>
  </Panel>
</template>

<style scoped>
.gl {
  width: 300px;
  height: 220px;
  border-radius: 8px;
}
.tip {
  font-size: 12px;
  color: #888;
  margin-top: 8px;
  line-height: 1.6;
}
</style>
