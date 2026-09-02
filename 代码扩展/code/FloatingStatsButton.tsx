import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface FloatingStatsButtonProps {
  onGetStats: () => Promise<string>;
  onGetItemCompareStats: (slotName: string, itemRaw?: string) => Promise<string>;
}

interface CompareChange {
  stat?: string;
  label?: string;
  before?: number;
  after?: number;
  diff?: number;
  percent?: number | null;
  positive?: boolean;
  lowerIsBetter?: boolean;
  text?: string;
}

interface CompareResult {
  slotName?: string;
  mode?: string;
  itemName?: string | null;
  changes?: CompareChange[];
}

const BALL_SIZE = 56;
const PANEL_WIDTH = 520;
const PANEL_MAX_HEIGHT = 640;

const SLOT_OPTIONS = [
  { value: "Weapon 1", label: "主武器" },
  { value: "Weapon 2", label: "副武器" },
  { value: "Helmet", label: "头盔" },
  { value: "Body Armour", label: "身体护甲" },
  { value: "Gloves", label: "手套" },
  { value: "Boots", label: "鞋子" },
  { value: "Belt", label: "腰带" },
  { value: "Amulet", label: "项链" },
  { value: "Ring 1", label: "戒指 1" },
  { value: "Ring 2", label: "戒指 2" },
  { value: "Flask 1", label: "药剂 1" },
  { value: "Flask 2", label: "药剂 2" },
  { value: "Flask 3", label: "药剂 3" },
  { value: "Flask 4", label: "药剂 4" },
  { value: "Flask 5", label: "药剂 5" },
] as const;

type ToolKey = "buildStats" | "itemCompare";
type ResultView = "compare" | "raw";

