/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import { Point, RailSegment, RailingOptions, GeneratedPost } from '../types';
import { getDistance } from '../utils/railingCalc';
import { Layers, HelpCircle, RefreshCw } from 'lucide-react';

interface PerspectiveViewProps {
  points: Point[];
  calculatedPosts: GeneratedPost[];
  calculatedSegments: RailSegment[];
  options: RailingOptions;
}

export default function PerspectiveView({
  points,
  calculatedPosts,
  calculatedSegments,
  options,
}: PerspectiveViewProps) {
  
  const hasContent = points.length >= 2;

  // Render variables
  const svgWidth = 720;
  const svgHeight = 400;

  // Isometric Projection Math
  // 30 degree angles
  const isoAngle = Math.PI / 6; 
  const cosA = Math.cos(isoAngle);
  const sinA = Math.sin(isoAngle);

  // Generate 3D projected coordinates and viewport scales
  const projectedData = useMemo(() => {
    if (!hasContent) return null;

    // Projection projection function (unscaled, uncentered)
    const projectRaw = (x: number, y: number, z: number) => {
      return {
        px: (x - y) * cosA,
        py: (x + y) * sinA - z,
      };
    };

    // Gather all points of interest to compute bounds
    const testPoints: { px: number; py: number }[] = [];

    calculatedPosts.forEach(post => {
      // Base coordinates
      testPoints.push(projectRaw(post.x, post.y, -4));
      // Top coordinates
      testPoints.push(projectRaw(post.x, post.y, options.height + 4));
    });

    // Add extra outer margin points to keep centered
    if (testPoints.length === 0) return null;

    let minPX = Infinity;
    let maxPX = -Infinity;
    let minPY = Infinity;
    let maxPY = -Infinity;

    testPoints.forEach(p => {
      if (p.px < minPX) minPX = p.px;
      if (p.px > maxPX) maxPX = p.px;
      if (p.py < minPY) minPY = p.py;
      if (p.py > maxPY) maxPY = p.py;
    });

    const pWidth = Math.max(20, maxPX - minPX);
    const pHeight = Math.max(20, maxPY - minPY);

    // Scaling to fit
    const scaleX = (svgWidth - 100) / pWidth;
    const scaleY = (svgHeight - 100) / pHeight;
    const finalScale = Math.min(scaleX, scaleY);

    const centerX = (minPX + maxPX) / 2;
    const centerY = (minPY + maxPY) / 2;

    const tx = svgWidth / 2 - centerX * finalScale;
    const ty = svgHeight / 2 - centerY * finalScale;

    // Scaled & translated projection
    const project = (x: number, y: number, z: number) => {
      const { px, py } = projectRaw(x, y, z);
      return {
        x: px * finalScale + tx,
        y: py * finalScale + ty,
      };
    };

    return {
      project,
      scale: finalScale,
    };
  }, [calculatedPosts, options.height, hasContent]);

  // Color Styles
  const colors = useMemo(() => {
    let base = '#1e293b'; // black matte
    let highlight = '#334155';
    let shadow = '#0f172a';

    if (options.systemColor === 'Bronze') {
      base = '#78350f';
      highlight = '#92400e';
      shadow = '#451a03';
    } else if (options.systemColor === 'Gloss Black') {
      base = '#090d16';
      highlight = '#1e293b';
      shadow = '#02040a';
    } else if (options.systemColor === 'White') {
      base = '#e2e8f0';
      highlight = '#f8fafc';
      shadow = '#94a3b8';
    }

    const handrail = options.handrailStyle === 'wood' ? '#d97706' : base;
    const handrailHighlight = options.handrailStyle === 'wood' ? '#f59e0b' : highlight;

    return { base, highlight, shadow, handrail, handrailHighlight };
  }, [options.systemColor, options.handrailStyle]);

  if (!hasContent || !projectedData) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center text-slate-400">
        <Layers size={40} className="text-slate-600 mb-3" />
        <p className="text-sm font-semibold text-slate-300">No layout drawn yet</p>
        <p className="text-xs text-slate-500 max-w-xs mt-1">
          Use the Drawing Board to sketch a path. A 3D isometric model will instantly render here.
        </p>
      </div>
    );
  }

  const { project } = projectedData;

  // Painter's Algorithm: Sort physical elements back-to-front.
  // In isometric views, elements with smaller X + Y are further away, 
  // elements with larger X + Y are closer to the camera.
  // Let's divide elements into "Spans" and "Posts", associate them with a sort depth `x + y`, and sort them.
  const depthElements = [];

  // Add Deck Surface Base Path (Always first/bottom)
  // Let's create a thick deck platform representation!
  const deckPointsTop = points.map(pt => project(pt.x, pt.y, 0));
  const deckPointsBottom = points.map(pt => project(pt.x, pt.y, -8));

  // Generate Span elements
  calculatedSegments.forEach((seg, segIdx) => {
    // Sort posts inside segment
    const sortedPosts = [...seg.posts].sort((a, b) => (a.x + a.y) - (b.x + b.y));

    for (let j = 0; j < sortedPosts.length - 1; j++) {
      const p1 = sortedPosts[j];
      const p2 = sortedPosts[j + 1];
      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;

      depthElements.push({
        type: 'span',
        depth: midX + midY,
        segmentIndex: segIdx,
        p1,
        p2,
        id: `span-depth-${segIdx}-${j}`,
      });
    }
  });

  // Generate Post elements
  calculatedPosts.forEach((post) => {
    depthElements.push({
      type: 'post',
      depth: post.x + post.y,
      post,
      id: `post-depth-${post.id}`,
    });
  });

  // Sort back to front
  depthElements.sort((a, b) => a.depth - b.depth);

  return (
    <div className="flex flex-col h-full bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl relative text-white">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 bg-slate-950/80 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono tracking-wider text-teal-400 uppercase bg-teal-500/10 px-2 py-1 rounded-md border border-teal-500/20 flex items-center gap-1">
            <RefreshCw size={11} className="animate-spin-slow" />
            3D Preview
          </span>
          <h3 className="text-xs font-bold text-slate-200">
            Isometric Railing Model
          </h3>
        </div>
        <div className="text-[10px] text-slate-500 font-mono flex items-center gap-1">
          <HelpCircle size={12} />
          Interactive 3D structural render
        </div>
      </div>

      {/* 3D Render SVG Container */}
      <div className="flex-1 bg-slate-950/40 flex items-center justify-center p-4 min-h-[250px]">
        <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full h-full max-h-[380px] drop-shadow-2xl">
          <defs>
            {/* Mesh Pattern */}
            <pattern id="mesh-pattern-3d" width="6" height="6" patternUnits="userSpaceOnUse">
              <path d="M 0 0 L 6 6 M 6 0 L 0 6" fill="none" stroke="#475569" strokeWidth="0.5" opacity="0.4" />
            </pattern>
            {/* Drop Shadow */}
            <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
              <feDropShadow dx="0" dy="8" stdDeviation="6" floodColor="#000000" floodOpacity="0.4" />
            </filter>
          </defs>

          {/* 1. Deck Floor Platform Shadow & Base */}
          <g filter="url(#shadow)">
            {/* Thick Side Edge of Deck Platform */}
            {points.length > 1 && (() => {
              // Create dynamic strip representing the side rim joist of deck
              const faces = [];
              for (let i = 0; i < points.length - 1; i++) {
                const ptA = points[i];
                const ptB = points[i + 1];
                const projA_top = project(ptA.x, ptA.y, 0);
                const projB_top = project(ptB.x, ptB.y, 0);
                const projA_bottom = project(ptA.x, ptA.y, -8); // 8" deck rim joist
                const projB_bottom = project(ptB.x, ptB.y, -8);

                faces.push(
                  <polygon
                    key={`rim-${i}`}
                    points={`${projA_top.x},${projA_top.y} ${projB_top.x},${projB_top.y} ${projB_bottom.x},${projB_bottom.y} ${projA_bottom.x},${projA_bottom.y}`}
                    fill="#334155"
                    stroke="#1e293b"
                    strokeWidth={1}
                    opacity={0.8}
                  />
                );
              }
              return <g>{faces}</g>;
            })()}

            {/* Deck Top Floor Surface */}
            {points.length > 1 && (() => {
              // Create a ribbon/path tracing the deck boundary
              // Let's draw it as a thick gray surface line segment
              const dPathTop = deckPointsTop.map(p => `${p.x},${p.y}`).join(' ');
              const dPathBottom = deckPointsBottom.map(p => `${p.x},${p.y}`).join(' ');
              
              return (
                <g>
                  <polyline
                    points={dPathTop}
                    fill="none"
                    stroke="#1e293b"
                    strokeWidth={16} // thick floor outline
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={0.3}
                  />
                  <polyline
                    points={dPathTop}
                    fill="none"
                    stroke="#475569"
                    strokeWidth={12} // actual top surface
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {/* Subtle plank lines */}
                  <polyline
                    points={dPathTop}
                    fill="none"
                    stroke="#334155"
                    strokeWidth={1}
                    strokeLinecap="round"
                  />
                </g>
              );
            })()}
          </g>

          {/* 2. Sorted Architectural Elements (Back-to-front) */}
          {depthElements.map((elem) => {
            if (elem.type === 'span') {
              // Draw infills & railings for this specific span
              const { p1, p2 } = elem;
              const d = getDistance(p1, p2);
              const clearWidth = d - options.postWidth;

              const z1 = p1.z ?? 0;
              const z2 = p2.z ?? 0;

              // Top and Bottom Rail projection coordinates
              const top1 = project(p1.x, p1.y, z1 + options.height - 1);
              const top2 = project(p2.x, p2.y, z2 + options.height - 1);

              const bottom1 = project(p1.x, p1.y, z1 + 3);
              const bottom2 = project(p2.x, p2.y, z2 + 3);

              const activeSeg = calculatedSegments[elem.segmentIndex];
              const isStair = activeSeg?.isStair ?? false;

              if (activeSeg?.isStairOpening && activeSeg.stairOpening) {
                const stairOpening = activeSeg.stairOpening;
                const numRisers = stairOpening.risers;
                const stairRunInches = numRisers * 12;
                const totalRise = (numRisers + 1) * 7;
                
                const ux = Math.cos(activeSeg.angle);
                const uy = Math.sin(activeSeg.angle);
                const dir = stairOpening.direction;
                const projVec = (dir === 'up' || dir === 'left') ? { x: uy, y: -ux } : { x: -uy, y: ux };

                const stepsPolys = [];
                for (let k = 0; k < numRisers; k++) {
                  const dxS = projVec.x * (k * 12);
                  const dyS = projVec.y * (k * 12);
                  const dxE = projVec.x * ((k + 1) * 12);
                  const dyE = projVec.y * ((k + 1) * 12);
                  const zStep = -k * 7;
                  const zStepNext = -(k + 1) * 7;

                  const t_SL = project(p1.x + dxS, p1.y + dyS, zStep);
                  const t_SR = project(p2.x + dxS, p2.y + dyS, zStep);
                  const t_EL = project(p1.x + dxE, p1.y + dyE, zStep);
                  const t_ER = project(p2.x + dxE, p2.y + dyE, zStep);

                  const r_EL_base = project(p1.x + dxE, p1.y + dyE, zStepNext);
                  const r_ER_base = project(p2.x + dxE, p2.y + dyE, zStepNext);

                  stepsPolys.push(
                    <g key={`stair-op-step-3d-${activeSeg.id}-${k}`}>
                      {/* Tread Face (top) */}
                      <polygon
                        points={`${t_SL.x},${t_SL.y} ${t_SR.x},${t_SR.y} ${t_ER.x},${t_ER.y} ${t_EL.x},${t_EL.y}`}
                        fill="#475569"
                        stroke="#334155"
                        strokeWidth={0.5}
                      />
                      {/* Riser Face (front) */}
                      <polygon
                        points={`${t_EL.x},${t_EL.y} ${t_ER.x},${t_ER.y} ${r_ER_base.x},${r_ER_base.y} ${r_EL_base.x},${r_EL_base.y}`}
                        fill="#1e293b"
                        stroke="#0f172a"
                        strokeWidth={0.5}
                      />
                    </g>
                  );
                }

                const slopeLength = Math.sqrt(stairRunInches * stairRunInches + totalRise * totalRise);
                const sidesToRender = [1];
                if (stairOpening.sides === '2') {
                  sidesToRender.push(2);
                }

                const railings3D = [];
                for (const side of sidesToRender) {
                  const basePt = side === 1 ? p1 : p2;

                  // We have either 1 division (risers <= 5) or 2 divisions (risers > 5)
                  const divisions = numRisers > 5 ? 2 : 1;

                  for (let div = 0; div < divisions; div++) {
                    const ratioStart = div / divisions;
                    const ratioEnd = (div + 1) / divisions;

                    const sx = basePt.x + projVec.x * stairRunInches * ratioStart;
                    const sy = basePt.y + projVec.y * stairRunInches * ratioStart;
                    const sz = -totalRise * ratioStart;

                    const ex = basePt.x + projVec.x * stairRunInches * ratioEnd;
                    const ey = basePt.y + projVec.y * stairRunInches * ratioEnd;
                    const ez = -totalRise * ratioEnd;

                    const topStart = project(sx, sy, sz + options.height - 1);
                    const topEnd = project(ex, ey, ez + options.height - 1);

                    const bottomStart = project(sx, sy, sz + 3);
                    const bottomEnd = project(ex, ey, ez + 3);

                    // Pickets for this specific division
                    const divSlopeLength = slopeLength / divisions;
                    const maxGap = 4.0;
                    const picketC2C = maxGap + options.picketWidth;
                    const numPickets = Math.max(0, Math.ceil(divSlopeLength / picketC2C) - 1);
                    const S = divSlopeLength / (numPickets + 1);

                    const pickets = [];
                    for (let p = 1; p <= numPickets; p++) {
                      const ratio = (ratioStart * slopeLength + p * S) / slopeLength;
                      const px = basePt.x + projVec.x * stairRunInches * ratio;
                      const py = basePt.y + projVec.y * stairRunInches * ratio;
                      const pz = -totalRise * ratio;

                      const picB = project(px, py, pz + 3);
                      const picT = project(px, py, pz + options.height - 1.5);

                      pickets.push(
                        <line
                          key={`stair-op-picket-${activeSeg.id}-${side}-${div}-${p}`}
                          x1={picB.x}
                          y1={picB.y}
                          x2={picT.x}
                          y2={picT.y}
                          stroke={colors.base}
                          strokeWidth={1.5}
                          opacity={0.8}
                        />
                      );
                    }

                    railings3D.push(
                      <g key={`stair-op-side-rail-${activeSeg.id}-${side}-${div}`}>
                        <line
                          x1={topStart.x}
                          y1={topStart.y}
                          x2={topEnd.x}
                          y2={topEnd.y}
                          stroke={colors.handrail}
                          strokeWidth={3}
                        />
                        <line
                          x1={bottomStart.x}
                          y1={bottomStart.y}
                          x2={bottomEnd.x}
                          y2={bottomEnd.y}
                          stroke={colors.base}
                          strokeWidth={2.5}
                        />
                        {pickets}
                      </g>
                    );
                  }
                }

                return (
                  <g key={elem.id}>
                    <g opacity={0.85}>{stepsPolys}</g>
                    {railings3D}
                  </g>
                );
              }

              return (
                <g key={elem.id}>
                  {/* Real 3D solid steps underneath the stair run */}
                  {isStair && (() => {
                    const steps = activeSeg.stairStepsCount ?? 6;
                    const bottomIsStart = activeSeg.stairBottomIsStart ?? true;
                    
                    const dx = p2.x - p1.x;
                    const dy = p2.y - p1.y;
                    const stepsPolys = [];

                    // Calculate perpendicular offset for 3D width
                    const segAngle = Math.atan2(dy, dx);
                    const perpAngle = segAngle + Math.PI / 2;
                    // Width of stair tread is let's say 12 inches total (6 inches left, 6 inches right)
                    const offsetVal = 10;
                    const pxOffset = offsetVal * Math.cos(perpAngle);
                    const pyOffset = offsetVal * Math.sin(perpAngle);

                    const stepH = 7;

                    for (let k = 0; k < steps; k++) {
                      const rStart = k / steps;
                      const rEnd = (k + 1) / steps;

                      const xS = p1.x + dx * rStart;
                      const yS = p1.y + dy * rStart;
                      const xE = p1.x + dx * rEnd;
                      const yE = p1.y + dy * rEnd;

                      const zS = bottomIsStart ? k * stepH : (steps - k) * stepH;
                      const zE = bottomIsStart ? (k + 1) * stepH : (steps - k - 1) * stepH;

                      // Tread corners
                      const t_SL = project(xS - pxOffset, yS - pyOffset, zS);
                      const t_SR = project(xS + pxOffset, yS + pyOffset, zS);
                      const t_EL = project(xE - pxOffset, yE - pyOffset, zS);
                      const t_ER = project(xE + pxOffset, yE + pyOffset, zS);

                      // Riser bottom corners
                      const r_EL_base = project(xE - pxOffset, yE - pyOffset, zE);
                      const r_ER_base = project(xE + pxOffset, yE + pyOffset, zE);

                      stepsPolys.push(
                        <g key={`step-3d-${k}`}>
                          {/* Tread Face (top) */}
                          <polygon
                            points={`${t_SL.x},${t_SL.y} ${t_SR.x},${t_SR.y} ${t_ER.x},${t_ER.y} ${t_EL.x},${t_EL.y}`}
                            fill="#475569"
                            stroke="#334155"
                            strokeWidth={0.5}
                          />
                          {/* Riser Face (front) */}
                          <polygon
                            points={`${t_EL.x},${t_EL.y} ${t_ER.x},${t_ER.y} ${r_ER_base.x},${r_ER_base.y} ${r_EL_base.x},${r_EL_base.y}`}
                            fill="#1e293b"
                            stroke="#0f172a"
                            strokeWidth={0.5}
                          />
                        </g>
                      );
                    }
                    return <g opacity={0.85}>{stepsPolys}</g>;
                  })()}

                  {/* Bottom rail representation */}
                  {options.style !== 'cables' && (
                    <line
                      x1={bottom1.x}
                      y1={bottom1.y}
                      x2={bottom2.x}
                      y2={bottom2.y}
                      stroke={colors.base}
                      strokeWidth={3}
                      strokeLinecap="round"
                      opacity={0.9}
                    />
                  )}

                  {/* Vertical Pickets Infill */}
                  {options.style === 'pickets' && (() => {
                    const maxGap = 4.0;
                    const picketC2C = maxGap + options.picketWidth;
                    const numPickets = Math.max(0, Math.ceil(clearWidth / picketC2C) - 1);
                    const S = clearWidth / (numPickets + 1);

                    const pickets = [];
                    // Direction vector for calculating picket locations
                    const dx = p2.x - p1.x;
                    const dy = p2.y - p1.y;

                    for (let p = 1; p <= numPickets; p++) {
                      const ratio = (options.postWidth / 2 + p * S) / d;
                      const px = p1.x + dx * ratio;
                      const py = p1.y + dy * ratio;

                      const pz = z1 + (z2 - z1) * ratio;

                      const picB = project(px, py, pz + 3);
                      const picT = project(px, py, pz + options.height - 1.5);

                      pickets.push(
                        <line
                          key={`p-${p}`}
                          x1={picB.x}
                          y1={picB.y}
                          x2={picT.x}
                          y2={picT.y}
                          stroke={colors.base}
                          strokeWidth={1.5}
                          opacity={0.8}
                        />
                      );
                    }
                    return <g>{pickets}</g>;
                  })()}

                  {/* Horizontal Cables Infill */}
                  {options.style === 'cables' && (() => {
                    const numRuns = options.height === 36 ? 10 : 12;
                    const cableGap = (options.height - 5) / (numRuns - 1);
                    const cables = [];

                    for (let c = 0; c < numRuns; c++) {
                      const cableZ = 3.5 + c * cableGap;
                      const c1 = project(p1.x, p1.y, z1 + cableZ);
                      const c2 = project(p2.x, p2.y, z2 + cableZ);

                      cables.push(
                        <line
                          key={`cab-${c}`}
                          x1={c1.x}
                          y1={c1.y}
                          x2={c2.x}
                          y2={c2.y}
                          stroke="#cbd5e1"
                          strokeWidth={0.8}
                          opacity={0.7}
                        />
                      );
                    }
                    return <g>{cables}</g>;
                  })()}

                  {/* Glass Panel Infill */}
                  {options.style === 'glass' && (() => {
                    const glassGap = 3.0;
                    const gW = clearWidth - 2 * glassGap;
                    
                    if (gW > 2) {
                      const dx = p2.x - p1.x;
                      const dy = p2.y - p1.y;

                      const startRatio = (options.postWidth / 2 + glassGap) / d;
                      const endRatio = (options.postWidth / 2 + clearWidth - glassGap) / d;

                      const gX1 = p1.x + dx * startRatio;
                      const gY1 = p1.y + dy * startRatio;
                      const gX2 = p1.x + dx * endRatio;
                      const gY2 = p1.y + dy * endRatio;

                      const gz1 = z1 + (z2 - z1) * startRatio;
                      const gz2 = z1 + (z2 - z1) * endRatio;

                      const gB1 = project(gX1, gY1, gz1 + 3.5);
                      const gB2 = project(gX2, gY2, gz2 + 3.5);
                      const gT2 = project(gX2, gY2, gz2 + options.height - 3.5);
                      const gT1 = project(gX1, gY1, gz1 + options.height - 3.5);

                      return (
                        <g>
                          {/* 3D Glass Surface Poly */}
                          <polygon
                            points={`${gB1.x},${gB1.y} ${gB2.x},${gB2.y} ${gT2.x},${gT2.y} ${gT1.x},${gT1.y}`}
                            fill="#06b6d4"
                            fillOpacity={0.15}
                            stroke="#22d3ee"
                            strokeWidth={1.2}
                            strokeOpacity={0.4}
                          />
                          {/* Glare highlights */}
                          <line x1={gB1.x + 5} y1={gB1.y - 10} x2={gT2.x - 5} y2={gT2.y + 10} stroke="#ffffff" strokeWidth={0.5} opacity={0.2} />
                        </g>
                      );
                    }
                    return null;
                  })()}

                  {/* Wire Mesh Infill */}
                  {options.style === 'mesh' && (() => {
                    const dx = p2.x - p1.x;
                    const dy = p2.y - p1.y;

                    const startRatio = (options.postWidth / 2) / d;
                    const endRatio = (options.postWidth / 2 + clearWidth) / d;

                    const mX1 = p1.x + dx * startRatio;
                    const mY1 = p1.y + dy * startRatio;
                    const mX2 = p1.x + dx * endRatio;
                    const mY2 = p1.y + dy * endRatio;

                    const mz1 = z1 + (z2 - z1) * startRatio;
                    const mz2 = z1 + (z2 - z1) * endRatio;

                    const mB1 = project(mX1, mY1, mz1 + 3.5);
                    const mB2 = project(mX2, mY2, mz2 + 3.5);
                    const mT2 = project(mX2, mY2, mz2 + options.height - 3.5);
                    const mT1 = project(mX1, mY1, mz1 + options.height - 3.5);

                    return (
                      <polygon
                        points={`${mB1.x},${mB1.y} ${mB2.x},${mB2.y} ${mT2.x},${mT2.y} ${mT1.x},${mT1.y}`}
                        fill="url(#mesh-pattern-3d)"
                        stroke={colors.base}
                        strokeWidth={1}
                        opacity={0.8}
                      />
                    );
                  })()}
                </g>
              );
            } else {
              // Draw Post column
              const { post } = elem;
              const w = options.postWidth / 2;

              const postZ = post.z ?? 0;

              // Generate 3D box points for a post
              const baseC = project(post.x, post.y, postZ);
              const topC = project(post.x, post.y, postZ + options.height);

              // To make it look like a real 3D block, we offset the post corners in 3D:
              // Left, Right, Front, Back offsets
              const pL_base = project(post.x - w, post.y, postZ);
              const pR_base = project(post.x, post.y + w, postZ);
              const pF_base = project(post.x + w, post.y, postZ);

              const pL_top = project(post.x - w, post.y, postZ + options.height);
              const pR_top = project(post.x, post.y + w, postZ + options.height);
              const pF_top = project(post.x + w, post.y, postZ + options.height);

              return (
                <g key={elem.id}>
                  {/* Left shaded face */}
                  <polygon
                    points={`${pL_base.x},${pL_base.y} ${pF_base.x},${pF_base.y} ${pF_top.x},${pF_top.y} ${pL_top.x},${pL_top.y}`}
                    fill={colors.shadow}
                    stroke={colors.base}
                    strokeWidth={0.5}
                  />
                  {/* Right highlighted face */}
                  <polygon
                    points={`${pF_base.x},${pF_base.y} ${pR_base.x},${pR_base.y} ${pR_top.x},${pR_top.y} ${pF_top.x},${pF_top.y}`}
                    fill={colors.highlight}
                    stroke={colors.base}
                    strokeWidth={0.5}
                  />

                  {/* Surface mount bottom brackets */}
                  {options.mountingType === 'deck' && (
                    <polygon
                      points={`${project(post.x-w*1.5, post.y, postZ).x},${project(post.x-w*1.5, post.y, postZ).y} ${project(post.x, post.y+w*1.5, postZ).x},${project(post.x, post.y+w*1.5, postZ).y} ${project(post.x+w*1.5, post.y, postZ).x},${project(post.x+w*1.5, post.y, postZ).y}`}
                      fill={colors.shadow}
                      opacity={0.8}
                    />
                  )}
                </g>
              );
            }
          })}

          {/* 3. Top Continuous Handrail (Superimposed on top of posts) */}
          {calculatedSegments.map((seg, idx) => {
            if (seg.isStairOpening) return null;

            const pStart = seg.posts[0];
            const pEnd = seg.posts[seg.posts.length - 1];
            if (!pStart || !pEnd) return null;

            const zStart = pStart.z ?? 0;
            const zEnd = pEnd.z ?? 0;

            // Generate parallel offset handrail points for 3D look
            const w = options.postWidth / 2.2;
            const tStartL = project(pStart.x, pStart.y, zStart + options.height);
            const tEndL = project(pEnd.x, pEnd.y, zEnd + options.height);
            const tStartR = project(pStart.x, pStart.y, zStart + options.height + 2);
            const tEndR = project(pEnd.x, pEnd.y, zEnd + options.height + 2);

            return (
              <g key={`top-rail-3d-${idx}`}>
                <polygon
                  points={`${tStartL.x},${tStartL.y} ${tEndL.x},${tEndL.y} ${tEndR.x},${tEndR.y} ${tStartR.x},${tStartR.y}`}
                  fill={colors.handrail}
                  stroke={colors.handrailHighlight}
                  strokeWidth={1}
                  opacity={0.95}
                />
              </g>
            );
          })}
        </svg>
      </div>

      {/* Materials Legend */}
      <div className="bg-slate-950 p-4 border-t border-slate-800 text-[10px] text-slate-500 font-mono flex flex-wrap gap-x-4 gap-y-2 justify-center items-center">
        <div className="flex items-center gap-1">
          <span className="w-3 h-1.5 rounded bg-cyan-400 opacity-40 inline-block border border-cyan-400"></span>
          <span>Infill Paneling</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-3 h-1.5 rounded inline-block" style={{ backgroundColor: colors.base }}></span>
          <span>Metal Structurals</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-3 h-1.5 rounded inline-block" style={{ backgroundColor: colors.handrail }}></span>
          <span>Continuous Cap</span>
        </div>
      </div>
    </div>
  );
}
