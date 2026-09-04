# 军团珠宝 —— 未翻译词条清单

> 自动生成，请勿手改。生成方式：
>
> ```bash
> cd 代码扩展/poe1-passive-tree && node check_tj_i18n.js
> ```
>
> 语料来源：`国际化资料/zh-rCN/`（PoB 中文社区翻译包），经 `build_translations.py` 合并进
> `data/translations.js` 的 `jewel` / `stat` 表。补译后把新条目加进对应 CSV，重跑构建脚本即可。

## 当前状态

| 检查项 | 结果 |
|--------|------|
| 珠宝类型 / 征服者 / 替代基石名 | 全部命中 |
| 词条模板段落（逐分支逐段） | 551 / 552（99.8%） |
| 含未翻译段的词条 | 1 / 394 |

## 待补译：词条描述

列为未命中的模板段落（`{0}` 是掷值占位符）。补译时按**英文原段**做键写进 `statDescriptions.csv`，
中文里保留 `{0}` `{1}` 等占位符。

| stat id | stat index | 未命中段落 |
|---------|-----------|-----------|
| `keystone_focused_rage` | 12016 | `Skills Cost +3 Rage` |
