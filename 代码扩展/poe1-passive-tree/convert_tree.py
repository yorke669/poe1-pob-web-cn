#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
将 PoB 官方仓库的 Lua 天赋树数据转换为与现有 poe1-tree.js 同构的 JS 数据文件。

用法:
  python3 convert_tree.py --version 3_26 [--packtag v2.49.0]
  python3 convert_tree.py --version 3_29 [--packtag v2.67.2]

数据来源: PathOfBuildingCommunity/PathOfBuilding @ src/TreeData/<ver>/
输入文件: source/TreeData_<ver>.lua + source/Sprites_<ver>.lua
输出文件: poe1-tree-<ver>.js

解析器: slpp (pip install slpp, Python 3) —— 成熟 Lua 表解析器, 比手写解析器可靠。
"""
import argparse
import json
import math
import os
import slpp

DIR = os.path.dirname(os.path.abspath(__file__))
EXISTING_JS = os.path.join(DIR, 'poe1-tree.js')  # 3_29 参考文件, 用于交叉验证


def load_lua(p):
    txt = open(p, encoding='utf-8').read().strip()
    if txt.lower().startswith('return'):
        txt = txt[6:].lstrip()
    while txt.endswith(';'):
        txt = txt[:-1].rstrip()
    return slpp.slpp.decode(txt)


def as_list(v):
    if v is None:
        return []
    if isinstance(v, dict):   # 空表被 slpp 解析为 dict
        return []
    if isinstance(v, list):
        return v
    return [v]


def build_orbit_angles(skills_per_orbit):
    """复现 PoB PassiveTreeClass:CalcOrbitAngles —— 非均匀分布的角度表(度)。"""
    res = []
    for n in skills_per_orbit:
        if n == 16:
            res.append([0, 30, 45, 60, 90, 120, 135, 150, 180, 210, 225, 240, 270, 300, 315, 330])
        elif n == 40:
            res.append([0, 10, 20, 30, 40, 45, 50, 60, 70, 80, 90, 100, 110, 120, 130, 135,
                        140, 150, 160, 170, 180, 190, 200, 210, 220, 225, 230, 240, 250, 260,
                        270, 280, 290, 300, 310, 315, 320, 330, 340, 350])
        else:
            # 均匀分布
            res.append([360.0 * i / n for i in range(n)])
    return res


def base_name(url):
    no_q = str(url).split('?')[0]
    return no_q[no_q.rfind('/') + 1:]


# 页面使用的 5 张精灵图 -> sheet 编号 (与现有 poe1-tree.js 的 sprite.sheet 含义一致)
SHEET_MAP = {
    'skills-3.jpg': 0,
    'skills-disabled-3.jpg': 1,
    'mastery-3.png': 2,
    'mastery-active-selected-3.png': 3,
    'mastery-disabled-3.png': 4,
}

ACTIVE_SHEETS = {
    'normal': ['normalActive'],
    'notable': ['notableActive'],
    'keystone': ['keystoneActive'],
    # 升阶节点(ascendancy)中的 notable/普通节点借用 notable/normal 帧(均在 skills-3.jpg)
    'ascendancy': ['notableActive', 'normalActive', 'ascendancy'],
    'mastery': ['masteryActiveSelected', 'mastery'],
    'classStart': ['normalActive'],
    'socket': [],
}
INACTIVE_SHEETS = {
    'normal': ['normalInactive'],
    'notable': ['notableInactive'],
    'keystone': ['keystoneInactive'],
    'ascendancy': ['notableInactive', 'normalInactive', 'ascendancy'],
    'mastery': ['masteryInactive', 'mastery'],
    'classStart': ['normalInactive'],
    'socket': [],
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--version', required=True, help='树数据版本, 如 3_26 / 3_29')
    ap.add_argument('--packtag', default=None, help='对应 PoB release 版本, 如 v2.49.0 (仅展示用)')
    args = ap.parse_args()
    ver = args.version
    TREE_LUA = os.path.join(DIR, 'source', 'TreeData_%s.lua' % ver)
    SPRITES_LUA = os.path.join(DIR, 'source', 'Sprites_%s.lua' % ver)
    OUT_JS = os.path.join(DIR, 'poe1-tree-%s.js' % ver)

    print('解析 tree.lua ...')
    tree = load_lua(TREE_LUA)
    print('解析 sprites.lua ...')
    sprites_root = load_lua(SPRITES_LUA)
    sprites = sprites_root.get('sprites', sprites_root)

    constants = tree.get('constants', {})
    orbit_radii = constants['orbitRadii']
    skills_per_orbit = constants['skillsPerOrbit']
    orbit_angles = build_orbit_angles(skills_per_orbit)  # 每个轨道的角度表(度)
    groups = tree['groups']
    nodes = tree['nodes']

    # 调试: 未映射的 sprite 类型
    unmapped = set()
    for st, sd in sprites.items():
        if isinstance(sd, dict) and 'filename' in sd:
            bn = base_name(sd['filename'])
            if bn not in SHEET_MAP:
                unmapped.add(bn)
    if unmapped:
        print('[warn] sprites 中有未映射到本地 5 张图的 filename:', unmapped)

    group_of_node = {}
    for gid, g in groups.items():
        for nid in as_list(g.get('nodes')):
            group_of_node[str(nid)] = gid

    def find_sprite(icon, sheet_types):
        if not icon:
            return None
        for st in sheet_types:
            sd = sprites.get(st)
            if not isinstance(sd, dict) or 'coords' not in sd:
                continue
            c = sd['coords'].get(icon)
            if not c:
                continue
            sheet = SHEET_MAP.get(base_name(sd['filename']))
            if sheet is None:
                continue
            return {
                'sheet': sheet,
                'x': c['x'], 'y': c['y'], 'w': c['w'], 'h': c['h'],
                'sheetWidth': sd['w'], 'sheetHeight': sd['h'],
            }
        return None

    def node_type(nd):
        # 优先级: mastery > ascendancy > socket > keystone > notable > classStart > normal
        if nd.get('isMastery'):
            return 'mastery'
        if nd.get('ascendancyName') or nd.get('isAscendancyStart'):
            return 'ascendancy'
        if nd.get('isJewelSocket'):
            return 'socket'
        if nd.get('isKeystone'):
            return 'keystone'
        if nd.get('isNotable'):
            return 'notable'
        if nd.get('classStartIndex') is not None:
            return 'classStart'
        return 'normal'

    def compute_coords(nid, nd):
        gid = nd.get('group')
        if gid is None:
            gid = group_of_node.get(str(nid))
        if gid is None or gid not in groups:
            return None, None
        orbit = nd.get('orbit')
        orbit_index = nd.get('orbitIndex')
        if orbit is None or orbit_index is None:
            return None, None
        g = groups[gid]
        radius = orbit_radii[orbit]
        angle_deg = orbit_angles[orbit][orbit_index]
        a = math.radians(angle_deg)
        # PoB: x = group.x + sin(angle)*r ; y = group.y - cos(angle)*r
        x = g['x'] + math.sin(a) * radius
        y = g['y'] - math.cos(a) * radius
        return x, y

    # 输出 groups
    out_groups = {}
    for gid, g in groups.items():
        if isinstance(g, dict) and 'x' in g and 'y' in g:
            out_groups[str(gid)] = {'x': round(g['x'], 2), 'y': round(g['y'], 2)}

    # 输出 nodes
    out_nodes = {}
    sheet_dist = {}
    type_dist = {}
    no_coord = []
    for nid, nd in nodes.items():
        if not isinstance(nd, dict):
            continue
        nid_s = str(nid)
        t = node_type(nd)
        type_dist[t] = type_dist.get(t, 0) + 1

        x, y = compute_coords(nid, nd)
        if x is None:
            no_coord.append(nid_s)

        base_icon = nd.get('icon')
        active_icon = nd.get('activeIcon') or base_icon
        inactive_icon = nd.get('inactiveIcon') or base_icon
        sprite = find_sprite(active_icon, ACTIVE_SHEETS.get(t, ['normalActive']))
        inactive = find_sprite(inactive_icon, INACTIVE_SHEETS.get(t, ['normalInactive']))
        if sprite:
            sheet_dist[sprite['sheet']] = sheet_dist.get(sprite['sheet'], 0) + 1

        o = {
            'type': t,
            'name': nd.get('name', ''),
            'x': round(x, 2) if x is not None else 0,
            'y': round(y, 2) if y is not None else 0,
            'group': nd.get('group'),
            'orbit': nd.get('orbit'),
            'orbitIndex': nd.get('orbitIndex'),
            'out': [str(v) for v in as_list(nd.get('out'))],
            'stats': as_list(nd.get('stats')),
            'icon': base_icon,
            'sprite': sprite,
            'inactiveSprite': inactive,
        }
        if nd.get('ascendancyName') or nd.get('ascendancy'):
            o['ascendancy'] = nd.get('ascendancyName') or nd.get('ascendancy')
        if nd.get('isProxy'):
            o['isProxy'] = True
        if nd.get('expansionJewel'):
            o['expansionJewel'] = nd['expansionJewel']
        if nd.get('masteryEffects'):
            o['masteryEffects'] = nd['masteryEffects']
        if nd.get('isAscendancyStart'):
            o['isAscendancyStart'] = True
        if nd.get('isBloodline'):
            o['isBloodline'] = True
        if nd.get('classStartIndex') is not None:
            o['classStartIndex'] = nd['classStartIndex']
        for k in list(o):
            if o[k] is None:
                del o[k]
        out_nodes[nid_s] = o

    # meta: 复用现有文件结构 (字段一致, 仅版本不同)
    meta = {'game': 'poe1', 'version': ver, 'packTag': (args.packtag or '') + '-lua'}
    if os.path.exists(EXISTING_JS):
        try:
            et = open(EXISTING_JS, encoding='utf-8').read()
            emeta = json.loads(et[et.index('{'):et.rindex('}') + 1]).get('meta', {})
            if isinstance(emeta, dict):
                for k, v in emeta.items():
                    meta.setdefault(k, v)
                meta['version'] = ver
                meta['packTag'] = (args.packtag or '') + '-lua'
        except Exception as e:
            print('[warn] 读取现有 meta 失败:', e)

    out = {
        'meta': meta,
        'constants': {'orbitRadii': orbit_radii, 'skillsPerOrbit': skills_per_orbit},
        'groups': out_groups,
        'nodes': out_nodes,
    }

    with open(OUT_JS, 'w', encoding='utf-8') as f:
        f.write('window.POE1_TREE = ' + json.dumps(out, ensure_ascii=False) + ';')

    print('节点类型分布:', type_dist)
    print('sprite sheet 分布:', sheet_dist)
    print('无坐标节点数:', len(no_coord), '样例:', no_coord[:10])
    print('已写出:', OUT_JS, '(', round(os.path.getsize(OUT_JS) / 1024 / 1024, 2), 'MB )')

    # ---- 交叉验证 ----
    if os.path.exists(EXISTING_JS):
        et = open(EXISTING_JS, encoding='utf-8').read()
        T = json.loads(et[et.index('{'):et.rindex('}') + 1])
        EN = T['nodes']
        matched = mismatched = 0
        max_diff = 0.0
        sheet_mismatch = 0
        type_mismatch = 0
        both = set(out_nodes) & set(EN)
        for nid in both:
            a, b = out_nodes[nid], EN[nid]
            dx = abs(a.get('x', 0) - b.get('x', 0))
            dy = abs(a.get('y', 0) - b.get('y', 0))
            d = math.sqrt(dx * dx + dy * dy)
            if d < 1.0:
                matched += 1
            else:
                mismatched += 1
                max_diff = max(max_diff, d)
            if a.get('type') != b.get('type'):
                type_mismatch += 1
            sa = (a.get('sprite') or {}).get('sheet')
            sb = (b.get('sprite') or {}).get('sheet')
            if sa != sb:
                sheet_mismatch += 1
        only_new = set(out_nodes) - set(EN)
        only_old = set(EN) - set(out_nodes)
        print('\n=== 坐标/类型/sheet 交叉验证 (与 poe1-tree.js) ===')
        print('  共有节点:', len(both))
        print('  坐标匹配(<1px):', matched, ' 不匹配:', mismatched, ' 最大偏差:', round(max_diff, 2))
        print('  类型不一致:', type_mismatch, ' sprite.sheet 不一致:', sheet_mismatch)
        print('  仅新文件有:', len(only_new), ' 仅旧文件有:', len(only_old))


if __name__ == '__main__':
    main()
