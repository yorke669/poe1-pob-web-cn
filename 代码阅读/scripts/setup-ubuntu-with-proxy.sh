#!/bin/bash
# setup-ubuntu-with-proxy.sh - 使用代理初始化 Ubuntu 环境
#
# 使用方法：
#   1. 在本地 macOS 建立隧道：ssh -R 7897:127.0.0.1:7897 root@172.50.2.121
#   2. 在服务器的 SSH 会话中执行此脚本

set -e

echo "========================================="
echo "初始化 Ubuntu 开发环境"
echo "========================================="

# 设置 PATH
export PATH="$HOME/.local/bin:$PATH"
echo "✓ PATH 已设置"

# 设置代理
export HTTP_PROXY="http://127.0.0.1:7897"
export HTTPS_PROXY="http://127.0.0.1:7897"
echo "✓ 代理已设置: http://127.0.0.1:7897"

# 测试代理
echo "测试代理连接..."
if curl -I https://github.com 2>&1 | grep -q "HTTP/2 200"; then
    echo "✓ 代理连接成功"
else
    echo "✗ 代理连接失败，请检查隧道是否建立"
    exit 1
fi

# 切换到项目目录
cd /opt/poe/poe1-pob-web
echo "✓ 当前目录: $(pwd)"

# 检查 mise
if ! command -v mise &> /dev/null; then
    echo "✗ mise 未找到，请先安装 mise"
    exit 1
fi
echo "✓ mise 版本: $(mise --version)"

# 初始化环境
echo "开始初始化环境（这可能需要几分钟）..."
mise run setup

echo ""
echo "========================================="
echo "环境初始化完成！"
echo "========================================="
echo ""
echo "验证工具链："
mise --version
deno --version

echo ""
echo "下一步："
echo "  1. 打包资源: mise run pack --game poe1 --tag v2.67.2"
echo "  2. 编译 Wasm: mise run driver:build"
echo "  3. 启动服务: mise run driver:dev --game poe1 --version v2.67.2"