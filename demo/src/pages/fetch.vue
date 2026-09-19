<route>
{"title": "fetch"}
</route>

<script setup lang="ts">
// Live fetch check against two open APIs — dog.ceo (json + a real image) and
// httpbin.org (echo, status codes, delays). One source, both targets: on
// Flutter fetch() goes through the host (invokeHost -> dispatchEvent, see
// docs/jsi-and-native-modules.md), on web it forwards to the browser's.
//
// Imported from 'fjs' rather than taken off the global, which is what makes
// the two targets identical — the global fetch on web is the browser's own
// and knows nothing about `timeout`.
import { onMounted, ref } from 'vue';
import { fetch, AbortController } from 'fjs';

interface Case {
  name: string;
  run: () => Promise<string>;
}

interface Row {
  name: string;
  state: 'run' | 'pass' | 'fail';
  detail: string;
}

const DOG = 'https://dog.ceo/api/breeds/image/random';
const BIN = 'https://httpbin.org';

const rows = ref<Row[]>([]);
const running = ref(false);
const dogUrl = ref('');

function assert(ok: boolean, message: string): void {
  if (!ok) throw new Error(message);
}

const cases: Case[] = [
  {
    name: 'GET json (dog.ceo)',
    run: async () => {
      const res = await fetch(DOG);
      assert(res.ok, `status ${res.status}`);
      assert(
        (res.headers.get('content-type') ?? '').includes('json'),
        'not json',
      );
      const body = (await res.json()) as { status: string; message: string };
      assert(body.status === 'success', `status field ${body.status}`);
      assert(body.message.startsWith('https://'), 'no image url');
      dogUrl.value = body.message;
      return body.message.slice(body.message.lastIndexOf('/breeds/'));
    },
  },
  {
    name: 'GET binary (the image itself)',
    run: async () => {
      assert(dogUrl.value !== '', 'no image url from the previous case');
      const res = await fetch(dogUrl.value);
      assert(res.ok, `status ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      assert(bytes.length > 1024, `only ${bytes.length} bytes`);
      // JPEG starts FF D8 FF, PNG 89 50 4E 47 — either proves the bytes
      // survived the base64 hop unmangled
      const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
      const png = bytes[0] === 0x89 && bytes[1] === 0x50;
      assert(jpeg || png, `magic ${bytes[0]},${bytes[1]},${bytes[2]}`);
      return `${jpeg ? 'jpeg' : 'png'}, ${(bytes.length / 1024).toFixed(0)} KB`;
    },
  },
  {
    name: 'POST json body (httpbin)',
    run: async () => {
      const payload = { hello: '世界', n: 42 };
      const res = await fetch(`${BIN}/post`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      assert(res.ok, `status ${res.status}`);
      const body = (await res.json()) as { json: typeof payload };
      assert(body.json.hello === '世界', `echoed ${body.json.hello}`);
      assert(body.json.n === 42, `echoed ${body.json.n}`);
      return 'utf8 body echoed back intact';
    },
  },
  {
    name: 'request headers (httpbin)',
    run: async () => {
      const res = await fetch(`${BIN}/headers`, {
        headers: { 'X-Fjs-Test': 'hello-from-fjs' },
      });
      const body = (await res.json()) as { headers: Record<string, string> };
      const sent = body.headers['X-Fjs-Test'];
      assert(sent === 'hello-from-fjs', `server saw "${sent}"`);
      return 'custom header arrived';
    },
  },
  {
    name: '404 resolves, does not reject',
    run: async () => {
      const res = await fetch(`${BIN}/status/404`);
      assert(!res.ok, 'ok should be false');
      assert(res.status === 404, `status ${res.status}`);
      return 'status 404, ok=false';
    },
  },
  {
    name: 'timeout rejects',
    run: async () => {
      try {
        await fetch(`${BIN}/delay/5`, { timeout: 1200 });
      } catch (e) {
        return String((e as Error).message ?? e);
      }
      throw new Error('the slow request resolved');
    },
  },
  {
    name: 'abort rejects',
    run: async () => {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 300);
      try {
        await fetch(`${BIN}/delay/5`, { signal: ctrl.signal });
      } catch (e) {
        return String((e as Error).message ?? e);
      }
      throw new Error('the aborted request resolved');
    },
  },
];

async function runAll(): Promise<void> {
  if (running.value) return;
  running.value = true;
  dogUrl.value = '';
  rows.value = cases.map((c) => ({ name: c.name, state: 'run', detail: '…' }));
  for (let i = 0; i < cases.length; i++) {
    // rows are replaced, not mutated in place: the array is the reactive unit
    try {
      const detail = await cases[i].run();
      rows.value[i] = { name: cases[i].name, state: 'pass', detail };
    } catch (e) {
      rows.value[i] = {
        name: cases[i].name,
        state: 'fail',
        detail: String((e as Error).message ?? e),
      };
    }
    rows.value = [...rows.value];
  }
  running.value = false;
}

onMounted(runAll);
</script>

<template>
  <scroll-view class="page">
    <text class="title">fetch live check</text>
    <text class="sub">dog.ceo + httpbin.org · needs network</text>

    <view v-for="row in rows" :key="row.name" class="row">
      <text :class="['badge', row.state]">{{
        row.state === 'pass' ? 'PASS' : row.state === 'fail' ? 'FAIL' : '...'
      }}</text>
      <view class="rowText">
        <text class="name">{{ row.name }}</text>
        <text class="detail">{{ row.detail }}</text>
      </view>
    </view>

    <image v-if="dogUrl" class="dog" :src="dogUrl" />

    <button class="btn" @tap="runAll()">
      {{ running ? 'running…' : 'run again' }}
    </button>
  </scroll-view>
</template>

<style scoped>
.page {
  /* height:0 归零基数：内容高不能当基数（App 端不收缩，整页溢出） */
  height: 0px;
  flex-grow: 1;
  padding: 16px;
  background-color: #ffffff;
}
.title {
  font-size: 22px;
  font-weight: 700;
  color: #111827;
}
.sub {
  margin-top: 4px;
  font-size: 13px;
  color: #6b7280;
}
.row {
  flex-direction: row;
  align-items: center;
  margin-top: 12px;
}
.badge {
  width: 52px;
  padding: 3px 0;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
  text-align: center;
  color: #ffffff;
  background-color: #9ca3af;
}
.badge.pass {
  background-color: #16a34a;
}
.badge.fail {
  background-color: #dc2626;
}
.rowText {
  flex-grow: 1;
  margin-left: 10px;
}
.name {
  font-size: 14px;
  color: #111827;
}
.detail {
  margin-top: 2px;
  font-size: 12px;
  color: #6b7280;
}
.dog {
  margin-top: 16px;
  width: 260px;
  height: 180px;
  border-radius: 8px;
}
.btn {
  margin-top: 20px;
  padding: 10px 16px;
  background-color: #2563eb;
  color: #ffffff;
  border-radius: 6px;
}
</style>
