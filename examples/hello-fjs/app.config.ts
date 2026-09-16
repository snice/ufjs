import { defineConfig } from '@ufjs/cli/config';

export default defineConfig({
    version: '1.0.0+3',
    android: {
        permissions: ['android.permission.INTERNET']
    },
    wxmp: {
        appid: 'wx55831603b568aa90',
        // appid: 'wx1dc25387d81812b0',
        renderer: 'webview',
        "setting": {
            "es6": true,
            "postcss": false,
            "minified": true,
            "minifyWXSS": true,
            "minifyWXML": true,
        }
    }
});