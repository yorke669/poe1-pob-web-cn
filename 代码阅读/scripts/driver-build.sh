#!/bin/bash
# driver-build.sh - 编译 Wasm driver 脚本
# 用途：使用 Emscripten 编译 driver 包的 WebAssembly 模块
# 
# 使用方法：
#   ./driver-build.sh [--kind <debug|release|all>]
# 
# 参数：
#   --kind <kind>  构建类型，可选值：debug, release, all（默认：all）
# 
# 示例：
#   ./driver-build.sh                  # 同时构建 debug 和 release
#   ./driver-build.sh --kind debug     # 只构建 debug 版本
#   ./driver-build.sh --kind release   # 只构建 release 版本
#
# 输出位置：
#   packages/driver/dist/debug/     driver.mjs + driver.wasm（-O0 -g3，开启 ASSERTIONS/SAFE_HEAP）
#   packages/driver/dist/release/   driver.mjs + driver.wasm + driver.wasm.debug.wasm（-O3，LTO，mimalloc）

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
用法: $0 [--kind <debug|release|all>]

参数:
    --kind <kind>  构建类型 (debug, release, all)，默认: all

示例:
    $0                  # 同时构建 debug 和 release
    $0 --kind debug     # 只构建 debug 版本
    $0 --kind release   # 只构建 release 版本

说明:
    此脚本用于编译 driver 包的 WebAssembly 模块。
    
    Debug 版本:
    - 优化级别: -O0 -g3
    - 开启 ASSERTIONS、SAFE_HEAP、STACK_OVERFLOW_CHECK
    - 适合调试，体积大，速度慢
    
    Release 版本:
    - 优化级别: -O3
    - 开启 LTO、mimalloc
    - 生成独立的调试符号文件 driver.wasm.debug.wasm
    - 适合生产，体积小，速度快
    
    输出目录: packages/driver/dist/<kind>/
EOF
}

# 解析参数
KIND="all"

while [[ $# -gt 0 ]]; do
    case $1 in
        --kind)
            KIND="$2"
            shift 2
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
if [[ ! "$KIND" =~ ^(debug|release|all)$ ]]; then
    echo -e "${RED}错误: 不支持的构建类型 '$KIND'，可选值: debug, release, all${NC}"
    exit 1
fi

# 检查必要工具
check_tool() {
    local tool=$1
    local package=$2
    if ! command -v "$tool" &> /dev/null; then
        echo -e "${RED}错误: 未找到 $tool 命令${NC}"
        echo -e "${YELLOW}请先安装 $package:${NC}"
        echo "  mise install $package"
        exit 1
    fi
}

check_tool "cmake" "cmake"
check_tool "ninja" "ninja"
check_tool "emcc" "emsdk"

# 检查 Git 子模块
check_submodules() {
    echo -e "${YELLOW}检查 Git 子模块...${NC}"
    
    local submodules=("vendor/lua" "vendor/luautf8")
    local missing=()
    
    for submodule in "${submodules[@]}"; do
        if [[ ! -f "$submodule/README" ]] && [[ ! -f "$submodule/README.md" ]] && [[ ! -f "$submodule/lua.h" ]]; then
            missing+=("$submodule")
        fi
    done
    
    if [[ ${#missing[@]} -gt 0 ]]; then
        echo -e "${RED}错误: 以下 Git 子模块未初始化:${NC}"
        for m in "${missing[@]}"; do
            echo -e "  ${RED}- $m${NC}"
        done
        echo ""
        echo -e "${YELLOW}请运行以下命令初始化子模块:${NC}"
        echo "  git submodule update --init --recursive"
        echo ""
        echo -e "${YELLOW}或者运行:${NC}"
        echo "  mise run setup"
        exit 1
    fi
    
    echo -e "${GREEN}✓ Git 子模块已就绪${NC}"
}

# 切换到项目根目录
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$PROJECT_ROOT"

# 执行检查
check_submodules

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}编译 Wasm Driver${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "构建类型: ${YELLOW}$KIND${NC}"
echo -e "项目根目录: ${YELLOW}$PROJECT_ROOT${NC}"
echo ""

# 构建函数
build_driver() {
    local kind=$1
    local cmakeKind=$([[ "$kind" == "debug" ]] && echo "Debug" || echo "Release")
    
    echo -e "${BLUE}----------------------------------------${NC}"
    echo -e "${BLUE}构建 $kind 版本${NC}"
    echo -e "${BLUE}----------------------------------------${NC}"
    
    # 清理旧构建产物
    echo -e "${YELLOW}清理旧构建产物...${NC}"
    cmake -E rm -rf "packages/driver/dist/$kind"
    
    # 配置 CMake
    echo -e "${YELLOW}配置 CMake...${NC}"
    emcmake cmake --fresh -G Ninja \
        -B packages/driver/build \
        -S packages/driver \
        -DCMAKE_BUILD_TYPE="$cmakeKind"
    
    # 编译
    echo -e "${YELLOW}编译 Wasm...${NC}"
    export EMCC_FORCE_STDLIBS=libc
    emmake ninja -C packages/driver/build
    
    echo -e "${GREEN}✓ $kind 版本构建完成${NC}"
    echo ""
}

# 执行构建
if [[ "$KIND" == "all" ]]; then
    build_driver "debug"
    build_driver "release"
else
    build_driver "$KIND"
fi

# 检查输出
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}构建完成！${NC}"
echo -e "${GREEN}========================================${NC}"

if [[ "$KIND" == "all" ]] || [[ "$KIND" == "debug" ]]; then
    if [[ -f "packages/driver/dist/debug/driver.wasm" ]]; then
        echo -e "${GREEN}Debug 版本:${NC}"
        ls -lh packages/driver/dist/debug/
        echo ""
    fi
fi

if [[ "$KIND" == "all" ]] || [[ "$KIND" == "release" ]]; then
    if [[ -f "packages/driver/dist/release/driver.wasm" ]]; then
        echo -e "${GREEN}Release 版本:${NC}"
        ls -lh packages/driver/dist/release/
        echo ""
        
        # 检查调试符号文件
        if [[ -f "packages/driver/dist/release/driver.wasm.debug.wasm" ]]; then
            echo -e "${GREEN}✓ 调试符号文件已生成: driver.wasm.debug.wasm${NC}"
        fi
    fi
fi