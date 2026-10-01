import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 相対パスで出力する。GitHub Pages のサブフォルダでも、ゲームサイトに渡す zip でも同じビルドが動く
  base: './',
  build: { target: 'es2022' },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
