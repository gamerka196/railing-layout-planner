import React from 'react';
import { Settings, Sliders, Ruler, Layers, Copy, X, Check, RotateCw } from 'lucide-react';
import { RailingRun, RailingOptions, StairDirection, GeneratedPost, RailSegment, CanvasShape } from '../types';
import { formatLength, getDistance } from '../utils/railingCalc';
import { getFixedShapeDimensions } from './DrawingCanvas';

export type CalculatedRun = RailingRun & {
  posts: GeneratedPost[];
  segments: RailSegment[];
  totalLength: number;
};

interface SidebarPanelProps {
  customerName: string;
  setCustomerName: (name: string) => void;
  options: RailingOptions;
  setOptions: React.Dispatch<React.SetStateAction<RailingOptions>>;
  totalFlatPicketsInches: number;
  totalStairPicketsInches: number;
  totalPostsCombined: number;
  runs: RailingRun[];
  setRuns: React.Dispatch<React.SetStateAction<RailingRun[]>>;
  activeRunId: string;
  setActiveRunId: (id: string) => void;
  commitCurrentStateToHistory: () => void;
  calculatedRuns: CalculatedRun[];
  tempFeet: string;
  setTempFeet: (val: string) => void;
  tempInches: string;
  setTempInches: (val: string) => void;
  tempTotalInches: string;
  setTempTotalInches: (val: string) => void;
  handleCommitLength: () => void;
  handleCommitTotalInches: () => void;
  handleStairOpeningToggle: (enabled: boolean) => void;
  handleStairOpeningParamChange: (param: string, value: any) => void;
  handleRotateStairRun?: () => void;
  handleAddRun: () => void;
  isFeet: boolean;
  activeRun?: RailingRun;
  activeRunLengthFeet: number;
  selectedShapeId?: string | null;
  setSelectedShapeId?: (id: string | null) => void;
  shapes?: CanvasShape[];
  handleDuplicateShape?: (shapeId: string) => void;
  handleDeleteShape?: (shapeId: string) => void;
}

