# 脚本使用说明

## generate-translate.py

### 功能
从翻译数据生成lua脚本

### 使用方法

#### 基本用法
```bash
python3 代码扩展/scripts/generate-translate.py
```

#### 指定目录
```bash
python3 代码扩展/scripts/generate-translate.py --data-dir data/zh-rCN --output-dir translate
```

#### 查看帮助
```bash
python3 代码扩展/scripts/generate-translate.py --help
```

### 参数说明
- `--data-dir DIR`：指定数据目录（默认：`代码扩展/data/zh-rCN`）
- `--output-dir DIR`：指定输出目录（默认：`packages/driver/translate`）
- `--help`：显示帮助信息

### 工作原理
1. 读取 `data/zh-rCN/` 目录下的所有 `.lua` 文件
2. 复制到 `packages/driver/translate/` 目录
3. 保持文件名和内容不变

### 示例

#### 输入文件
```
代码扩展/data/zh-rCN/
├── statDescriptions.lua
├── GUI.lua
└── Unsorted.lua
```

#### 输出文件
```
packages/driver/translate/
├── statDescriptions.lua
├── GUI.lua
└── Unsorted.lua
```

### 注意事项
1. 确保数据目录存在
2. 确保有写入权限
3. 只处理 `.lua` 文件

## copy-code.sh

### 功能
拷贝实现层代码到目标路径

### 使用方法

#### 基本用法
```bash
./代码扩展/scripts/copy-code.sh
```

#### 指定目录
```bash
./代码扩展/scripts/copy-code.sh --code-dir code --driver-dir driver
```

#### 查看帮助
```bash
./代码扩展/scripts/copy-code.sh --help
```

### 参数说明
- `--code-dir DIR`：指定代码目录（默认：`代码扩展/code`）
- `--driver-dir DIR`：指定驱动目录（默认：`packages/driver`）
- `--help`：显示帮助信息

### 工作原理
1. 拷贝 `code/translate_zh.lua` → `packages/driver/translate/translate_zh.lua`
2. 拷贝 `code/getBuildStats_impl.lua` → `packages/driver/translate/getBuildStats_impl.lua`
3. 拷贝 `code/FloatingStatsButton.tsx` → `packages/driver/src/js/overlay/FloatingStatsButton.tsx`

## apply-invasions.sh

### 功能
应用入侵修改

### 使用方法

#### 基本用法
```bash
./代码扩展/scripts/apply-invasions.sh
```

#### 指定目录
```bash
./代码扩展/scripts/apply-invasions.sh --docs-dir docs --driver-dir driver
```

#### 查看帮助
```bash
./代码扩展/scripts/apply-invasions.sh --help
```

### 参数说明
- `--docs-dir DIR`：指定文档目录（默认：`代码扩展/docs`）
- `--driver-dir DIR`：指定驱动目录（默认：`packages/driver`）
- `--help`：显示帮助信息

### 工作原理
1. 备份原文件到 `代码扩展/backups/`
2. 根据 `docs/入侵修改清单.md` 应用修改
3. 生成修改报告

### 注意事项
- 入侵修改需要手动应用
- 请参考 `docs/入侵修改清单.md`

## merge.sh

### 功能
完整融合流程

### 使用方法

#### 基本用法
```bash
./代码扩展/scripts/merge.sh
```

#### 跳过某些步骤
```bash
# 跳过编译
./代码扩展/scripts/merge.sh --skip-build

# 跳过生成翻译
./代码扩展/scripts/merge.sh --skip-generate

# 跳过所有步骤（仅显示流程）
./代码扩展/scripts/merge.sh --skip-generate --skip-copy --skip-invasion --skip-build
```

#### 查看帮助
```bash
./代码扩展/scripts/merge.sh --help
```

### 参数说明
- `--skip-generate`：跳过生成翻译lua脚本
- `--skip-copy`：跳过拷贝代码
- `--skip-invasion`：跳过应用入侵修改
- `--skip-build`：跳过原生编译
- `--help`：显示帮助信息

### 工作原理
1. 生成翻译lua脚本
2. 拷贝代码到路径
3. 应用入侵修改
4. 原生编译

### 完整流程
```
┌─────────────────────────────────────────┐
│  1. 生成翻译lua脚本                      │
│     python3 generate-translate.py        │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│  2. 拷贝代码到路径                        │
│     ./copy-code.sh                       │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│  3. 应用入侵修改                          │
│     ./apply-invasions.sh                 │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│  4. 原生编译                              │
│     mise run driver:build                │
└─────────────────────────────────────────┘
```

## 常见问题

### Q1: Python 脚本执行失败

**症状**：
```
python3: command not found
```

**解决**：
```bash
# 检查 Python 是否安装
which python3

# 如果未安装，安装 Python
# macOS: brew install python3
# Ubuntu: sudo apt install python3
```

### Q2: 权限不足

**症状**：
```
Permission denied
```

**解决**：
```bash
# 给脚本添加执行权限
chmod +x 代码扩展/scripts/*.sh
chmod +x 代码扩展/scripts/*.py
```

### Q3: 目录不存在

**症状**：
```
错误: 数据目录不存在
```

**解决**：
```bash
# 创建目录
mkdir -p 代码扩展/data/zh-rCN
mkdir -p 代码扩展/code
mkdir -p packages/driver/translate
```

## 最佳实践

1. **定期备份**：在应用入侵修改前备份重要文件
2. **版本控制**：使用 git 管理所有修改
3. **测试验证**：每次修改后都要测试
4. **分步执行**：遇到问题时，分步执行脚本定位问题