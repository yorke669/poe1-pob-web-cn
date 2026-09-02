# poe1-pob-web-cn

这是 [Path of Building](https://pathofbuilding.community/) 的浏览器版本。

本项目来源于 [atty303/pob-web](https://github.com/atty303/pob-web)。在原项目的浏览器运行能力基础上，本仓库增加了面向国服使用场景的中文翻译层，以及用于快速获取构筑属性和装备对比结果的接口。中文翻译数据来源于 [Chuanhsing/PoeCharm](https://github.com/Chuanhsing/PoeCharm)。

## 本项目怎么用

本仓库保留原项目主体结构，额外维护的定制功能集中放在 `代码扩展/code/`。

如果你要迁移、升级或参考本项目的改动，让 AI 先读取 `代码扩展/code/` 目录即可。该目录的 `README.md` 已经说明清楚：自定义文件放在哪里、哪些文件需要打补丁、如何重新构建和验证。AI 按里面的说明自动修改即可。

重点关注两类定制能力：

1. **国服中文翻译**：让 PoE1 的界面、物品、词条、提示信息等尽量显示为中文。
2. **快速获取对比信息的接口**：用于快速获取当前构筑属性、装备替换前后差异等 JSON 信息，方便自动化对比、前端展示或二次开发。

## 原项目功能与开发说明

基础功能、限制、开发流程、架构和内部实现请参考原项目：

```text
https://github.com/atty303/pob-web
```
