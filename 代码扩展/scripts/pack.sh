#!/bin/bash
# pack.sh - 打包上游资源脚本
# 用途：从 GitHub 克隆指定游戏的上游仓库，处理并打包资源文件
# 
# 使用方法：
#   ./pack.sh --game <game> --tag <tag>
# 
# 参数：
#   --game <game>        游戏名称，可选值：poe1, poe2, le
#   --tag <tag>          上游版本标签，例如：v2.67.2, v0.23.1
#   --skip-download      跳过下载（不重新 clone 仓库），直接基于已存在的
#                        build/<game>/<tag>/repo 重新打包
# 
# 示例：
#   ./代码扩展/scripts/pack.sh --game poe1 --tag v2.67.2
#   ./代码扩展/scripts/pack.sh --game poe2 --tag v0.23.1
#   ./代码扩展/scripts/pack.sh --game le --tag v0.12.0
#   ./代码扩展/scripts/pack.sh --game poe1 --tag v2.67.2 --skip-download
#
# 输出位置：
#   packages/packer/r2/games/<game>/versions/<tag>/
#   ├── root.zip          # Lua、配置等（打进 zip 供 zenfs 只读挂载）
#   └── root/             # 图片、DDS 纹理（走 HTTP 单独加载）

set -e  # 遇到错误立即退出

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 帮助信息
show_help() {
    cat << EOF
用法: $0 --game <game> --tag <tag>

参数:
    --game <game>        游戏名称 (poe1, poe2, le)
    --tag <tag>          上游版本标签 (例如: v2.67.2)
    --skip-download      跳过下载，直接基于已存在的 build/<game>/<tag>/repo 重新打包

示例:
    $0 --game poe1 --tag v2.67.2
    $0 --game poe2 --tag v0.23.1
    $0 --game poe1 --tag v2.67.2 --skip-download

说明:
    此脚本用于打包上游 Path of Building 资源文件。
    默认会从 GitHub 克隆指定版本的上游仓库，处理 Lua 脚本、图片、DDS 纹理等资源。
    使用 --skip-download 时可跳过下载，直接基于已存在的 build/<game>/<tag>/repo 重新打包。
    输出到 packages/packer/r2/games/<game>/versions/<tag>/ 目录。
EOF
}

# 解析参数
GAME=""
TAG=""
SKIP_DOWNLOAD=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --game)
            GAME="$2"
            shift 2
            ;;
        --tag)
            TAG="$2"
            shift 2
            ;;
        --skip-download)
            SKIP_DOWNLOAD=true
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
if [[ -z "$GAME" ]]; then
    echo -e "${RED}错误: 缺少 --game 参数${NC}"
    show_help
    exit 1
fi

if [[ -z "$TAG" ]]; then
    echo -e "${RED}错误: 缺少 --tag 参数${NC}"
    show_help
    exit 1
fi

# 验证游戏名称
if [[ ! "$GAME" =~ ^(poe1|poe2|le)$ ]]; then
    echo -e "${RED}错误: 不支持的游戏 '$GAME'，可选值: poe1, poe2, le${NC}"
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
echo -e "${GREEN}打包上游资源${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "游戏: ${YELLOW}$GAME${NC}"
echo -e "版本: ${YELLOW}$TAG${NC}"
echo -e "项目根目录: ${YELLOW}$PROJECT_ROOT${NC}"
if [[ "$SKIP_DOWNLOAD" == true ]]; then
    echo -e "模式: ${YELLOW}跳过下载，直接重新打包${NC}"
    # 校验已存在的仓库目录，否则无法重新打包
    if [[ ! -d "build/$GAME/$TAG/repo" ]]; then
        echo -e "${RED}错误: 未找到已下载的仓库目录 build/$GAME/$TAG/repo${NC}"
        echo -e "${YELLOW}请先不使用 --skip-download 执行一次下载，或检查 --game/--tag 是否正确${NC}"
        exit 1
    fi
else
    echo -e "模式: ${YELLOW}下载并打包${NC}"
fi
echo ""

# 执行打包命令
echo -e "${GREEN}开始打包...${NC}"
if [[ "$SKIP_DOWNLOAD" == true ]]; then
    deno task --filter pob-packer pack "$TAG" "$GAME"
else
    deno task --filter pob-packer pack "$TAG" "$GAME" clone
fi

# 检查输出
OUTPUT_DIR="packages/packer/r2/games/$GAME/versions/$TAG"
if [[ -f "$OUTPUT_DIR/root.zip" ]] && [[ -d "$OUTPUT_DIR/root" ]]; then
    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}打包完成！${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo -e "输出目录: ${YELLOW}$OUTPUT_DIR${NC}"
    echo ""
    ls -lh "$OUTPUT_DIR"
else
    echo -e "${RED}错误: 打包失败，未找到输出文件${NC}"
    exit 1
fi