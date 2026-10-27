/// <reference types="vite/client" />

/** CSS 模块类型声明：让 TypeScript 接受样式文件的副作用导入。 */
declare module '*.css';

/** 构建时由 vite.config.ts 注入的应用版本号，与 package.json 保持一致。 */
declare const __APP_VERSION__: string;
