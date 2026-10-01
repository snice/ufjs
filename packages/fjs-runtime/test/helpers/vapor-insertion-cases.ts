// specs/169: dynamic blocks (v-if / v-for / component) sharing a parent with
// static siblings, in either order. compiler-vapor gives a block in the
// middle a `<!>` placeholder node anchor and a trailing block a NUMBER (its
// logical index, which client render treats as "append"). Shared by the web
// (DOM backend) and Flutter test files; each case is checked as the text the
// page shows, in document order, after mount and after every step.

export interface InsertionState {
  show: boolean;
  rows: string[];
  s: number;
}

export interface InsertionCase {
  name: string;
  source: string;
  /** expected text before any step */
  mount: string;
  steps: { run: (st: InsertionState) => void; text: string }[];
}

const script = `
<script setup>
import st from 'st'
import Child from 'child'
</script>`;

export const CHILD = `
<script setup>
const x = 1
</script>
<template><text>C</text></template>`;

export const initialState = (): InsertionState => ({ show: true, rows: ['a', 'b'], s: 0 });

const flip = { run: (st: InsertionState) => { st.show = !st.show; st.rows.push('c'); st.s++; } };

export const INSERTION_CASES: InsertionCase[] = [
  {
    name: 'v-if in the middle, v-for trailing',
    source: `${script}
<template><view><text>T</text><text>{{ st.s }}</text><text v-if="st.show">H</text><text v-else>E</text><text>S{{ st.s }}</text><text>N</text><view v-for="(r, i) in st.rows" :key="i"><text>{{ r }}</text></view></view></template>`,
    mount: 'T0HS0Nab',
    steps: [
      { ...flip, text: 'T1ES1Nabc' },
      { ...flip, text: 'T2HS2Nabcc' },
    ],
  },
  {
    name: 'v-for in the middle, v-if trailing',
    source: `${script}
<template><view><text>T</text><view v-for="(r, i) in st.rows" :key="i"><text>{{ r }}</text></view><text>N</text><text v-if="st.show">H</text><text v-else>E</text></view></template>`,
    mount: 'TabNH',
    steps: [
      { ...flip, text: 'TabcNE' },
      { ...flip, text: 'TabccNH' },
    ],
  },
  {
    name: 'v-if, component and v-for all trailing',
    source: `${script}
<template><view><text>T</text><text v-if="st.show">H</text><Child /><view v-for="(r, i) in st.rows" :key="i"><text>{{ r }}</text></view></view></template>`,
    mount: 'THCab',
    steps: [
      { ...flip, text: 'TCabc' },
      { ...flip, text: 'THCabcc' },
    ],
  },
  {
    name: 'component in the middle, v-for then v-if trailing',
    source: `${script}
<template><view><Child /><text>M{{ st.s }}</text><view v-for="(r, i) in st.rows" :key="i"><text>{{ r }}</text></view><text v-if="st.show">H</text></view></template>`,
    mount: 'CM0abH',
    steps: [
      { ...flip, text: 'CM1abc' },
      { ...flip, text: 'CM2abccH' },
    ],
  },
  {
    name: 'only dynamic children: v-if, v-for, component',
    source: `${script}
<template><view><text v-if="st.show">H</text><text v-else>E</text><view v-for="(r, i) in st.rows" :key="i"><text>{{ r }}</text></view><Child /></view></template>`,
    mount: 'HabC',
    steps: [
      { ...flip, text: 'EabcC' },
      { ...flip, text: 'HabccC' },
    ],
  },
  {
    name: 'v-for and component in the middle, v-if starts hidden',
    source: `${script}
<template><view><text>A</text><text v-if="!st.show">H</text><text>B</text><view v-for="(r, i) in st.rows" :key="i"><text>{{ r }}</text></view><Child /><text>Z{{ st.s }}</text></view></template>`,
    mount: 'ABabCZ0',
    steps: [
      { ...flip, text: 'AHBabcCZ1' },
      { ...flip, text: 'ABabccCZ2' },
    ],
  },
];
