# invasions patch 目录

本目录只保留上游已有文件的入侵修改 patch。

## 使用

```bash
cd 代码扩展/code/invasions
git apply driver.c.patch driver.ts.patch worker.ts.patch \
          OverlayContainer.tsx.patch text.ts.patch
```

`pack.ts.patch` 默认不应用，优先用翻译注入脚本替代。

`boot.lua` 不在这里维护 patch；按上级 `README.md` 的 §3，把 `boot_interface.lua` 分段插入即可。
