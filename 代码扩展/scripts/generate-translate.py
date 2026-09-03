#!/usr/bin/env python3
"""
生成翻译lua脚本
从 data/zh-rCN/ 生成 lua 脚本到 packages/driver/translate/
"""

import argparse
import csv
import sys
from pathlib import Path


# 获取脚本所在目录
SCRIPT_DIR = Path(__file__).parent
# 项目根目录（脚本目录的父目录的父目录）
PROJECT_ROOT = SCRIPT_DIR.parent.parent


def parse_args():
    """解析命令行参数"""
    parser = argparse.ArgumentParser(
        description="生成翻译lua脚本",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python generate-translate.py
  python generate-translate.py --data-dir data/zh-rCN --output-dir translate
        """
    )
    
    parser.add_argument(
        "--data-dir",
        type=str,
        default=str(SCRIPT_DIR / "../data/zh-rCN"),
        help="指定数据目录 (默认: ../data/zh-rCN)"
    )
    
    parser.add_argument(
        "--output-dir",
        type=str,
        default=str(PROJECT_ROOT / "packages/driver/translate"),
        help="指定输出目录 (默认: ../../packages/driver/translate)"
    )
    
    return parser.parse_args()


def lua_string(value: str) -> str:
    """生成安全的 Lua 双引号字符串。"""
    return (
        value
        .replace("\\", "\\\\")
        .replace('"', '\\"')
        .replace("\r", "\\r")
        .replace("\n", "\\n")
    )


def generate_lua_file(input_file: Path, output_file: Path) -> bool:
    """从 CSV 生成 Lua table 文件。"""
    print(f"  处理: {input_file}")

    try:
        lua_lines = ["return {"]

        with input_file.open("r", encoding="utf-8", newline="") as f:
            reader = csv.reader(f)
            for row in reader:
                if not row or (row[0].startswith("#")):
                    continue
                if len(row) < 2:
                    continue
                english = row[0]
                chinese = row[1]
                lua_lines.append(f'    ["{lua_string(english)}"] = "{lua_string(chinese)}",')

        lua_lines.append("}")
        output_file.write_text("\n".join(lua_lines) + "\n", encoding="utf-8")
        return True
    except Exception as e:
        print(f"  错误: {e}")
        return False


def main():
    """主函数"""
    args = parse_args()
    
    data_dir = Path(args.data_dir)
    output_dir = Path(args.output_dir)
    
    print("=== 生成翻译lua脚本 ===")
    print(f"数据目录: {data_dir}")
    print(f"输出目录: {output_dir}")
    print()
    
    # 检查数据目录是否存在
    if not data_dir.exists():
        print(f"错误: 数据目录不存在: {data_dir}")
        sys.exit(1)
    
    if not data_dir.is_dir():
        print(f"错误: 数据目录不是目录: {data_dir}")
        sys.exit(1)
    
    # 创建输出目录
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # 遍历数据目录
    file_count = 0
    manifest_files = []
    for file in sorted(data_dir.iterdir()):
        if file.is_file() and file.suffix == ".csv":
            # 生成 Lua 文件名（.csv -> .lua）
            lua_name = file.stem + ".lua"
            output_file = output_dir / lua_name
            if generate_lua_file(file, output_file):
                manifest_files.append(lua_name)
                file_count += 1

    # 生成 translate_manifest.lua，供 translate_zh.lua 加载全部翻译模块
    manifest_path = output_dir / "translate_manifest.lua"
    manifest_lines = ["return {"]
    for lua_name in manifest_files:
        manifest_lines.append(f'    "{lua_name}",')
    manifest_lines.append("}")
    manifest_path.write_text("\n".join(manifest_lines) + "\n", encoding="utf-8")
    
    print()
    print(f"完成! 共生成 {file_count} 个翻译文件 + translate_manifest.lua")


if __name__ == "__main__":
    main()