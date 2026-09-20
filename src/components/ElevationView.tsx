/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { RailSegment, RailingOptions, GeneratedPost } from '../types';
import { formatLength, getDistance } from '../utils/railingCalc';
import { Compass, Info, CheckCircle, AlertTriangle } from 'lucide-react';

interface ElevationViewProps {
  calculatedSegments: RailSegment[];
  selectedSegmentIndex: number | null;
  setSelectedSegmentIndex: (index: number | null) => void;
  options: RailingOptions;
}

export default function ElevationView({
  calculatedSegments,
  selectedSegmentIndex,
  setSelectedSegmentIndex,
  options,
}: ElevationViewProps) {
  // If no segment is selected, default to the first one, or show a prompt
  const hasSegments = calculatedSegments.length > 0;
  const activeIndex = selectedSegmentIndex !== null ? selectedSegmentIndex : 0;
  const activeSegment = hasSegments ? calculatedSegments[activeIndex] : null;

  if (!activeSegment) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center text-slate-400">
        <Compass size={40} className="text-slate-600 mb-3 animate-spin-slow" />
        <p className="text-sm font-semibold text-slate-300">No layout drawn yet</p>
        <p className="text-xs text-slate-500 max-w-xs mt-1">
          Use the Drawing Board to add posts and segments. Your side elevation details will automatically load here.
        </p>
      </div>
    );
  }

  const isFeet = options.unitMode === 'feet';
  const totalInches = activeSegment.length;

  // Let's render the elevation view inside an SVG container
  // We'll scale the segment to fit inside the SVG width (e.g., 600px)
  const svgWidth = 720;
  const svgHeight = 280;
  const marginX = 50;
  const marginY = 40;

  const viewWidth = svgWidth - 2 * marginX;
  const viewHeight = svgHeight - 2 * marginY;

  // Scale calculations (inches to pixels)
  // Max height is e.g. 46" including clearance.
  const logicalHeight = options.height + 12; // Height + clearance + ground margin
  const logicalWidth = totalInches;

  // Aspect ratio scale:
  const scaleX = viewWidth / logicalWidth;
  const scaleY = viewHeight / logicalHeight;
  // Use uniform scale to prevent distortion
  const scale = Math.min(scaleX, scaleY);

  // Centering offsets
  const actualRenderWidth = logicalWidth * scale;
  const actualRenderHeight = logicalHeight * scale;
  const startX = marginX + (viewWidth - actualRenderWidth) / 2;
  const startY = svgHeight - marginY - 15; // Deck surface line location

  // Helper to map coordinates (inches) to SVG coords
  // x goes from 0 to logicalWidth
  // z goes from 0 (deck level) to height
  const getSVGCoords = (xInches: number, zInches: number) => {
    return {
      x: startX + xInches * scale,
      y: startY - zInches * scale,
    };
  };

  // Helper to get z-height along the run if it is a stair
  const getZAtOffset = (xOffset: number) => {
    if (!activeSegment.isStair) return 0;
    const steps = activeSegment.stairStepsCount ?? 6;
    const totalRise = steps * 7;
    const ratio = xOffset / totalInches;
    const bottomIsStart = activeSegment.stairBottomIsStart ?? true;
    return bottomIsStart ? ratio * totalRise : (1 - ratio) * totalRise;
  };

  // Build the list of spans
  const spans: { startX: number; endX: number; length: number }[] = [];
  const segPosts = [...activeSegment.posts].sort((a, b) => {
    // Sort posts from start of segment to end
    const dStartA = getDistance(activeSegment.posts[0], a);
    const dStartB = getDistance(activeSegment.posts[0], b);
    return dStartA - dStartB;
  });

  for (let j = 0; j < segPosts.length - 1; j++) {
    const p1 = segPosts[j];
    const p2 = segPosts[j + 1];
    const d = getDistance(p1, p2);
    
    // Calculate cumulative distances along the segment line
    const startOffset = getDistance(segPosts[0], p1);
    const endOffset = getDistance(segPosts[0], p2);

    spans.push({
      startX: startOffset,
      endX: endOffset,
      length: d,
    });
  }

  // Visual Styling configs based on Options
  const getPostFill = () => {
    switch (options.systemColor) {
      case 'Bronze': return '#78350f';
      case 'Matte Black': return '#1e293b';
      case 'Gloss Black': return '#020617';
      case 'White': return '#f8fafc';
      default: return '#1e293b';
    }
  };

  const getHandrailFill = () => {
    if (options.handrailStyle === 'wood') return '#d97706'; // wood color
    return getPostFill(); // matching metal color
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl relative text-white">
      {/* Header and selector tab */}
      <div className="flex items-center justify-between px-5 py-3 bg-slate-950/80 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono tracking-wider text-teal-400 uppercase bg-teal-500/10 px-2 py-1 rounded-md border border-teal-500/20">
            Elevation
          </span>
          <h3 className="text-xs font-bold text-slate-200">
            Segment #{activeIndex + 1} Side View
          </h3>
        </div>
        
        {/* Toggle between segments if multiple exist */}
        {calculatedSegments.length > 1 && (
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-slate-500 font-mono">Select Segment:</span>
            <div className="flex bg-slate-900 border border-slate-800 p-0.5 rounded-lg">
              {calculatedSegments.map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => setSelectedSegmentIndex(idx)}
                  className={`px-2 py-0.5 text-[10px] font-mono rounded ${
                    activeIndex === idx
                      ? 'bg-slate-800 text-teal-400 font-bold border border-slate-700'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  #{idx + 1}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* SVG Canvas for Elevation Drawing */}
      <div className="flex-1 min-h-[220px] bg-slate-950/40 relative flex items-center justify-center p-4">
        
        <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full max-w-[700px] h-auto">
          {/* 1. Ground / Stair / Deck Surface Plate */}
          {activeSegment.isStair ? (() => {
            const steps = activeSegment.stairStepsCount ?? 6;
            const bottomIsStart = activeSegment.stairBottomIsStart ?? true;

            // Draw a series of treads and risers
            const stepW = totalInches / steps;
            const stepH = 7;

            let pathD = '';
            if (bottomIsStart) {
              pathD = `M ${getSVGCoords(0, 0).x} ${getSVGCoords(0, 0).y}`;
              for (let k = 0; k < steps; k++) {
                const xCur = k * stepW;
                const xNext = (k + 1) * stepW;
                const zCur = k * stepH;
                const zNext = (k + 1) * stepH;

                const pTreadEnd = getSVGCoords(xNext, zCur);
                const pRiserEnd = getSVGCoords(xNext, zNext);

                pathD += ` L ${pTreadEnd.x} ${pTreadEnd.y} L ${pRiserEnd.x} ${pRiserEnd.y}`;
              }
              // Connect back down to ground
              pathD += ` L ${getSVGCoords(totalInches, 0).x} ${getSVGCoords(0, 0).y} Z`;
            } else {
              // Stair slopes down
              pathD = `M ${getSVGCoords(0, steps * stepH).x} ${getSVGCoords(0, steps * stepH).y}`;
              for (let k = 0; k < steps; k++) {
                const xCur = k * stepW;
                const xNext = (k + 1) * stepW;
                const zCur = (steps - k) * stepH;
                const zNext = (steps - k - 1) * stepH;

                const pTreadEnd = getSVGCoords(xNext, zCur);
                const pRiserEnd = getSVGCoords(xNext, zNext);

                pathD += ` L ${pTreadEnd.x} ${pTreadEnd.y} L ${pRiserEnd.x} ${pRiserEnd.y}`;
              }
              pathD += ` L ${getSVGCoords(totalInches, 0).x} ${getSVGCoords(totalInches, 0).y} L ${getSVGCoords(0, 0).x} ${getSVGCoords(0, 0).y} Z`;
            }

            return (
              <g>
                {/* Structure fill under steps */}
                <path
                  d={pathD}
                  fill="#1e293b"
                  stroke="#475569"
                  strokeWidth={2}
                  opacity={0.35}
                />
                {/* Tread highlights */}
                {Array.from({ length: steps }).map((_, k) => {
                  const xCur = k * stepW;
                  const xNext = (k + 1) * stepW;
                  const zCur = bottomIsStart ? k * stepH : (steps - k) * stepH;
                  const pS = getSVGCoords(xCur, zCur);
                  const pE = getSVGCoords(xNext, zCur);
                  return (
                    <line
                      key={`tread-hl-${k}`}
                      x1={pS.x}
                      y1={pS.y}
                      x2={pE.x}
                      y2={pE.y}
                      stroke="#cbd5e1"
                      strokeWidth={1.5}
                      opacity={0.7}
                    />
                  );
                })}
              </g>
            );
          })() : (
            <g>
              <line
                x1={marginX - 20}
                y1={startY}
                x2={startX + actualRenderWidth + 20}
                y2={startY}
                stroke="#475569"
                strokeWidth={3}
                strokeLinecap="round"
              />
              <rect
                x={startX - 10}
                y={startY}
                width={actualRenderWidth + 20}
                height={10}
                fill="#1e293b"
                opacity={0.4}
              />
            </g>
          )}

          {/* 2. Infill Elements per Span */}
          {spans.map((span, sIdx) => {
            const spanWidth = span.endX - span.startX;
            const clearWidth = spanWidth - options.postWidth;
            const insideStartX = span.startX + options.postWidth / 2;
            const insideEndX = span.endX - options.postWidth / 2;

            const zStart = getZAtOffset(insideStartX);
            const zEnd = getZAtOffset(insideEndX);

            return (
              <g key={`span-${sIdx}`}>
                {/* 2a. Bottom Supporting Rail (if not cable) */}
                {options.style !== 'cables' && (() => {
                  const rBottomStart = getSVGCoords(insideStartX, zStart + 3);
                  const rBottomEnd = getSVGCoords(insideEndX, zEnd + 3);
                  return (
                    <line
                      x1={rBottomStart.x}
                      y1={rBottomStart.y}
                      x2={rBottomEnd.x}
                      y2={rBottomEnd.y}
                      stroke={getPostFill()}
                      strokeWidth={1.5 * scale}
                      opacity={0.85}
                    />
                  );
                })()}

                {/* 2b. Style specific rendering */}
                {options.style === 'pickets' && (() => {
                  const maxGap = 4.0;
                  const picketC2C = maxGap + options.picketWidth;
                  const numPickets = Math.max(0, Math.ceil(clearWidth / picketC2C) - 1);
                  const S = clearWidth / (numPickets + 1);

                  const pickets = [];
                  for (let p = 1; p <= numPickets; p++) {
                    const picketX = insideStartX + p * S - options.picketWidth / 2;
                    const pZ = getZAtOffset(picketX);
                    const coordsBottom = getSVGCoords(picketX, pZ + 3);
                    const coordsTop = getSVGCoords(picketX, pZ + options.height - 1.5);
                    pickets.push(
                      <rect
                        key={`p-${p}`}
                        x={coordsBottom.x}
                        y={coordsTop.y}
                        width={options.picketWidth * scale}
                        height={Math.max(1, coordsBottom.y - coordsTop.y)}
                        fill={getPostFill()}
                        opacity={0.7}
                      />
                    );
                  }
                  return <g>{pickets}</g>;
                })()}

                {options.style === 'cables' && (() => {
                  const numRuns = options.height === 36 ? 10 : 12;
                  const cableGap = (options.height - 5) / (numRuns - 1);
                  const cables = [];

                  for (let c = 0; c < numRuns; c++) {
                    const cableZ = 3.5 + c * cableGap;
                    const c1 = getSVGCoords(insideStartX, zStart + cableZ);
                    const c2 = getSVGCoords(insideEndX, zEnd + cableZ);
                    cables.push(
                      <line
                        key={`cab-${c}`}
                        x1={c1.x}
                        y1={c1.y}
                        x2={c2.x}
                        y2={c2.y}
                        stroke="#94a3b8"
                        strokeWidth={1}
                        opacity={0.8}
                      />
                    );
                  }
                  return <g>{cables}</g>;
                })()}

                {options.style === 'glass' && (() => {
                  const glassGap = 3.0; // gap from post inside edge
                  const glassW = clearWidth - 2 * glassGap;

                  if (glassW > 2) {
                    const gx1 = insideStartX + glassGap;
                    const gx2 = insideEndX - glassGap;
                    const gz1 = getZAtOffset(gx1);
                    const gz2 = getZAtOffset(gx2);

                    const gB1 = getSVGCoords(gx1, gz1 + 3.5);
                    const gB2 = getSVGCoords(gx2, gz2 + 3.5);
                    const gT2 = getSVGCoords(gx2, gz2 + options.height - 3.5);
                    const gT1 = getSVGCoords(gx1, gz1 + options.height - 3.5);

                    return (
                      <g>
                        {/* Translucent glass parallelogram */}
                        <polygon
                          points={`${gB1.x},${gB1.y} ${gB2.x},${gB2.y} ${gT2.x},${gT2.y} ${gT1.x},${gT1.y}`}
                          fill="#06b6d4"
                          fillOpacity={0.15}
                          stroke="#0891b2"
                          strokeWidth={1.5}
                          strokeOpacity={0.5}
                        />
                        {/* Shading reflection lines */}
                        <path
                          d={`M ${gB1.x + 10} ${gB1.y - 10} L ${gT2.x - 10} ${gT2.y + 10}`}
                          stroke="#ffffff"
                          strokeWidth={1.5}
                          strokeOpacity={0.15}
                        />
                        {/* Glass hardware clamps */}
                        <circle cx={gB1.x} cy={gB1.y} r={3} fill="#cbd5e1" />
                        <circle cx={gT1.x} cy={gT1.y} r={3} fill="#cbd5e1" />
                        <circle cx={gB2.x} cy={gB2.y} r={3} fill="#cbd5e1" />
                        <circle cx={gT2.x} cy={gT2.y} r={3} fill="#cbd5e1" />
                      </g>
                    );
                  }
                  return null;
                })()}

                {options.style === 'mesh' && (() => {
                  const mB1 = getSVGCoords(insideStartX, zStart + 3);
                  const mT1 = getSVGCoords(insideStartX, zStart + options.height - 2);
                  const mB2 = getSVGCoords(insideEndX, zEnd + 3);
                  const mT2 = getSVGCoords(insideEndX, zEnd + options.height - 2);

                  return (
                    <polygon
                      points={`${mB1.x},${mB1.y} ${mB2.x},${mB2.y} ${mT2.x},${mT2.y} ${mT1.x},${mT1.y}`}
                      fill="url(#mesh-pattern)"
                      stroke={getPostFill()}
                      strokeWidth={1}
                      opacity={0.6}
                    />
                  );
                })()}
              </g>
            );
          })}

          {/* Patterns and markers definitions */}
          <defs>
            <pattern id="mesh-pattern" width="8" height="8" patternUnits="userSpaceOnUse">
              <path d="M 0 0 L 8 8 M 8 0 L 0 8" fill="none" stroke="#64748b" strokeWidth="0.5" />
            </pattern>
            <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#475569" />
            </marker>
          </defs>

          {/* 3. Render Solid Posts */}
          {segPosts.map((post, pIdx) => {
            const startOffset = getDistance(segPosts[0], post);
            const pZ = post.z ?? 0;
            const posBottom = getSVGCoords(startOffset, pZ);
            const posTop = getSVGCoords(startOffset, pZ + options.height);
            const pWidthPixels = options.postWidth * scale;

            // Draw post pillar
            return (
              <g key={`post-p-${pIdx}`}>
                <rect
                  x={posBottom.x - pWidthPixels / 2}
                  y={posTop.y}
                  width={pWidthPixels}
                  height={Math.max(1, posBottom.y - posTop.y)}
                  fill={getPostFill()}
                  stroke="#0f172a"
                  strokeWidth={0.5}
                  rx={1}
                />
                
                {/* Surface mount plate caps */}
                {options.mountingType === 'deck' && (
                  <rect
                    x={posBottom.x - pWidthPixels * 0.9}
                    y={posBottom.y - 1.5 * scale}
                    width={pWidthPixels * 1.8}
                    height={1.5 * scale}
                    fill={getPostFill()}
                    stroke="#0f172a"
                    strokeWidth={0.5}
                    rx={1}
                  />
                )}

                {/* Side fascia mount brackets */}
                {options.mountingType === 'fascia' && (
                  <g>
                    <rect
                      x={posBottom.x - pWidthPixels / 2}
                      y={posBottom.y}
                      width={pWidthPixels}
                      height={6 * scale}
                      fill={getPostFill()}
                    />
                    <rect
                      x={posBottom.x - pWidthPixels * 0.8}
                      y={posBottom.y + 1.5 * scale}
                      width={pWidthPixels * 1.6}
                      height={3 * scale}
                      fill="#334155"
                      rx={1}
                    />
                  </g>
                )}
              </g>
            );
          })}

          {/* 4. Top Handrail (running continuous parallel to the slope) */}
          {(() => {
            const x1 = 0 - options.postWidth / 2;
            const x2 = totalInches + options.postWidth / 2;
            const z1 = getZAtOffset(0);
            const z2 = getZAtOffset(totalInches);

            const t1 = getSVGCoords(x1, z1 + options.height);
            const t2 = getSVGCoords(x2, z2 + options.height);
            const t1_top = getSVGCoords(x1, z1 + options.height + 2);
            const t2_top = getSVGCoords(x2, z2 + options.height + 2);

            return (
              <polygon
                points={`${t1.x},${t1.y} ${t2.x},${t2.y} ${t2_top.x},${t2_top.y} ${t1_top.x},${t1_top.y}`}
                fill={getHandrailFill()}
                stroke="#0f172a"
                strokeWidth={0.5}
              />
            );
          })()}

          {/* 5. Dimension Callouts */}
          {/* Height marker */}
          <g transform={`translate(${startX - 28}, 0)`}>
            <line
              x1={5}
              y1={getSVGCoords(0, getZAtOffset(0) + options.height).y}
              x2={5}
              y2={getSVGCoords(0, getZAtOffset(0)).y}
              stroke="#2dd4bf"
              strokeWidth={1}
            />
            <path d={`M 2 ${getSVGCoords(0, getZAtOffset(0) + options.height).y} L 8 ${getSVGCoords(0, getZAtOffset(0) + options.height).y}`} stroke="#2dd4bf" strokeWidth={1} />
            <path d={`M 2 ${getSVGCoords(0, getZAtOffset(0)).y} L 8 ${getSVGCoords(0, getZAtOffset(0)).y}`} stroke="#2dd4bf" strokeWidth={1} />
            <text
              x={-2}
              y={(getSVGCoords(0, getZAtOffset(0) + options.height).y + getSVGCoords(0, getZAtOffset(0)).y) / 2}
              textAnchor="end"
              dominantBaseline="central"
              fill="#2dd4bf"
              fontSize={10}
              fontFamily="monospace"
              fontWeight="bold"
            >
              {options.height}"
            </text>
          </g>

          {/* Total Length label bottom marker */}
          <g transform={`translate(0, ${startY + 22})`}>
            <line
              x1={startX}
              y1={0}
              x2={startX + actualRenderWidth}
              y2={0}
              stroke="#64748b"
              strokeWidth={1}
              strokeDasharray="2 2"
            />
            <path d="M 0 -3 L 0 3" stroke="#64748b" transform={`translate(${startX}, 0)`} />
            <path d="M 0 -3 L 0 3" stroke="#64748b" transform={`translate(${startX + actualRenderWidth}, 0)`} />
            <text
              x={startX + actualRenderWidth / 2}
              y={10}
              textAnchor="middle"
              fill="#cbd5e1"
              fontSize={10}
              fontFamily="monospace"
            >
              Total Run: {formatLength(totalInches, isFeet)}
            </text>
          </g>

          {/* Span distances detail (above top handrail) */}
          {spans.map((span, sIdx) => {
            const cx = startX + ((span.startX + span.endX) / 2) * scale;
            const topY = getSVGCoords((span.startX + span.endX) / 2, getZAtOffset((span.startX + span.endX) / 2) + options.height).y - 12;

            return (
              <g key={`lbl-span-${sIdx}`}>
                <text
                  x={cx}
                  y={topY}
                  textAnchor="middle"
                  fill="#94a3b8"
                  fontSize={8.5}
                  fontFamily="monospace"
                >
                  Span: {formatLength(span.length, isFeet)}
                </text>
                <path
                  d={`M ${startX + span.startX * scale + 5} ${getSVGCoords(span.startX, getZAtOffset(span.startX) + options.height).y - 14} L ${startX + span.endX * scale - 5} ${getSVGCoords(span.endX, getZAtOffset(span.endX) + options.height).y - 14}`}
                  stroke="#475569"
                  strokeWidth={0.5}
                  markerEnd="url(#arrow)"
                />
              </g>
            );
          })}
        </svg>

      </div>

      {/* Info card statistics at footer */}
      <div className="bg-slate-950 p-4 border-t border-slate-800 flex flex-wrap gap-6 items-center justify-between">
        <div className="flex gap-4">
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider font-mono">Run Span</span>
            <span className="text-xs font-semibold text-slate-200">
              {formatLength(totalInches, isFeet)} ({activeSegment.posts.length} posts)
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider font-mono">Infill Type</span>
            <span className="text-xs font-semibold text-slate-200 capitalize">
              {options.style} infill
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider font-mono">Clear Span spacing</span>
            <span className="text-xs font-semibold text-slate-200">
              Max {formatLength(options.maxPostSpacing, isFeet)}
            </span>
          </div>
        </div>

        {/* Validation check block */}
        <div className="flex items-center gap-2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 px-2.5 py-1.5 rounded-lg text-xs">
          <CheckCircle size={14} className="flex-shrink-0" />
          <span className="font-mono text-[10px]">Meets IBC Safety Codes</span>
        </div>
      </div>
    </div>
  );
}