export const FloatingStatsButton: React.FC<FloatingStatsButtonProps> = ({ onGetStats, onGetItemCompareStats }) => {
  const [expanded, setExpanded] = useState(false);
  const [position, setPosition] = useState({
    top: Math.max(8, Math.floor((window.innerHeight - BALL_SIZE) / 2)),
    left: Math.max(8, window.innerWidth - BALL_SIZE - 24),
  });
  const [activeTool, setActiveTool] = useState<ToolKey>("itemCompare");
  const [resultView, setResultView] = useState<ResultView>("compare");
  const [slotName, setSlotName] = useState<string>(SLOT_OPTIONS[1].value);
  const [itemRaw, setItemRaw] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [panelWidth, setPanelWidth] = useState(PANEL_WIDTH);
  const [resizing, setResizing] = useState(false);
  const resizeStart = useRef({ x: 0, width: PANEL_WIDTH });
  const ballRef = useRef<HTMLDivElement>(null);

  const parsedCompareResult = useMemo<CompareResult | null>(() => {
    if (!result || activeTool !== "itemCompare") return null;
    try {
      const parsed = JSON.parse(result) as CompareResult;
      return Array.isArray(parsed.changes) ? parsed : null;
    } catch {
      return null;
    }
  }, [activeTool, result]);

  const getPanelPosition = useCallback(() => {
    const rightSpace = window.innerWidth - position.left - BALL_SIZE;
    const panelLeft = rightSpace >= panelWidth + 8
      ? position.left + BALL_SIZE + 8
      : Math.max(8, position.left - panelWidth - 8);
    const panelTop = Math.max(8, Math.min(position.top, window.innerHeight - PANEL_MAX_HEIGHT - 8));
    return { top: panelTop, left: panelLeft };
  }, [position, panelWidth]);

  const handleBallMouseDown = useCallback((e: React.MouseEvent) => {
    setDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
    setDragOffset({ x: e.clientX - position.left, y: e.clientY - position.top });
  }, [position]);

  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      setPosition({
        left: Math.max(0, Math.min(e.clientX - dragOffset.x, window.innerWidth - BALL_SIZE)),
        top: Math.max(0, Math.min(e.clientY - dragOffset.y, window.innerHeight - BALL_SIZE)),
      });
    };

    const handleMouseUp = (e: MouseEvent) => {
      setDragging(false);
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance < 5) {
        setExpanded((prev) => !prev);
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragging, dragOffset, dragStart]);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setResizing(true);
    resizeStart.current = { x: e.clientX, width: panelWidth };
  }, [panelWidth]);

  useEffect(() => {
    if (!resizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = resizeStart.current.x - e.clientX;
      const newWidth = Math.max(320, Math.min(window.innerWidth - 16, resizeStart.current.width + dx));
      setPanelWidth(newWidth);
    };
    const handleMouseUp = () => setResizing(false);

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [resizing]);

  const runTool = useCallback(async () => {
    setLoading(true);
    setResult(null);
    try {
      const json = activeTool === "buildStats"
        ? await onGetStats()
        : await onGetItemCompareStats(slotName.trim(), itemRaw.trim());
      setResult(json);
      setResultView(activeTool === "itemCompare" ? "compare" : "raw");
    } catch (error) {
      setResult(`Error: ${error instanceof Error ? error.message : String(error)}`);
      setResultView("raw");
    } finally {
      setLoading(false);
    }
  }, [activeTool, itemRaw, onGetItemCompareStats, onGetStats, slotName]);

  const handleCopy = useCallback(() => {
    if (result) {
      navigator.clipboard.writeText(result);
    }
  }, [result]);

  const panelPos = getPanelPosition();

  return (
    <>
      <div
        ref={ballRef}
        className="pw:fixed pw:z-50 pw:rounded-full pw:flex pw:items-center pw:justify-center pw:select-none pw:text-white pw:font-bold"
        style={{
          top: position.top,
          left: position.left,
          width: BALL_SIZE,
          height: BALL_SIZE,
          pointerEvents: "auto",
          cursor: dragging ? "grabbing" : "grab",
          background: "radial-gradient(circle at 30% 28%, #bfdbfe, #2563eb 58%, #172554)",
          boxShadow: "0 4px 12px rgba(0,0,0,0.35), inset 0 -3px 8px rgba(0,0,0,0.35)",
          border: "2px solid rgba(255,255,255,0.7)",
        }}
        onMouseDown={handleBallMouseDown}
        title="测试工具（点击展开/收起，拖动移动）"
      >
        <span className="pw:text-base pw:leading-none pw:pointer-events-none">T</span>
      </div>

      {expanded && (
        <div
          className="pw:fixed pw:z-50 pw:bg-white pw:shadow-lg pw:rounded pw:border pw:border-gray-300 pw:text-gray-900"
          style={{ top: panelPos.top, left: panelPos.left, width: panelWidth, maxHeight: PANEL_MAX_HEIGHT, pointerEvents: "auto" }}
        >
          <div
            onMouseDown={handleResizeMouseDown}
            title="拖动调整宽度"
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: 6,
              cursor: "ew-resize",
              pointerEvents: "auto",
              zIndex: 10,
            }}
          />
          <div className="pw:flex pw:items-center pw:justify-between pw:px-3 pw:py-2 pw:border-b pw:border-gray-200">
            <div className="pw:font-semibold pw:text-sm">PoB 测试工具</div>
            <button type="button" onClick={() => setExpanded(false)} className="pw:text-gray-500 pw:hover:text-gray-800 pw:text-lg">×</button>
          </div>

          <div className="pw:grid pw:grid-cols-[120px_1fr] pw:max-h-[600px] pw:overflow-hidden">
            <div className="pw:border-r pw:border-gray-200 pw:bg-gray-50 pw:p-2 pw:space-y-1">
              <ToolButton active={activeTool === "itemCompare"} onClick={() => setActiveTool("itemCompare")}>装备对比</ToolButton>
              <ToolButton active={activeTool === "buildStats"} onClick={() => setActiveTool("buildStats")}>当前属性</ToolButton>
              <div className="pw:pt-2 pw:text-[10px] pw:text-gray-500">后续功能继续加到这里</div>
            </div>

            <div className="pw:p-3 pw:space-y-3 pw:overflow-auto">
              {activeTool === "itemCompare" ? (
                <div className="pw:space-y-2">
                  <div className="pw:text-xs pw:text-gray-600">获取替换/移除装备后的增减数据。留空物品文本=移除当前槽位装备。</div>
                  <label className="pw:block pw:text-xs pw:font-medium">
                    槽位
                    <input
                      type="text"
                      list="slot-options"
                      value={slotName}
                      onChange={(e) => setSlotName(e.target.value)}
                      className="pw:mt-1 pw:w-full pw:border pw:border-gray-300 pw:rounded pw:px-2 pw:py-1 pw:text-xs pw:bg-white"
                      placeholder="选择或输入槽位名称"
                    />
                    <datalist id="slot-options">
                      {SLOT_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </datalist>
                  </label>
                  <label className="pw:block pw:text-xs pw:font-medium">
                    新物品文本（可选）
                    <textarea
                      value={itemRaw}
                      onChange={(e) => setItemRaw(e.target.value)}
                      className="pw:mt-1 pw:w-full pw:h-20 pw:border pw:border-gray-300 pw:rounded pw:px-2 pw:py-1 pw:text-xs pw:font-mono"
                      placeholder="粘贴 PoB 物品文本；留空表示移除该槽位当前装备"
                    />
                  </label>
                </div>
              ) : (
                <div className="pw:text-xs pw:text-gray-600">读取当前构筑计算结果。</div>
              )}

              <button
                type="button"
                onClick={runTool}
                disabled={loading || (activeTool === "itemCompare" && !slotName.trim())}
                className="pw:w-full pw:bg-blue-500 pw:text-white pw:px-3 pw:py-2 pw:rounded pw:hover:bg-blue-600 pw:disabled:bg-gray-400 pw:disabled:cursor-not-allowed pw:text-sm pw:font-medium"
              >
                {loading ? "执行中..." : activeTool === "itemCompare" ? "获取装备对比" : "获取计算结果"}
              </button>

              {result && (
                <div>
                  <div className="pw:flex pw:justify-between pw:items-center pw:mb-2">
                    <div className="pw:flex pw:gap-1">
                      {activeTool === "itemCompare" && parsedCompareResult && (
                        <button
                          type="button"
                          onClick={() => setResultView("compare")}
                          className={`pw:px-2 pw:py-1 pw:rounded pw:text-xs ${resultView === "compare" ? "pw:bg-blue-500 pw:text-white" : "pw:bg-gray-100 pw:text-gray-700"}`}
                        >
                          对比查看
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setResultView("raw")}
                        className={`pw:px-2 pw:py-1 pw:rounded pw:text-xs ${resultView === "raw" ? "pw:bg-blue-500 pw:text-white" : "pw:bg-gray-100 pw:text-gray-700"}`}
                      >
                        原始 JSON
                      </button>
                    </div>
                    <button type="button" onClick={handleCopy} className="pw:text-xs pw:text-blue-500 pw:hover:text-blue-700">Copy JSON</button>
                  </div>

                  {resultView === "compare" && parsedCompareResult ? (
                    <CompareResultView result={parsedCompareResult} />
                  ) : (
                    <pre className="pw:bg-gray-100 pw:p-2 pw:text-xs pw:overflow-auto pw:max-h-72 pw:rounded pw:border pw:border-gray-200 pw:font-mono pw:whitespace-pre-wrap pw:break-words">
                      {result}
                    </pre>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

function ToolButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`pw:w-full pw:text-left pw:px-2 pw:py-1.5 pw:rounded pw:text-xs ${
        active ? "pw:bg-blue-500 pw:text-white" : "pw:text-gray-700 pw:hover:bg-gray-200"
      }`}
    >
      {children}
    </button>
  );
}

function CompareResultView({ result }: { result: CompareResult }) {
  const changes = result.changes ?? [];
  return (
    <div className="pw:border pw:border-gray-200 pw:rounded pw:overflow-hidden pw:text-xs">
      <div className="pw:bg-gray-50 pw:px-2 pw:py-1 pw:border-b pw:border-gray-200 pw:flex pw:justify-between">
        <span>{result.mode === "replace" ? "替换" : "移除"}：{result.slotName || "未知槽位"}</span>
        <span>{changes.length} 项变化</span>
      </div>
      <div className="pw:max-h-72 pw:overflow-auto">
        <table className="pw:w-full pw:border-collapse">
          <thead className="pw:sticky pw:top-0 pw:bg-white">
            <tr className="pw:border-b pw:border-gray-200 pw:text-gray-600">
              <th className="pw:text-left pw:px-2 pw:py-1">属性</th>
              <th className="pw:text-right pw:px-2 pw:py-1">之前</th>
              <th className="pw:text-right pw:px-2 pw:py-1">之后</th>
              <th className="pw:text-right pw:px-2 pw:py-1">变化</th>
            </tr>
          </thead>
          <tbody>
            {changes.map((change, index) => (
              <tr key={`${change.stat ?? change.label ?? "change"}-${index}`} className="pw:border-b pw:border-gray-100 last:pw:border-b-0">
                <td className="pw:px-2 pw:py-1 pw:max-w-32 pw:truncate" title={change.stat}>{change.label || change.stat}</td>
                <td className="pw:px-2 pw:py-1 pw:text-right pw:font-mono">{formatValue(change.before)}</td>
                <td className="pw:px-2 pw:py-1 pw:text-right pw:font-mono">{formatValue(change.after)}</td>
                <td className={`pw:px-2 pw:py-1 pw:text-right pw:font-mono ${change.positive ? "pw:text-green-600" : "pw:text-red-600"}`}>
                  {formatChange(change)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatValue(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatChange(change: CompareChange) {
  const diff = typeof change.diff === "number" && Number.isFinite(change.diff)
    ? change.diff.toLocaleString(undefined, { maximumFractionDigits: 2, signDisplay: "always" })
    : change.text || "-";
  if (typeof change.percent === "number" && Number.isFinite(change.percent)) {
    return `${diff} (${change.percent.toFixed(1)}%)`;
  }
  return diff;
}