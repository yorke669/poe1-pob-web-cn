#!/bin/bash
# 完整融合脚本
# 自动化执行所有步骤

set -e

# 打印帮助
print_help() {
    echo "用法: ./merge.sh [选项]"
    echo ""
    echo "选项:"
    echo "  --help          显示帮助信息"
    echo "  --skip-generate 跳过生成翻译lua脚本"
    echo "  --skip-copy     跳过拷贝代码"
    echo "  --skip-invasion 跳过应用入侵修改"
    echo "  --skip-build    跳过原生编译"
    echo ""
    echo "示例:"
    echo "  ./merge.sh"
    echo "  ./merge.sh --skip-build"
}

# 解析参数
SKIP_GENERATE=false
SKIP_COPY=false
SKIP_INVASION=false
SKIP_BUILD=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --help)
            print_help
            exit 0
            ;;
        --skip-generate)
            SKIP_GENERATE=true
            shift
            ;;
        --skip-copy)
            SKIP_COPY=true
            shift
            ;;
        --skip-invasion)
            SKIP_INVASION=true
            shift
            ;;
        --skip-build)
            SKIP_BUILD=true
            shift
            ;;
        *)
            echo "未知参数: $1"
            print_help
            exit 1
            ;;
    esac
done

echo "=== 开始融合流程 ==="
echo ""

# 1. 生成翻译lua脚本
if [ "$SKIP_GENERATE" = false ]; then
    echo "1. 生成翻译lua脚本..."
    if [ -f "代码扩展/scripts/generate-translate.py" ]; then
        python3 代码扩展/scripts/generate-translate.py
    else
        echo "  警告: 生成脚本不存在，跳过"
    fi
    echo ""
fi

# 2. 拷贝代码到路径
if [ "$SKIP_COPY" = false ]; then
    echo "2. 拷贝代码到路径..."
    if [ -f "代码扩展/scripts/copy-code.sh" ]; then
        ./代码扩展/scripts/copy-code.sh
    else
        echo "  警告: 拷贝脚本不存在，跳过"
    fi
    echo ""
fi

# 3. 应用入侵修改
if [ "$SKIP_INVASION" = false ]; then
    echo "3. 应用入侵修改..."
    if [ -f "代码扩展/scripts/apply-invasions.sh" ]; then
        ./代码扩展/scripts/apply-invasions.sh
    else
        echo "  警告: 入侵修改脚本不存在，跳过"
    fi
    echo ""
fi

# 4. 原生编译
if [ "$SKIP_BUILD" = false ]; then
    echo "4. 原生编译..."
    mise run driver:build
    echo ""
fi

echo "=== 融合流程完成 ==="
echo ""
echo "下一步:"
echo "  1. 测试翻译功能"
echo "  2. 测试悬浮按钮功能"
echo "  3. 测试装备对比功能"
echo ""
echo "运行测试:"
echo "  mise run driver:dev --game poe1 --version v2.67.2"