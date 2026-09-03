#!/bin/bash
# 应用入侵修改
# 根据 代码扩展/docs/入侵修改清单.md 修改上游代码

set -e

# 配置
DOCS_DIR="代码扩展/docs"
DRIVER_DIR="packages/driver"

# 打印帮助
print_help() {
    echo "用法: ./apply-invasions.sh [选项]"
    echo ""
    echo "选项:"
    echo "  --help          显示帮助信息"
    echo "  --docs-dir DIR  指定文档目录 (默认: 代码扩展/docs)"
    echo "  --driver-dir DIR 指定驱动目录 (默认: packages/driver)"
    echo ""
    echo "示例:"
    echo "  ./apply-invasions.sh"
    echo "  ./apply-invasions.sh --docs-dir docs --driver-dir driver"
}

# 解析参数
while [[ $# -gt 0 ]]; do
    case $1 in
        --help)
            print_help
            exit 0
            ;;
        --docs-dir)
            DOCS_DIR="$2"
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

echo "=== 应用入侵修改 ==="
echo "文档目录: $DOCS_DIR"
echo "驱动目录: $DRIVER_DIR"
echo ""

# 检查文档目录是否存在
if [ ! -d "$DOCS_DIR" ]; then
    echo "错误: 文档目录不存在: $DOCS_DIR"
    exit 1
fi

# 检查驱动目录是否存在
if [ ! -d "$DRIVER_DIR" ]; then
    echo "错误: 驱动目录不存在: $DRIVER_DIR"
    exit 1
fi

# 备份原文件
echo "1. 备份原文件..."
BACKUP_DIR="代码扩展/backups/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

if [ -f "$DRIVER_DIR/boot.lua" ]; then
    cp "$DRIVER_DIR/boot.lua" "$BACKUP_DIR/boot.lua"
    echo "  已备份: boot.lua"
fi

if [ -f "$DRIVER_DIR/src/c/driver.c" ]; then
    cp "$DRIVER_DIR/src/c/driver.c" "$BACKUP_DIR/driver.c"
    echo "  已备份: driver.c"
fi

if [ -f "$DRIVER_DIR/src/js/driver.ts" ]; then
    cp "$DRIVER_DIR/src/js/driver.ts" "$BACKUP_DIR/driver.ts"
    echo "  已备份: driver.ts"
fi

if [ -f "$DRIVER_DIR/src/js/worker.ts" ]; then
    cp "$DRIVER_DIR/src/js/worker.ts" "$BACKUP_DIR/worker.ts"
    echo "  已备份: worker.ts"
fi

echo ""

# 应用入侵修改
echo "2. 应用入侵修改..."

# 这里需要根据入侵修改清单，手动或自动应用修改
# 由于入侵修改比较复杂，建议手动应用

echo "  注意: 入侵修改需要手动应用"
echo "  请参考: $DOCS_DIR/入侵修改清单.md"
echo ""
echo "  入侵修改文件:"
echo "    - $DRIVER_DIR/boot.lua"
echo "    - $DRIVER_DIR/src/c/driver.c"
echo "    - $DRIVER_DIR/src/js/driver.ts"
echo "    - $DRIVER_DIR/src/js/worker.ts"

echo ""
echo "完成! 请手动应用入侵修改"