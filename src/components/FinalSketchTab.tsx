/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useMemo } from 'react';
import {
  RailingRun,
  RailingOptions,
  CanvasShape,
  GeneratedPost,
  RailSegment,
} from '../types';
import { formatLength } from '../utils/railingCalc';
import { exportSketchPdf } from '../utils/exportSketchPdf';
import DrawingCanvas from './DrawingCanvas';
import { FileDown, Layers, Compass } from 'lucide-react';
import tdrLogoImg from '../assets/tdr-logo.png';

interface FinalSketchTabProps {
  runs: RailingRun[];
  shapes: CanvasShape[];
  options: RailingOptions;
  customerName?: string;
  calculatedRuns: (RailingRun & {
    posts: GeneratedPost[];
    segments: RailSegment[];
    totalLength: number;
  })[];
  isTabActive?: boolean;
}

export function FinalSketchTab({
  runs,
  shapes,
  options,
  customerName,
  calculatedRuns,
  isTabActive = true,
}: FinalSketchTabProps) {
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const [logoError, setLogoError] = useState<boolean>(false);
  const [isExportingPdf, setIsExportingPdf] = useState<boolean>(false);

  const shapeList = shapes || [];

  const formatFeetOnly = (inches: number): string => {
    const feet = Math.round(inches / 12);
    return `${feet}'`;
  };

  // Combined post list from prop calculatedRuns
  const allPostsCombined = useMemo(() => {
    return calculatedRuns.flatMap((cr) => cr.posts);
  }, [calculatedRuns]);

  // Billable lengths
  const totalFlatPicketsInches = useMemo(() => {
    return calculatedRuns.reduce((sum, run) => {
      if (run.isHouseWall) return sum;
      return (
        sum +
        run.segments
          .filter((seg) => !seg.isStairOpening)
          .reduce((s, seg) => s + seg.length, 0)
      );
    }, 0);
  }, [calculatedRuns]);

  const totalStairPicketsInches = useMemo(() => {
    return calculatedRuns.reduce((sum, run) => {
      if (run.isHouseWall) return sum;
      if (run.stairOpening?.enabled) {
        const steps = run.stairOpening.risers;
        const sides = run.stairOpening.sides === '2' ? 2 : 1;
        const stairRailLF = (steps * Math.sqrt(193)) / 12;
        const stairBillableLF = stairRailLF * sides;
        return sum + stairBillableLF * 12;
      }
      return sum;
    }, 0);
  }, [calculatedRuns]);

  // Style presence flags shared by project details and drawing legend
  const hasPicketRun = useMemo(() => {
    return calculatedRuns.some(
      (cr) => !cr.isHouseWall && cr.style === 'pickets' && cr.segments.some((s) => !s.isStairOpening)
    );
  }, [calculatedRuns]);

  const hasGlassRun = useMemo(() => {
    return calculatedRuns.some(
      (cr) => !cr.isHouseWall && cr.style === 'glass' && cr.segments.some((s) => !s.isStairOpening)
    );
  }, [calculatedRuns]);

  // Presence flags for Drawing Legend
  const legendFlags = useMemo(() => {
    const hasPicketRailing = hasPicketRun;
    const hasGlassRailing = hasGlassRun;
    const hasStairRailing = calculatedRuns.some(
      (cr) => !cr.isHouseWall && cr.stairOpening?.enabled
    );
    const hasEndPost = allPostsCombined.some(
      (p) => (p.type === 'end' || p.type === 'start') && !p.isDuplicate
    );
    const hasCornerPost = allPostsCombined.some(
      (p) => p.type === 'corner' && !p.isDuplicate
    );
    const hasAnglePost = allPostsCombined.some(
      (p) => p.type === 'angle' && !p.isDuplicate
    );
    const hasLinePost = allPostsCombined.some(
      (p) => p.type === 'line' && !p.isDuplicate
    );
    const hasStairPost = allPostsCombined.some(
      (p) => p.type === 'stair' && !p.isDuplicate
    );
    const hasColumnBracket =
      calculatedRuns.some((cr) => cr.startIsColumn || cr.endIsColumn) ||
      allPostsCombined.some((p) => p.isColumn);
    const hasSquareColumn = shapeList.some(
      (s) => s.type === 'square_column' || s.type === 'circular_column'
    );
    const hasHouseWall = runs.some((r) => r.isHouseWall);

    return {
      hasPicketRailing,
      hasGlassRailing,
      hasStairRailing,
      hasEndPost,
      hasCornerPost,
      hasAnglePost,
      hasLinePost,
      hasStairPost,
      hasColumnBracket,
      hasSquareColumn,
      hasHouseWall,
    };
  }, [calculatedRuns, allPostsCombined, shapeList, runs]);

  const hasContent = runs.length > 0 || shapeList.length > 0;

  // Export PDF Action
  const handleDownloadPdf = async () => {
    if (!hasContent || isExportingPdf) return;
    setIsExportingPdf(true);

    try {
      const totalInches = calculatedRuns.reduce(
        (sum, cr) => (cr.isHouseWall ? sum : sum + cr.totalLength),
        0
      );
      const totalPostsCount = calculatedRuns.reduce((sum, cr) => {
        if (cr.isHouseWall) return sum;
        return (
          sum +
          cr.posts.filter((p, pIdx) => {
            if (p.isDuplicate) return false;
            const isStartColumn = pIdx === 0 && cr.startIsColumn;
            const isEndColumn = pIdx === cr.posts.length - 1 && cr.endIsColumn;
            if (isStartColumn || isEndColumn) return false;
            if (p.isColumn) return false;
            return true;
          }).length
        );
      }, 0);

      await exportSketchPdf({
        runs,
        calculatedRuns,
        shapes: shapeList,
        options,
        customerName,
        totalLengthInches: totalInches,
        totalPosts: totalPostsCount,
        canvasContainerElement: canvasContainerRef.current,
      });
    } catch (err) {
      console.error('PDF export error:', err);
    } finally {
      setIsExportingPdf(false);
    }
  };

  return (
    <div className="flex flex-col w-full min-h-[700px] bg-white text-slate-900 rounded-2xl border border-slate-200 shadow-md p-6 lg:p-8 space-y-6">
      {/* 1. TOP HEADER WITH LOGO, TITLE, SUBTITLE & DOWNLOAD BUTTON */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between pb-6 border-b border-slate-200/80 gap-4">
        <div className="space-y-2">
          {!logoError ? (
            <img
              src={tdrLogoImg}
              alt="Toronto Deck and Rail Logo"
              className="h-36 w-auto object-contain"
              onError={() => setLogoError(true)}
            />
          ) : (
            <div className="bg-slate-900 text-white font-extrabold px-3 py-1.5 rounded text-sm tracking-tight inline-block">
              TORONTO DECK AND RAIL
            </div>
          )}
          <div>
            <h2 className="text-2xl font-serif font-bold text-slate-800 tracking-tight">
              Final Blueprint Layout
            </h2>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              Generated structural layout and architectural specs
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:items-end gap-2">
          <button
            onClick={handleDownloadPdf}
            disabled={!hasContent || isExportingPdf}
            className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 active:bg-black disabled:opacity-50 text-white font-extrabold text-xs tracking-wider rounded-lg shadow-sm transition-all flex items-center gap-2 cursor-pointer uppercase border border-slate-900"
          >
            <FileDown size={15} className={isExportingPdf ? 'animate-bounce' : ''} />
            <span>{isExportingPdf ? 'Generating PDF...' : 'DOWNLOAD SKETCH'}</span>
          </button>

          {customerName && customerName.trim() !== '' && (
            <div className="inline-flex items-center gap-2 bg-slate-100 text-slate-800 px-3 py-1 rounded-full text-xs font-semibold border border-slate-200/80">
              <span className="text-[10px] uppercase tracking-wider font-extrabold text-slate-500">CLIENT</span>
              <span className="w-[1px] h-3 bg-slate-300"></span>
              <span className="font-bold">{customerName.trim()}</span>
            </div>
          )}
        </div>
      </div>

      {/* 3. MAIN TWO COLUMN AREA */}
      {!hasContent ? (
        <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl p-12 text-center space-y-3 my-6">
          <Compass size={36} className="mx-auto text-slate-400 stroke-[1.5]" />
          <h3 className="text-base font-bold text-slate-700">No layout drawn yet</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Switch to the <strong>2D Layout Plan</strong> tab and draw your railing runs or add columns to generate the final sketch blueprint.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* LEFT COLUMN (~70%): Clean READ-ONLY DrawingCanvas */}
          <div
            ref={canvasContainerRef}
            className="lg:col-span-8 bg-slate-50 rounded-2xl border border-slate-200 h-[650px] relative overflow-hidden shadow-inner flex flex-col"
          >
            <DrawingCanvas
              readOnly={true}
              isActive={isTabActive}
              runs={runs}
              setRuns={() => {}}
              shapes={shapes}
              setShapes={() => {}}
              selectedShapeId={null}
              setSelectedShapeId={() => {}}
              activeRunId=""
              setActiveRunId={() => {}}
              options={options}
              setOptions={() => {}}
              calculatedRuns={calculatedRuns}
              onStartAction={() => {}}
              undo={() => {}}
              redo={() => {}}
              canUndo={false}
              canRedo={false}
              clearAll={() => {}}
              customerName={customerName}
            />
          </div>

          {/* RIGHT COLUMN (~30%): Stacked Panels */}
          <div className="lg:col-span-4 flex flex-col gap-5">
            {/* Panel 1: PROJECT DETAILS */}
            <div className="bg-slate-50 border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
              <div className="bg-slate-900 text-white px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Layers size={16} className="text-teal-400" />
                  <h3 className="font-bold text-sm uppercase tracking-wider">PROJECT DETAILS</h3>
                </div>
              </div>

              <div className="p-4 space-y-3 divide-y divide-slate-200/60 text-sm">
                {/* 1. RAILING HEIGHT */}
                <div className="flex items-center justify-between pt-1">
                  <span className="font-semibold text-slate-500 uppercase tracking-wider text-[13px]">RAILING HEIGHT</span>
                  <span className="font-extrabold text-slate-900">{options.height}"</span>
                </div>

                {/* 2. LANDING LENGTH */}
                <div className="flex items-center justify-between pt-2.5">
                  <span className="font-semibold text-slate-500 uppercase tracking-wider text-[13px]">LANDING LENGTH</span>
                  <span className="font-extrabold text-teal-700">{formatFeetOnly(totalFlatPicketsInches)}</span>
                </div>

                {/* 3. STAIR LENGTH */}
                <div className="flex items-center justify-between pt-2.5">
                  <span className="font-semibold text-slate-500 uppercase tracking-wider text-[13px]">STAIR LENGTH</span>
                  <span className="font-extrabold text-purple-700">{formatFeetOnly(totalStairPicketsInches)}</span>
                </div>

                {/* 4. STYLE */}
                <div className="flex items-center justify-between pt-2.5">
                  <span className="font-semibold text-slate-500 uppercase tracking-wider text-[13px]">STYLE</span>
                  <span className="font-extrabold text-slate-900">
                    {hasPicketRun && hasGlassRun
                      ? 'Pickets & Glass'
                      : hasGlassRun
                      ? 'Glass'
                      : 'Pickets'}
                  </span>
                </div>

                {/* 5. RAILING COLOR */}
                <div className="flex items-center justify-between pt-2.5">
                  <span className="font-semibold text-slate-500 uppercase tracking-wider text-[13px]">RAILING COLOR</span>
                  <span className="font-extrabold text-slate-900">{options.systemColor || 'Matte Black'}</span>
                </div>

                {/* 6. SURFACE */}
                <div className="flex items-center justify-between pt-2.5">
                  <span className="font-semibold text-slate-500 uppercase tracking-wider text-[13px]">SURFACE</span>
                  <span className="font-extrabold text-slate-900">{options.surfaceType || 'Wood'}</span>
                </div>
              </div>
            </div>

            {/* Panel 2: DRAWING LEGEND */}
            <div className="bg-slate-50 border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
              <div className="bg-slate-900 text-white px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Compass size={16} className="text-teal-400" />
                  <h3 className="font-bold text-sm uppercase tracking-wider">DRAWING LEGEND</h3>
                </div>
              </div>

              <div className="p-4 space-y-2.5 text-sm">
                {legendFlags.hasPicketRailing && (
                  <div className="flex items-center gap-2.5">
                    <div className="w-5 h-2 bg-black rounded-full"></div>
                    <span className="font-bold text-slate-800">Picket Railing</span>
                  </div>
                )}

                {legendFlags.hasGlassRailing && (
                  <div className="flex items-center gap-2.5">
                    <div className="w-5 h-2 bg-[#3b82f6] rounded-full"></div>
                    <span className="font-bold text-slate-800">Glass Railing</span>
                  </div>
                )}

                {legendFlags.hasStairRailing && (
                  <div className="flex items-center gap-2.5">
                    <div className="w-5 h-2 bg-[#94a3b8] rounded-full"></div>
                    <span className="font-bold text-slate-800">Stair Railing</span>
                  </div>
                )}

                {legendFlags.hasEndPost && (
                  <div className="flex items-center gap-2.5">
                    <div className="w-3 h-3 bg-black rounded-xs"></div>
                    <span className="font-bold text-slate-800">End Post</span>
                  </div>
                )}

                {legendFlags.hasCornerPost && (
                  <div className="flex items-center gap-2.5">
                    <div className="w-3 h-3 bg-[#2563eb] rounded-xs"></div>
                    <span className="font-bold text-slate-800">Corner Post</span>
                  </div>
                )}

                {legendFlags.hasAnglePost && (
                  <div className="flex items-center gap-2.5">
                    <div className="w-3 h-3 bg-[#f97316] rounded-xs"></div>
                    <span className="font-bold text-slate-800">45° Angle Post</span>
                  </div>
                )}

                {legendFlags.hasLinePost && (
                  <div className="flex items-center gap-2.5">
                    <div className="w-3 h-3 bg-[#22c55e] rounded-xs"></div>
                    <span className="font-bold text-slate-800">Line Post</span>
                  </div>
                )}

                {legendFlags.hasStairPost && (
                  <div className="flex items-center gap-2.5">
                    <div className="w-3 h-3 bg-[#ec4899] rounded-xs"></div>
                    <span className="font-bold text-slate-800">Stair Post</span>
                  </div>
                )}

                {legendFlags.hasColumnBracket && (
                  <div className="flex items-center gap-2.5">
                    <div className="w-3 h-3 bg-[#ea580c] rounded-full"></div>
                    <span className="font-bold text-slate-800">Column Bracket</span>
                  </div>
                )}

                {legendFlags.hasSquareColumn && (
                  <div className="flex items-center gap-2.5">
                    <div className="w-3 h-3 bg-slate-100 border border-slate-700 rounded-xs"></div>
                    <span className="font-bold text-slate-800">Square Column</span>
                  </div>
                )}

                {legendFlags.hasHouseWall && (
                  <div className="flex items-center gap-2.5">
                    <div className="w-5 h-2 bg-slate-500 rounded-xs"></div>
                    <span className="font-bold text-slate-800">House Wall</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
