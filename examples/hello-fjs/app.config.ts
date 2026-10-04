import { defineConfig } from '@ufjs/cli/config';

export default defineConfig({
    version: '1.0.0+3',
    android: {
        permissions: ['android.permission.INTERNET']
    },
    wxmp: {
        appid: 'wx55831603b568aa90',
        // appid: 'wx1dc25387d81812b0',
        // specs/208：nested-scroll 是 skyline 组件，看原生嵌套滚动要 skyline；
        // webview 构建会把它降级为 view 树（改回 'webview' 即可）
        renderer: 'skyline',
        "setting": {
            "es6": true,
            "postcss": false,
            "minified": true,
            "minifyWXSS": true,
            "minifyWXML": true,
        }
    }
});