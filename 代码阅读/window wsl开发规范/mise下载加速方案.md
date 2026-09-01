# Mise 下载加速方案

## 问题分析

`mise run setup` 下载工具时速度慢，主要原因是：

1. GitHub releases 下载速度慢
2. 代理带宽可能有限
3. 部分工具包较大（如 emsdk）

## 优化方案

### 方案一：配置 Git 使用 GitHub 镜像（推荐）

创建或编辑 `~/.gitconfig` 文件，添加 URL 重写规则：

```bash
# 使用 GitHub 镜像加速
git config --global url."https://ghproxy.com/https://github.com/".insteadOf "https://github.com/"
git config --global url."https://ghproxy.com/https://raw.githubusercontent.com/".insteadOf "https://raw.githubusercontent.com/"
```

**注意**：此方案仅对 Git 仓库下载有效，对 GitHub releases 下载可能无效。

### 方案二：配置 Mise 使用镜像源

Mise 支持通过环境变量配置镜像源：

```bash
# 在 ~/.bashrc 或 ~/.profile 中添加
export MISE_GITHUB_MIRROR="https://ghproxy.com"
```

或者创建 mise 配置文件：

```bash
# ~/.config/mise/config.toml
[settings]
# 配置 GitHub 镜像
github_mirror = "https://ghproxy.com"
```

### 方案三：手动下载工具（最可靠）

如果自动下载太慢，可以手动下载工具包：

1. **emsdk** (约 200MB)
   - 下载地址：https://github.com/emscripten-core/emsdk/releases
   - 手动安装：解压到 `~/.local/share/mise/installs/emsdk/`

2. **其他工具**
   - 查看下载地址：`mise ls --json`
   - 手动下载后放到对应目录

### 方案四：使用国内镜像源

部分工具有国内镜像：

```bash
# Deno 国内镜像
export DENO_INSTALL_ROOT=~/.local
export DENO_DIR=~/.cache/deno
# 使用国内镜像下载 Deno
curl -fsSL https://deno.land/install.sh | sh -s -- --version 2.9.3
```

### 方案五：并行下载（如果网络允许）

Mise 默认会并行下载多个工具，但如果网络不稳定，可以尝试：

```bash
# 设置并行下载数
export MISE_JOBS=2
mise run setup
```

## 当前项目工具列表

根据 `mise.toml`，需要下载的工具：

| 工具       | 版本   | 大小估计 | 说明                         |
| ---------- | ------ | -------- | ---------------------------- |
| deno       | 2.9.3  | ~50MB    | JavaScript/TypeScript 运行时 |
| emsdk      | 6.0.6  | ~200MB   | Emscripten SDK               |
| cmake      | 4.3.3  | ~30MB    | 构建工具                     |
| ninja      | 1.13.2 | ~1MB     | 构建系统                     |
| hk         | 1.54.1 | ~10MB    | 工具                         |
| pkl        | 0.31.0 | ~20MB    | 配置语言                     |
| actionlint | 1.7.12 | ~5MB     | GitHub Action 检查           |
| shellcheck | 0.11.0 | ~2MB     | Shell 脚本检查               |
| sentry-cli | 3.6.2  | ~15MB    | Sentry CLI                   |
| auth0-cli  | 1.32.0 | ~10MB    | Auth0 CLI                    |
| pinggy     | 0.5.1  | ~5MB     | 隧道工具                     |

**总计约 350MB**

## 推荐操作步骤

### 1. 先尝试配置镜像（快速方案）

```bash
# 配置 Git 镜像
git config --global url."https://ghproxy.com/https://github.com/".insteadOf "https://github.com/"

# 配置 Mise 镜像
export MISE_GITHUB_MIRROR="https://ghproxy.com"

# 重新运行 setup
mise run setup
```

### 2. 如果还是慢，手动下载大文件

```bash
# 查看当前下载进度
mise ls

# 手动下载 emsdk（最大的包）
cd /tmp
wget https://ghproxy.com/https://github.com/emscripten-core/emsdk/archive/refs/heads/main.tar.gz
# 或使用代理
curl -x http://127.0.0.1:7897 -O https://github.com/emscripten-core/emsdk/archive/refs/heads/main.tar.gz
```

### 3. 检查代理速度

```bash
# 测试代理速度
curl -o /dev/null -s -w 'Speed: %{speed_download} bytes/sec\n' -x http://127.0.0.1:7897 https://github.com

# 如果代理速度慢，考虑：
# - 更换代理节点
# - 使用镜像源
# - 手动下载
```

## 常见问题

### Q: 下载中断怎么办？

A: Mise 支持断点续传，重新运行 `mise run setup` 即可。

### Q: 如何查看下载进度？

A: 运行 `mise ls` 查看已安装的工具。

### Q: 如何清理失败的下载？

A: 运行 `mise cache clean` 清理缓存。

### Q: 代理配置正确但下载失败？

A: 检查代理是否支持 HTTPS，或尝试使用镜像源。

## 验证安装

安装完成后，验证所有工具：

```bash
# 检查所有工具是否安装成功
mise ls

# 验证关键工具
deno --version
cmake --version
ninja --version
```

## 相关文档

- [Mise 官方文档](https://mise.jdx.dev/)
- [GitHub 镜像列表](https://github.com/XIU2/TrackersListCollection)
- [Emscripten 文档](https://emscripten.org/)
