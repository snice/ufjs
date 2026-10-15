import { defineConfig } from '@ufjs/cli/config';

export default defineConfig({
    version: '1.0.0+1',
    orientation: 'portrait',
    android: {
        permissions: ['android.permission.INTERNET']
    },
});
