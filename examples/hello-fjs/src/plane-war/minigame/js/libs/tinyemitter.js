// specs/214 移植注：原文件是 UMD（现 tinyemitter.umd.cjs，字节未动）。
// 分包构建里 esbuild 对它的 CJS 探测会失灵（报 "No matching export"），
// 这里用两行 ESM 包装让游戏代码的导入路径与微信上完全一致。
import emitterFactory from "./tinyemitter.umd.cjs";
export default emitterFactory;
