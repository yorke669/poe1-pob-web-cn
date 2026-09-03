#!/bin/bash
# driver-dev.sh - 启动 driver 开发服务器
# 用途：启动 driver 包的开发服务器，用于本地开发和调试
# 
# 使用方法：
#   ./driver-dev.sh [--game <game>] [--version <version>] [--build <debug|release>] [--pob-cool-asset]
# 
# 参数：
#   --game <game>           游戏名称，可选值：poe1, poe2, le（默认：poe2）
#   --version <version>     游戏版本，例如：v2.67.2, v0.23.1
#   --build <build>         构建类型，可选值：debug, release（默认：release）
#   --pob-cool-asset        使用线上 CDN 资源替代本地打包
# 
# 示例：
#   ./代码扩展/scripts/driver-dev.sh --game poe1 --version v2.67.2 --build debug
#   ./代码扩展/scripts/driver-dev.sh --game poe2 --version v0.23.1
#   ./代码扩展/scripts/driver-dev.sh --game poe1 --pob-cool-asset
#
# 前置条件：
#   1. 已打包资源（运行 pack.sh）或使用 --pob-cool-asset
#   2. 已编译 Wasm（运行 driver-build.sh）

set -e  # 遇到错误立即退出

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 帮助信息
show_help() {
    cat << EOF
用法: $0 [选项]

选项:
    --game <game>           游戏名称 (poe1, poe2, le)，默认: poe2
    --version <version>     游戏版本，例如: v2.67.2, v0.23.1
    --build <build>         构建类型 (debug, release)，默认: release
    --pob-cool-asset        使用线上 CDN 资源 (https://asset.pob.cool)
    -h, --help              显示帮助信息

示例:
    $0 --game poe1 --version v2.67.2 --build debug
    $0 --game poe2 --version v0.23.1
    $0 --game poe1 --pob-cool-asset

说明:
    此脚本用于启动 driver 开发服务器。
    
    前置条件:
    1. 已打包资源（运行 pack.sh）或使用 --pob-cool-asset
    2. 已编译 Wasm（运行 driver-build.sh）
    
    开发服务器会自动监听文件变化并热重载。
    访问 http://127.0.0.1:<动态端口>/ 查看应用。
EOF
}

# 解析参数
GAME=""
VERSION=""
BUILD="release"
POB_COOL_ASSET=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --game)
            GAME="$2"
            shift 2
            ;;
        --version)
            VERSION="$2"
            shift 2
            ;;
        --build)
            BUILD="$2"
            shift 2
            ;;
        --pob-cool-asset)
            POB_COOL_ASSET=true
            shift
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        *)
            echo -e "${RED}错误: 未知参数 $1${NC}"
            show_help
            exit 1
            ;;
    esac
done

# 验证参数
if [[ -n "$GAME" ]] && [[ ! "$GAME" =~ ^(poe1|poe2|le)$ ]]; then
    echo -e "${RED}错误: 不支持的游戏 '$GAME'，可选值: poe1, poe2, le${NC}"
    exit 1
fi

if [[ ! "$BUILD" =~ ^(debug|release)$ ]]; then
    echo -e "${RED}错误: 不支持的构建类型 '$BUILD'，可选值: debug, release${NC}"
    exit 1
fi

# 检查 deno 是否安装
if ! command -v deno &> /dev/null; then
    echo -e "${RED}错误: 未找到 deno 命令${NC}"
    echo -e "${YELLOW}请先安装 mise 并配置 shell 集成:${NC}"
    echo "  1. brew install mise"
    echo "  2. echo 'eval \"\$(mise activate zsh)\"' >> ~/.zshrc"
    echo "  3. source ~/.zshrc"
    echo "  4. mise run setup"
    exit 1
fi

# 切换到项目根目录
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$PROJECT_ROOT"

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}启动 Driver 开发服务器${NC}"
echo -e "${GREEN}========================================${NC}"
if [[ -n "$GAME" ]]; then
    echo -e "游戏: ${YELLOW}$GAME${NC}"
else
    echo -e "游戏: ${YELLOW}poe2（默认）${NC}"
fi
if [[ -n "$VERSION" ]]; then
    echo -e "版本: ${YELLOW}$VERSION${NC}"
else
    echo -e "版本: ${YELLOW}v0.8.0（默认）${NC}"
fi
echo -e "构建类型: ${YELLOW}$BUILD${NC}"
if [[ "$POB_COOL_ASSET" == true ]]; then
    echo -e "资源来源: ${YELLOW}线上 CDN (asset.pob.cool)${NC}"
else
    echo -e "资源来源: ${YELLOW}本地打包${NC}"
fi
echo -e "项目根目录: ${YELLOW}$PROJECT_ROOT${NC}"
echo ""

# 检查前置条件
if [[ "$POB_COOL_ASSET" == false ]]; then
    # 检查是否已打包资源
    if [[ -n "$GAME" ]] && [[ -n "$VERSION" ]]; then
        RESOURCE_DIR="packages/packer/r2/games/$GAME/versions/$VERSION"
        if [[ ! -f "$RESOURCE_DIR/root.zip" ]]; then
            echo -e "${YELLOW}警告: 未找到本地打包资源 $RESOURCE_DIR/root.zip${NC}"
            echo -e "${YELLOW}建议:${NC}"
            echo "  1. 先运行: ./pack.sh --game $GAME --tag $VERSION"
            echo "  2. 或使用: $0 --game $GAME --version $VERSION --pob-cool-asset"
            echo ""
            read -p "是否继续启动服务器？(y/N) " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                exit 1
            fi
        fi
    fi
fi

# 检查 Wasm 是否已编译
if [[ ! -f "packages/driver/dist/$BUILD/driver.wasm" ]]; then
    echo -e "${RED}错误: 未找到 Wasm 文件 packages/driver/dist/$BUILD/driver.wasm${NC}"
    echo -e "${YELLOW}请先运行: ./driver-build.sh --kind $BUILD${NC}"
    exit 1
fi

# 设置环境变量
export RUN_BUILD="$BUILD"
if [[ -n "$GAME" ]]; then
    export RUN_GAME="$GAME"
fi
if [[ -n "$VERSION" ]]; then
    export RUN_VERSION="$VERSION"
fi
if [[ "$POB_COOL_ASSET" == true ]]; then
    export POB_COOL_ASSET="true"
fi

echo -e "${GREEN}启动开发服务器...${NC}"
echo -e "${BLUE}提示: 端口是动态分配的，请从终端输出中找到 'Local: http://127.0.0.1:xxxx/'${NC}"
echo ""

# 启动开发服务器
deno task --filter pob-driver dev