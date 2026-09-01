# 脚本说明

本目录包含用于替代 mise 任务的独立脚本，**仅用于 macOS Intel（darwin/amd64）平台**。

## 为什么需要这些脚本？

**macOS Intel 平台限制**：
- hk 工具（Git hooks 管理器）的最新版本（1.54.1+）**不支持 macOS Intel（darwin/amd64）**
- 只支持：darwin/arm64（Apple Silicon）、linux、windows
- 因此无法使用 `mise run` 命令，需要替代脚本

**Ubuntu / Linux 平台**：
- ✅ hk 工具完全支持 Linux
- ✅ 可以直接使用 `mise run` 命令
- ❌ **不需要**这些替代脚本
- 请参考 [Ubuntu开发部署手册](../Ubuntu开发部署手册.md)

## 脚本列表

### driver-build.sh - 编译 Wasm Driver

**用途**：使用 Emscripten 编译 driver 包的 WebAssembly 模块。

**使用方法**：
```bash
./driver-build.sh [--kind <debug|release|all>]
```

**参数**：
- `--kind <kind>`：构建类型，可选值：`debug`、`release`、`all`（默认：`all`）

**示例**：
```bash
# 同时构建 debug 和 release
./driver-build.sh

# 只构建 debug 版本
./driver-build.sh --kind debug

# 只构建 release 版本
./driver-build.sh --kind release
```

**输出位置**：
```
packages/driver/dist/debug/     driver.mjs + driver.wasm（-O0 -g3，开启 ASSERTIONS/SAFE_HEAP）
packages/driver/dist/release/   driver.mjs + driver.wasm + driver.wasm.debug.wasm（-O3，LTO，mimalloc）
```

**前置条件**：
1. 已安装 mise 并配置 shell 集成
2. 已运行 `mise run setup` 安装依赖
3. 已安装 emsdk、cmake、ninja（通过 mise 自动安装）

**Debug vs Release**：
- **Debug**：优化级别 `-O0 -g3`，开启断言和堆检查，适合调试
- **Release**：优化级别 `-O3`，开启 LTO 和 mimalloc，生成独立调试符号文件，适合生产

---

### driver-dev.sh - 启动 Driver 开发服务器

**用途**：启动 driver 包的开发服务器，用于本地开发和调试。

**使用方法**：
```bash
./driver-dev.sh [--game <game>] [--version <version>] [--build <debug|release>] [--pob-cool-asset]
```

**参数**：
- `--game <game>`：游戏名称（poe1、poe2、le），默认：poe2
- `--version <version>`：游戏版本，例如：v2.67.2、v0.23.1
- `--build <build>`：构建类型（debug、release），默认：release
- `--pob-cool-asset`：使用线上 CDN 资源替代本地打包

**示例**：
```bash
# 启动 POE1 v2.67.2 debug 版本
./driver-dev.sh --game poe1 --version v2.67.2 --build debug

# 启动 POE2 v0.23.1 release 版本
./driver-dev.sh --game poe2 --version v0.23.1

# 使用线上 CDN 资源
./driver-dev.sh --game poe1 --pob-cool-asset
```

**前置条件**：
1. 已打包资源（运行 `pack.sh`）或使用 `--pob-cool-asset`
2. 已编译 Wasm（运行 `driver-build.sh`）

**说明**：
- 开发服务器会自动监听文件变化并热重载
- 端口是动态分配的，从终端输出中找到 `Local: http://127.0.0.1:xxxx/`
- 只修改 `packages/driver/src/js/**` 文件时，HMR 会直接生效，无需重新编译 Wasm

---

### pack.sh - 打包上游资源

**用途**：从 GitHub 克隆指定游戏的上游仓库，处理并打包资源文件。

**使用方法**：
```bash
./pack.sh --game <game> --tag <tag>
```

**参数**：
- `--game <game>`：游戏名称，可选值：`poe1`、`poe2`、`le`
- `--tag <tag>`：上游版本标签，例如：`v2.67.2`、`v0.23.1`

**示例**：
```bash
# 打包 POE1 v2.67.2
./pack.sh --game poe1 --tag v2.67.2

# 打包 POE2 v0.23.1
./pack.sh --game poe2 --tag v0.23.1

# 打包 Last Epoch v0.12.0
./pack.sh --game le --tag v0.12.0
```

**输出位置**：
```
packages/packer/r2/games/<game>/versions/<tag>/
├── root.zip          # Lua、配置等（打进 zip 供 zenfs 只读挂载）
└── root/             # 图片、DDS 纹理（走 HTTP 单独加载）
```

**前置条件**：
1. 已安装 mise 并配置 shell 集成
2. 已运行 `mise run setup` 安装依赖
3. 已安装 deno（通过 mise 自动安装）

**为什么需要这个脚本？**

原命令 `mise run pack` 依赖 `hk` 工具，但 `hk` 的最新版本（1.54.1+）不支持 macOS Intel（darwin/amd64）平台。此脚本直接调用 deno 命令，绕过 mise 和 hk 的限制。

## 相关文档

- [本地开发手册](../本地开发手册.md) - 完整的开发环境配置指南
- [工具介绍](../工具介绍.md) - 项目工具链说明