// A pinia store in an enableVapor app (specs/167): installed through
// `setup(app)` on the app shell, read from vapor pages like anywhere else.
import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useCounter = defineStore('counter', () => {
  const total = ref(0);
  const ticks = ref(0);
  /** set by the home page's onMounted — the check harness reads it */
  const mounted = ref(false);
  const add = () => {
    total.value++;
  };
  const tick = () => {
    ticks.value++;
  };
  return { total, ticks, mounted, add, tick };
});