export const SidebarPanel: React.FC<SidebarPanelProps> = ({
  customerName,
  setCustomerName,
  options,
  setOptions,
  totalFlatPicketsInches,
  totalStairPicketsInches,
  totalPostsCombined,
  runs,
  setRuns,
  activeRunId,
  setActiveRunId,
  commitCurrentStateToHistory,
  calculatedRuns,
  tempFeet,
  setTempFeet,
  tempInches,
  setTempInches,
  tempTotalInches,
  setTempTotalInches,
  handleCommitLength,
  handleCommitTotalInches,
  handleStairOpeningToggle,
  handleStairOpeningParamChange,
  handleRotateStairRun,
  handleAddRun,
  isFeet,
  activeRun,
  activeRunLengthFeet,
  selectedShapeId,
  setSelectedShapeId,
  shapes = [],
  handleDuplicateShape,
  handleDeleteShape,
}) => {
  React.useEffect(() => {
    if (options.maxPostSpacing && options.maxPostSpacing > 72) {
      setOptions(prev => ({ ...prev, maxPostSpacing: 72 }));
    }
  }, [options.maxPostSpacing, setOptions]);

  const selectedShape = shapes.find(s => s.id === selectedShapeId);

  const nonWallRuns = runs.filter(r => !r.isHouseWall);
  const hasPicketRun = nonWallRuns.some(r => (r.style || 'pickets') === 'pickets');
  const hasGlassRun = nonWallRuns.some(r => r.style === 'glass');
  const showPicketFields = nonWallRuns.length === 0 || hasPicketRun;
  const showGlassFields = hasGlassRun;

  // Local string states for installation and panel rate inputs to allow free typing without mid-keystroke clamping
  const [picketInstallRateInput, setPicketInstallRateInput] = React.useState<string>(
    (options.picketInstallRate !== undefined ? options.picketInstallRate : 25.30).toString()
  );
  const [glassInstallRateInput, setGlassInstallRateInput] = React.useState<string>(
    (options.glassInstallRate !== undefined ? options.glassInstallRate : 30.00).toString()
  );
  const [glassLandingRateInput, setGlassLandingRateInput] = React.useState<string>(
    (options.glassLandingPanelRate !== undefined ? options.glassLandingPanelRate : 30.00).toString()
  );

  React.useEffect(() => {
    setPicketInstallRateInput((options.picketInstallRate !== undefined ? options.picketInstallRate : 25.30).toString());
  }, [options.picketInstallRate]);

  React.useEffect(() => {
    setGlassInstallRateInput((options.glassInstallRate !== undefined ? options.glassInstallRate : 30.00).toString());
  }, [options.glassInstallRate]);

  React.useEffect(() => {
    setGlassLandingRateInput((options.glassLandingPanelRate !== undefined ? options.glassLandingPanelRate : 30.00).toString());
  }, [options.glassLandingPanelRate]);

  const attachedRunsList = React.useMemo(() => {
    if (!selectedShape) return [];
    if (selectedShape.type !== 'square_column' && selectedShape.type !== 'circular_column') return [];

    const dims = getFixedShapeDimensions(selectedShape.type);
    const attachDist = Math.max(dims.width, dims.height) / 2 + 8;
    const colCenter = { x: selectedShape.x, y: selectedShape.y };
    const list: { runId: string; runIndex: number; endType: 'Start' | 'End'; distance: number }[] = [];

    runs.forEach((run, rIdx) => {
      if (run.isHouseWall || !run.points || run.points.length < 2) return;
      const p1 = run.points[0];
      const p2 = run.points[1];

      if (run.startIsColumn && getDistance(colCenter, p1) <= attachDist) {
        list.push({ runId: run.id, runIndex: rIdx + 1, endType: 'Start', distance: getDistance(colCenter, p1) });
      }
      if (run.endIsColumn && getDistance(colCenter, p2) <= attachDist) {
        list.push({ runId: run.id, runIndex: rIdx + 1, endType: 'End', distance: getDistance(colCenter, p2) });
      }
    });

    return list;
  }, [selectedShape, runs]);
  return (
    <>
      {/* Global Project Settings Card */}
      <div id="global-project-settings-card" className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col gap-4">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
          <span className="p-1.5 bg-teal-50 rounded-lg text-teal-600">
            <Settings size={16} className="stroke-[2.5]" />
          </span>
          <h2 className="text-base font-bold uppercase tracking-wider text-slate-800">Global Project Settings</h2>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* Client / Project Name Input */}
          <div className="space-y-1.5 col-span-2">
            <label htmlFor="global-customer-input" className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
              Client / Project Name (For PDF Export)
            </label>
            <input
              id="global-customer-input"
              type="text"
              placeholder="e.g. Smith Residence - Toronto, ON"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-semibold text-slate-800 focus:outline-none focus:border-teal-500/50 focus:ring-2 focus:ring-teal-500/10 transition-all placeholder:text-slate-400 placeholder:font-normal"
            />
          </div>

          {/* Height Dropdown */}
          <div className="space-y-1.5">
            <label htmlFor="global-height-select" className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
              Height (Inches)
            </label>
            <select
              id="global-height-select"
              value={options.height}
              onChange={(e) => setOptions(prev => ({ ...prev, height: Number(e.target.value) as 36 | 42 }))}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-semibold text-slate-800 focus:outline-none focus:border-teal-500/50 focus:ring-2 focus:ring-teal-500/10 transition-all cursor-pointer"
            >
              <option value={36}>36"</option>
              <option value={42}>42"</option>
            </select>
          </div>

          {/* Installed Dropdown */}
          <div className="space-y-1.5">
            <label htmlFor="global-installed-select" className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
              Installed?
            </label>
            <select
              id="global-installed-select"
              value={options.installed ? 'Yes' : 'No'}
              onChange={(e) => setOptions(prev => ({ ...prev, installed: e.target.value === 'Yes' }))}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-semibold text-slate-800 focus:outline-none focus:border-teal-500/50 focus:ring-2 focus:ring-teal-500/10 transition-all cursor-pointer"
            >
              <option value="Yes">Yes</option>
              <option value="No">No</option>
            </select>
          </div>

          {/* Removal & Disposal Input */}
          <div className="space-y-1.5">
            <label htmlFor="global-removal-cost-input" className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
              REMOVAL & DISPOSAL
            </label>
            <div className="relative flex items-center">
              <span className="absolute left-3 text-xs font-bold text-slate-400 pointer-events-none">$</span>
              <input
                id="global-removal-cost-input"
                type="number"
                min={0}
                step={50}
                value={options.removalCost || ''}
                placeholder="0"
                onChange={(e) => {
                  const val = Math.max(0, parseFloat(e.target.value) || 0);
                  setOptions((prev) => ({ ...prev, removalCost: val }));
                }}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-7 pr-3 py-2 text-sm font-semibold text-slate-800 focus:outline-none focus:border-teal-500/50 focus:ring-2 focus:ring-teal-500/10 transition-all font-mono"
              />
            </div>
          </div>

          {/* Contractor Discount Input */}
          <div className="space-y-1.5">
            <label htmlFor="global-contractor-discount-input" className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
              CONTRACTOR DISCOUNT
            </label>
            <div className="relative flex items-center">
              <input
                id="global-contractor-discount-input"
                type="number"
                min={0}
                max={20}
                step={1}
                value={options.contractorDiscountPercent || ''}
                placeholder="0"
                onChange={(e) => {
                  const rawVal = parseFloat(e.target.value) || 0;
                  const val = Math.min(20, Math.max(0, rawVal));
                  setOptions((prev) => ({ ...prev, contractorDiscountPercent: val }));
                }}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-3 pr-7 py-2 text-sm font-semibold text-slate-800 focus:outline-none focus:border-teal-500/50 focus:ring-2 focus:ring-teal-500/10 transition-all font-mono"
              />
              <span className="absolute right-3 text-xs font-bold text-slate-400 pointer-events-none">%</span>
            </div>
          </div>

          {/* System Color Dropdown */}
          <div className="space-y-1.5">
            <label htmlFor="global-color-select" className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
              System Color
            </label>
            <select
              id="global-color-select"
              value={options.systemColor === ('Matte Bronze' as any) ? 'Bronze' : options.systemColor}
              onChange={(e) => setOptions(prev => ({ ...prev, systemColor: e.target.value as any }))}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-semibold text-slate-800 focus:outline-none focus:border-teal-500/50 focus:ring-2 focus:ring-teal-500/10 transition-all cursor-pointer"
            >
              <option value="Bronze">Bronze</option>
              <option value="Gloss Black">Gloss Black</option>
              <option value="Matte Black">Matte Black</option>
              <option value="White">White</option>
            </select>
          </div>

          {/* Surface Type Dropdown */}
          <div className="space-y-1.5">
            <label htmlFor="global-surface-select" className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
              Surface Type (Hardware)
            </label>
            <select
              id="global-surface-select"
              value={options.surfaceType}
              onChange={(e) => setOptions(prev => ({ ...prev, surfaceType: e.target.value as 'Concrete' | 'Wood' }))}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-semibold text-slate-800 focus:outline-none focus:border-teal-500/50 focus:ring-2 focus:ring-teal-500/10 transition-all cursor-pointer"
            >
              <option value="Wood">Wood</option>
              <option value="Concrete">Concrete</option>
            </select>
          </div>

          {/* Max Post Spacing Dropdown */}
          {showPicketFields && (
            <div className="space-y-1.5">
              <label htmlFor="global-max-post-spacing-select" className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                Max Post Spacing
              </label>
              <select
                id="global-max-post-spacing-select"
                value={Math.min(72, options.maxPostSpacing || 60)}
                onChange={(e) => setOptions(prev => ({ ...prev, maxPostSpacing: Number(e.target.value) }))}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-semibold text-slate-800 focus:outline-none focus:border-teal-500/50 focus:ring-2 focus:ring-teal-500/10 transition-all cursor-pointer"
              >
                <option value={48}>48"</option>
                <option value={60}>60"</option>
                <option value={72}>72"</option>
              </select>
            </div>
          )}

          {/* Installation Rates Subsection */}
          {(showPicketFields || showGlassFields) && (
            <div className="col-span-2 pt-3 border-t border-slate-100 space-y-2">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block font-mono">
                Installation Rates
              </span>
              <div className="grid grid-cols-2 gap-3">
                {/* Picket Rate Input */}
                {showPicketFields && (
                  <div className="space-y-1.5">
                    <label htmlFor="global-picket-install-rate-input" className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                      PICKET RATE ($/FT)
                    </label>
                    <div className="relative flex items-center">
                      <span className="absolute left-3 text-xs font-bold text-slate-400 pointer-events-none">$</span>
                      <input
                        type="number"
                        id="global-picket-install-rate-input"
                        min={0}
                        step={0.5}
                        value={picketInstallRateInput}
                        onChange={(e) => setPicketInstallRateInput(e.target.value)}
                        onBlur={() => {
                          const val = parseFloat(picketInstallRateInput);
                          const clamped = Math.max(0, isNaN(val) ? 25.30 : val);
                          setOptions((prev) => ({ ...prev, picketInstallRate: clamped }));
                          setPicketInstallRateInput(clamped.toString());
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            (e.target as HTMLInputElement).blur();
                          }
                        }}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-7 pr-3 py-2 text-sm font-semibold text-slate-800 focus:outline-none focus:border-teal-500/50 focus:ring-2 focus:ring-teal-500/10 transition-all font-mono"
                      />
                    </div>
                  </div>
                )}

                {/* Glass Rate Input */}
                {showGlassFields && (
                  <div className="space-y-1.5">
                    <label htmlFor="global-glass-install-rate-input" className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                      GLASS RATE ($/FT)
                    </label>
                    <div className="relative flex items-center">
                      <span className="absolute left-3 text-xs font-bold text-slate-400 pointer-events-none">$</span>
                      <input
                        type="number"
                        id="global-glass-install-rate-input"
                        min={0}
                        step={0.5}
                        value={glassInstallRateInput}
                        onChange={(e) => setGlassInstallRateInput(e.target.value)}
                        onBlur={() => {
                          const val = parseFloat(glassInstallRateInput);
                          const clamped = Math.max(0, isNaN(val) ? 30.00 : val);
                          setOptions((prev) => ({ ...prev, glassInstallRate: clamped }));
                          setGlassInstallRateInput(clamped.toString());
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            (e.target as HTMLInputElement).blur();
                          }
                        }}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-7 pr-3 py-2 text-sm font-semibold text-slate-800 focus:outline-none focus:border-teal-500/50 focus:ring-2 focus:ring-teal-500/10 transition-all font-mono"
                      />
                    </div>
                  </div>
                )}

                {/* Glass Landing Rate Input */}
                {showGlassFields && (
                  <div className="space-y-1.5">
                    <label htmlFor="global-glass-landing-rate-input" className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                      GLASS LANDING RATE ($/FT)
                    </label>
                    <div className="relative flex items-center">
                      <span className="absolute left-3 text-xs font-bold text-slate-400 pointer-events-none">$</span>
                      <input
                        type="number"
                        id="global-glass-landing-rate-input"
                        min="14"
                        max="80"
                        step="0.01"
                        value={glassLandingRateInput}
                        onChange={(e) => setGlassLandingRateInput(e.target.value)}
                        onBlur={() => {
                          const val = Number(glassLandingRateInput);
                          const clamped = Math.min(80, Math.max(14, isNaN(val) ? 30 : val));
                          setOptions(prev => ({ ...prev, glassLandingPanelRate: clamped }));
                          setGlassLandingRateInput(clamped.toString());
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            (e.target as HTMLInputElement).blur();
                          }
                        }}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-7 pr-3 py-2 text-sm font-semibold text-slate-800 focus:outline-none focus:border-teal-500/50 focus:ring-2 focus:ring-teal-500/10 transition-all font-mono"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Object Settings Card (when a shape is selected) */}
      {selectedShape && (
        <div id="object-settings-card" className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col gap-4 animate-in fade-in duration-150">
          {/* Header */}
          <div className="flex items-start justify-between border-b border-slate-100 pb-3">
            <div>
              <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest block font-mono">
                ACTIVE SELECTION PROPERTIES
              </span>
              <h2 className="text-base font-bold uppercase tracking-wider text-slate-800 mt-0.5">
                OBJECT SETTINGS
              </h2>
              <span className="text-[13px] font-semibold text-slate-500 block mt-0.5">
                ({selectedShape.type === 'square_column' ? 'Square Column' : selectedShape.type === 'circular_column' ? 'Circular Column' : selectedShape.label || 'Canvas Object'})
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {handleDuplicateShape && (
                <button
                  onClick={() => handleDuplicateShape(selectedShape.id)}
                  className="px-2 py-1 text-[11px] font-black text-teal-700 bg-teal-50 border border-teal-200 hover:bg-teal-100 rounded-lg transition-colors uppercase tracking-wider cursor-pointer flex items-center gap-1"
                  title="Duplicate this object"
                >
                  <Copy size={11} />
                  <span>DUPLICATE</span>
                </button>
              )}
              {handleDeleteShape && (
                <button
                  onClick={() => handleDeleteShape(selectedShape.id)}
                  className="px-2 py-1 text-[11px] font-black text-rose-600 bg-rose-50 border border-rose-200 hover:bg-rose-100 rounded-lg transition-colors uppercase tracking-wider cursor-pointer"
                >
                  DELETE
                </button>
              )}
              {setSelectedShapeId && (
                <button
                  onClick={() => setSelectedShapeId(null)}
                  className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                  title="Close Selection Properties"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          {/* Object Dimensions / Size Display */}
          <div className="space-y-2 border-b border-slate-100 pb-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-extrabold text-slate-600 uppercase tracking-wider">
                DIMENSIONS & SIZE
              </span>
              <span className="text-[11px] font-mono font-bold text-teal-700 bg-teal-50 px-2 py-0.5 rounded border border-teal-200">
                {formatLength(getFixedShapeDimensions(selectedShape.type).width, isFeet)} × {formatLength(getFixedShapeDimensions(selectedShape.type).height, isFeet)}
              </span>
            </div>
          </div>

          {/* Column Settings Section */}
          {(selectedShape.type === 'square_column' || selectedShape.type === 'circular_column') && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-extrabold text-slate-600 uppercase tracking-wider">
                  ATTACHED RUNS
                </span>
              </div>

              {attachedRunsList.length === 0 ? (
                <div className="p-3 bg-slate-50 border border-dashed border-slate-200 rounded-xl text-center">
                  <p className="text-xs text-slate-500 font-medium leading-relaxed">
                    No railing runs attached to this column yet. Drag a run's end post next to this column to attach top & bottom brackets automatically.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {attachedRunsList.map((item) => (
                    <div
                      key={`${item.runId}-${item.endType}`}
                      className="flex items-center justify-between p-3 rounded-xl border border-teal-300 bg-teal-50/90 shadow-2xs"
                    >
                      <div className="flex items-center gap-2">
                        <Check size={14} className="text-teal-600 shrink-0" />
                        <div>
                          <span className="text-xs font-bold text-slate-900 block">
                            Railing Section {item.runIndex} ({item.endType})
                          </span>
                          <span className="text-[11px] font-semibold text-teal-700 block mt-0.5">
                            Top & Bottom Bracket Set ($24.44)
                          </span>
                        </div>
                      </div>
                      <span className="text-[10px] font-mono font-bold text-teal-800 bg-teal-100/80 px-2 py-0.5 rounded border border-teal-300 uppercase">
                        ATTACHED
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Explanatory footer notes */}
              <div className="pt-2 border-t border-slate-100 text-[11px] text-slate-500 leading-snug space-y-1 font-sans">
                <p>Column attachment is automatic based on proximity to run endpoints.</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Live Summary Card */}
      <div id="live-summary-card" className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col gap-4">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
          <span className="p-1.5 bg-teal-50 rounded-lg text-teal-600">
            <Sliders size={16} className="stroke-[2.5]" />
          </span>
          <h2 className="text-base font-bold uppercase tracking-wider text-slate-800">Live Summary</h2>
        </div>

        {/* Metrics Breakdown */}
        <div className="grid grid-cols-3 gap-3">
          <div id="flat-pickets-metric" className="bg-slate-50 border border-slate-100 rounded-xl p-3 flex flex-col justify-between">
            <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">Flat Pickets</span>
            <span className="text-sm font-extrabold text-slate-900 font-mono mt-1.5 truncate">
              {formatLength(totalFlatPicketsInches, true)}
            </span>
            <span className="text-[9px] text-slate-400 mt-1 block">Level</span>
          </div>

          <div id="stair-pickets-metric" className="bg-slate-50 border border-slate-100 rounded-xl p-3 flex flex-col justify-between">
            <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">Stair Pickets</span>
            <span className="text-sm font-extrabold text-slate-900 font-mono mt-1.5 truncate">
              {formatLength(totalStairPicketsInches, true)}
            </span>
            <span className="text-[9px] text-slate-400 mt-1 block">Stair</span>
          </div>

          <div id="total-posts-metric" className="bg-slate-50 border border-slate-100 rounded-xl p-3 flex flex-col justify-between">
            <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">Total Posts</span>
            <span className="text-sm font-extrabold text-slate-900 font-mono mt-1.5 truncate">
              {totalPostsCombined}
            </span>
            <span className="text-[9px] text-slate-400 mt-1 block">Posts</span>
          </div>
        </div>
      </div>

      {/* Controls Card */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col gap-6">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2.5">
            <Sliders size={18} className="text-slate-700" />
            <h2 className="text-base font-bold uppercase tracking-wider text-slate-800">Railing Run Controls</h2>
          </div>
          <span className="text-[11px] font-mono font-bold bg-teal-50 text-teal-700 px-2 py-0.5 rounded-full">
            {runs.length > 0 ? `Active: Run #${runs.findIndex(r => r.id === activeRunId) + 1}` : 'No Active Run'}
          </span>
        </div>

        {/* A. Unit Format Toggle */}
        <div className="space-y-2">
          <label className="text-[13px] font-semibold text-slate-600 flex items-center gap-1.5">
            <Ruler size={13} className="text-slate-500" />
            Measurement Display Unit
          </label>
          <div className="grid grid-cols-2 gap-2 bg-slate-50 p-1 rounded-xl border border-slate-200">
            <button
              onClick={() => setOptions(prev => ({ ...prev, unitMode: 'feet' }))}
              className={`py-2 text-xs font-bold rounded-lg transition-all ${
                isFeet
                  ? 'bg-white text-slate-900 shadow-sm border border-slate-250 font-extrabold'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              Feet & Inches
            </button>
            <button
              onClick={() => setOptions(prev => ({ ...prev, unitMode: 'inches' }))}
              className={`py-2 text-xs font-bold rounded-lg transition-all ${
                !isFeet
                  ? 'bg-white text-slate-900 shadow-sm border border-slate-250 font-extrabold'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              Inches Only
            </button>
          </div>
        </div>

        {/* House Wall Toggle */}
        {activeRun && (
          <div className="flex items-center justify-between p-3.5 bg-slate-50 border border-slate-200 rounded-xl" id="house-wall-toggle-container">
            <div className="flex flex-col gap-0.5">
              <span className="text-[13px] font-bold text-slate-800">Designate as House Wall</span>
              <p className="text-[11px] text-slate-400 leading-normal">Converts this run to a house wall segment (no posts, rails, or pickets)</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer select-none shrink-0">
              <input
                type="checkbox"
                checked={!!activeRun.isHouseWall}
                onChange={(e) => {
                  const checked = e.target.checked;
                  commitCurrentStateToHistory();
                  setRuns(prev => prev.map(r => r.id === activeRunId ? { ...r, isHouseWall: checked } : r));
                }}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-teal-600"></div>
            </label>
          </div>
        )}

        {/* Railing Style Dropdown */}
        {activeRun && (
          <div className="space-y-1.5" id="railing-style-select-container">
            <label htmlFor="railing-style-select" className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
              RAILING STYLE
            </label>
            <select
              id="railing-style-select"
              value={activeRun.style || 'pickets'}
              onChange={(e) => {
                const newStyle = e.target.value as 'pickets' | 'glass';
                commitCurrentStateToHistory();
                setRuns(prev => prev.map(r => r.id === activeRunId ? { ...r, style: newStyle } : r));
              }}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-semibold text-slate-800 focus:outline-none focus:border-teal-500/50 focus:ring-2 focus:ring-teal-500/10 transition-all cursor-pointer"
            >
              <option value="pickets">Pickets</option>
              <option value="glass">Glass</option>
            </select>
          </div>
        )}

        {activeRun && activeRun.style === 'glass' && (
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
              Post Spacing
            </label>
            <div className="w-full bg-slate-100 border border-slate-200 rounded-xl px-3 py-2 text-sm font-semibold text-slate-500">
              60" -- fixed for glass
            </div>
          </div>
        )}



        {/* C. Manual Precision Inputs */}
        <div className={`space-y-3 transition-all duration-200 ${runs.length === 0 ? 'bg-slate-50/50 p-3.5 border border-dashed border-slate-200 rounded-xl' : ''}`}>
          <label className="text-[13px] font-semibold text-slate-600 flex items-center gap-1.5">
            <Settings size={13} className="text-slate-500" />
            Set Run
          </label>

          {runs.length === 0 ? (
            <p className="text-[11px] text-slate-400 font-sans leading-normal">
              No active run. <strong>Click & drag anywhere on the grid canvas</strong> to draw a run, then use these manual controls to set its exact length.
            </p>
          ) : activeRun && (
            <div className="space-y-3">
              {isFeet ? (
                /* Feet & Inches Dual Input Row */
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Feet</span>
                    <div className="relative flex items-center">
                      <input
                        type="number"
                        min={0}
                        max={60}
                        value={tempFeet}
                        onChange={(e) => setTempFeet(e.target.value)}
                        onBlur={handleCommitLength}
                        onKeyDown={(e) => e.key === 'Enter' && handleCommitLength()}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-3.5 pr-8 py-2.5 text-sm font-mono font-bold text-slate-800 focus:outline-none focus:border-teal-500/50 focus:ring-2 focus:ring-teal-500/10 transition-all"
                      />
                      <span className="absolute right-3 text-xs font-bold text-slate-400 pointer-events-none">ft</span>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Inches</span>
                    <div className="relative flex items-center">
                      <input
                        type="number"
                        min={0}
                        max={11}
                        value={tempInches}
                        onChange={(e) => setTempInches(e.target.value)}
                        onBlur={handleCommitLength}
                        onKeyDown={(e) => e.key === 'Enter' && handleCommitLength()}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-3.5 pr-8 py-2.5 text-sm font-mono font-bold text-slate-800 focus:outline-none focus:border-teal-500/50 focus:ring-2 focus:ring-teal-500/10 transition-all"
                      />
                      <span className="absolute right-3 text-xs font-bold text-slate-400 pointer-events-none">in</span>
                    </div>
                  </div>
                </div>
              ) : (
                /* Single Total Inches Input Row */
                <div className="space-y-1">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Total Inches</span>
                  <div className="relative flex items-center">
                    <input
                      type="number"
                      min={12}
                      max={720}
                      value={tempTotalInches}
                      onChange={(e) => setTempTotalInches(e.target.value)}
                      onBlur={handleCommitTotalInches}
                      onKeyDown={(e) => e.key === 'Enter' && handleCommitTotalInches()}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-3.5 pr-8 py-2.5 text-sm font-mono font-bold text-slate-800 focus:outline-none focus:border-teal-500/50 focus:ring-2 focus:ring-teal-500/10 transition-all"
                    />
                    <span className="absolute right-3 text-xs font-bold text-slate-400 pointer-events-none">in</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* D. Stair Opening Options (Only shown when active run is horizontal/vertical) */}
        {activeRun && (activeRun.orientation === 'horizontal' || activeRun.orientation === 'vertical') && (
          <div className="space-y-3 pt-3 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <label className="text-[13px] font-bold text-slate-800 flex items-center gap-1.5">
                <Layers size={14} className="text-teal-600" />
                Add Stairs
              </label>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={activeRun.stairOpening?.enabled ?? false}
                  onChange={(e) => handleStairOpeningToggle(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-teal-600"></div>
              </label>
            </div>

            {activeRun.stairOpening?.enabled && (
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-3 animate-in fade-in duration-150">
                {/* Stair Opening Offset */}
                <div className="space-y-1">
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="font-bold text-slate-500 uppercase tracking-wider">Start Offset</span>
                    <span className="font-mono font-bold text-slate-800">
                      {formatLength(activeRun.stairOpening.leftOffset * 12, isFeet)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, Math.floor(activeRunLengthFeet - activeRun.stairOpening.openingWidth))}
                    step={0.5}
                    value={activeRun.stairOpening.leftOffset}
                    onChange={(e) => handleStairOpeningParamChange('leftOffset', parseFloat(e.target.value))}
                    className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-teal-600"
                  />
                </div>

                {/* Stair Opening Width */}
                <div className="space-y-1">
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="font-bold text-slate-500 uppercase tracking-wider">Opening Width</span>
                    <span className="font-mono font-bold text-slate-800">
                      {formatLength(activeRun.stairOpening.openingWidth * 12, isFeet)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={2}
                    max={Math.max(2, Math.floor(activeRunLengthFeet - activeRun.stairOpening.leftOffset))}
                    step={0.5}
                    value={activeRun.stairOpening.openingWidth}
                    onChange={(e) => handleStairOpeningParamChange('openingWidth', parseFloat(e.target.value))}
                    className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-teal-600"
                  />
                </div>

                {/* Stair Riser Count */}
                <div className="space-y-1">
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="font-bold text-slate-500 uppercase tracking-wider">Stair Risers</span>
                    <span className="font-mono font-bold text-slate-800">{activeRun.stairOpening.risers} risers</span>
                  </div>
                  <input
                    type="range"
                    min={2}
                    max={15}
                    step={1}
                    value={activeRun.stairOpening.risers}
                    onChange={(e) => handleStairOpeningParamChange('risers', parseInt(e.target.value, 10))}
                    className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-teal-600"
                  />
                </div>

                {/* Stair Sides Dropdown */}
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Stair Railing Sides</label>
                  <select
                    value={activeRun.stairOpening.sides}
                    onChange={(e) => handleStairOpeningParamChange('sides', e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-800 focus:outline-none focus:border-teal-500"
                  >
                    <option value="1">1 Side Only</option>
                    <option value="2">2 Sides (Both)</option>
                  </select>
                </div>

                {/* Direction Dropdown */}
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Stair Direction</label>
                  <select
                    value={activeRun.stairOpening.direction}
                    onChange={(e) => handleStairOpeningParamChange('direction', e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-800 focus:outline-none focus:border-teal-500"
                  >
                    {activeRun.orientation === 'horizontal' ? (
                      <>
                        <option value={StairDirection.DOWN}>Descending Down (South)</option>
                        <option value={StairDirection.UP}>Ascending Up (North)</option>
                      </>
                    ) : (
                      <>
                        <option value={StairDirection.RIGHT}>Descending Right (East)</option>
                        <option value={StairDirection.LEFT}>Ascending Left (West)</option>
                      </>
                    )}
                  </select>
                </div>

                {/* Rotate Run Orientation Button */}
                {handleRotateStairRun && (
                  <div className="pt-2 border-t border-slate-200/80">
                    <button
                      type="button"
                      onClick={handleRotateStairRun}
                      className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg text-xs font-bold text-slate-800 transition-all cursor-pointer shadow-2xs hover:border-slate-400 active:scale-[0.99]"
                    >
                      <RotateCw size={14} className="text-teal-600 shrink-0" />
                      <span>ROTATE RUN 90° ({activeRun.orientation === 'horizontal' ? 'Vertical' : 'Horizontal'})</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

      </div>
    </>
  );
};
