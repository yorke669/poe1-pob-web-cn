#!/bin/bash
# 拷贝代码到路径
# 从 代码扩展/code/ 拷贝到目标路径

set -e

# 配置
CODE_DIR="代码扩展/code"
DRIVER_DIR="packages/driver"

# 打印帮助
print_help() {
    echo "用法: ./copy-code.sh [选项]"
    echo ""
    echo "选项:"
    echo "  --help          显示帮助信息"
    echo "  --code-dir DIR  指定代码目录 (默认: 代码扩展/code)"
    echo "  --driver-dir DIR 指定驱动目录 (默认: packages/driver)"
    echo ""
    echo "示例:"
    echo "  ./copy-code.sh"
    echo "  ./copy-code.sh --code-dir code --driver-dir driver"
}

# 解析参数
while [[ $# -gt 0 ]]; do
    case $1 in
        --help)
            print_help
            exit 0
            ;;
        --code-dir)
            CODE_DIR="$2"
            shift 2
            ;;
        --driver-dir)
            DRIVER_DIR="$2"
            shift 2
            ;;
        *)
            echo "未知参数: $1"
            print_help
            exit 1
            ;;
    esac
done

echo "=== 拷贝代码到路径 ==="
echo "代码目录: $CODE_DIR"
echo "驱动目录: $DRIVER_DIR"
echo ""

# 检查代码目录是否存在
if [ ! -d "$CODE_DIR" ]; then
    echo "错误: 代码目录不存在: $CODE_DIR"
    exit 1
fi

# 创建目标目录
mkdir -p "$DRIVER_DIR/translate"
mkdir -p "$DRIVER_DIR/src/js/overlay"

# 拷贝翻译实现
if [ -f "$CODE_DIR/translate_zh.lua" ]; then
    echo "1. 拷贝翻译实现..."
    cp "$CODE_DIR/translate_zh.lua" "$DRIVER_DIR/translate/translate_zh.lua"
    echo "  已拷贝: translate_zh.lua"
else
    echo "警告: 翻译实现文件不存在: $CODE_DIR/translate_zh.lua"
fi

# 拷贝属性读取实现
if [ -f "$CODE_DIR/getBuildStats_impl.lua" ]; then
    echo "2. 拷贝属性读取实现..."
    cp "$CODE_DIR/getBuildStats_impl.lua" "$DRIVER_DIR/translate/getBuildStats_impl.lua"
    echo "  已拷贝: getBuildStats_impl.lua"
else
    echo "警告: 属性读取实现文件不存在: $CODE_DIR/getBuildStats_impl.lua"
fi

# 拷贝 UI 组件
if [ -f "$CODE_DIR/FloatingStatsButton.tsx" ]; then
    echo "3. 拷贝 UI 组件..."
    cp "$CODE_DIR/FloatingStatsButton.tsx" "$DRIVER_DIR/src/js/overlay/FloatingStatsButton.tsx"
    echo "  已拷贝: FloatingStatsButton.tsx"
else
    echo "警告: UI 组件文件不存在: $CODE_DIR/FloatingStatsButton.tsx"
fi

echo ""
echo "完成! 代码已拷贝到目标路径"