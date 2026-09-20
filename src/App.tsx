/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import { Point, RailingOptions, RailingRun, StairDirection, StairOpening, GeneratedPost, PostType, CanvasShape } from './types';
import { calculateRailing, formatLength, projectPointOnSegment, getColumnEdgePoint, getDistance } from './utils/railingCalc';
import {
  clampStairOpeningValues,
  calculateStairOpeningZones,
  calculateStairRunLengthInches,
  getNextStairDirection,
  getDefaultStairDirection,
  TREAD_DEPTH_INCHES
} from './utils/stairOpeningCalc';
import DrawingCanvas from './components/DrawingCanvas';
import BOMEstimator from './components/BOMEstimator';
import { FinalSketchTab } from './components/FinalSketchTab';
import { SidebarPanel } from './components/SidebarPanel';
import { generateBOM } from './utils/railingCalc';

import { 
  Construction, 
  Sliders, 
  Plus, 
  Minus, 
  Info, 
  Ruler, 
  Maximize2,
  Settings,
  Trash2,
  Layers,
  Check,
  X,
  ChevronUp,
  ChevronDown,
  Calculator,
  LayoutGrid,
  FileText,
  Square,
  Columns
} from 'lucide-react';

export default function App() {
  // We represent multiple railing runs as an array of runs
  const [runs, setRuns] = useState<RailingRun[]>([]);
  const [shapes, setShapes] = useState<CanvasShape[]>([]);
  const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null);

  const [customerName, setCustomerName] = useState<string>('');
  const [priceOverrides, setPriceOverrides] = useState<Record<string, number>>({});

  const [activeRunId, setActiveRunId] = useState<string>('');

  // Main navigation tab: 2d plan, estimate or final_sketch
  const [activeTab, setActiveTab] = useState<'plan' | 'estimate' | 'final_sketch'>('plan');

  const SIDEBAR_WIDTH = 400;

  // Direct length updater for any run
  const changeRunLength = (runId: string, newLengthInches: number) => {
    const run = runs.find(r => r.id === runId);
    if (!run) return;
    commitCurrentStateToHistory();

    const start = run.points[0];
    const end = run.points[1];
    const sanitizedLength = Math.max(12, Math.min(720, newLengthInches)); // Min 1 foot, Max 60 feet
    
    let newPoints: Point[] = [];
    if (run.orientation === 'horizontal') {
      newPoints = [
        start,
        { id: run.points[1].id, x: start.x + sanitizedLength, y: start.y },
      ];
    } else if (run.orientation === 'vertical') {
      newPoints = [
        start,
        { id: run.points[1].id, x: start.x, y: start.y + sanitizedLength },
      ];
    } else {
      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      newPoints = [
        start,
        { id: run.points[1].id, x: start.x + sanitizedLength * Math.cos(angle), y: start.y + sanitizedLength * Math.sin(angle) },
      ];
    }

    setRuns(prev => prev.map(r => {
      if (r.id === runId) {
        let updated = { ...r, points: newPoints };
        if (updated.stairOpening?.enabled) {
          updated.stairOpening = clampStairOpeningValues(sanitizedLength, updated.stairOpening);
        }
        return updated;
      }
      return r;
    }));
  };

  // History state for undo/redo actions
  const [past, setPast] = useState<{ runs: RailingRun[]; activeRunId: string }[]>([]);
  const [future, setFuture] = useState<{ runs: RailingRun[]; activeRunId: string }[]>([]);

  const canUndo = past.length > 0;
  const canRedo = future.length > 0;

  const commitCurrentStateToHistory = () => {
    setPast(prev => {
      const last = prev[prev.length - 1];
      if (last && JSON.stringify(last.runs) === JSON.stringify(runs) && last.activeRunId === activeRunId) {
        return prev;
      }
      return [...prev, { runs: JSON.parse(JSON.stringify(runs)), activeRunId }];
    });
    setFuture([]);
  };

  const undo = () => {
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    const newPast = past.slice(0, past.length - 1);

    setPast(newPast);
    setFuture(prev => [...prev, { runs: JSON.parse(JSON.stringify(runs)), activeRunId }]);
    setRuns(previous.runs);
    setActiveRunId(previous.activeRunId);
  };

  const redo = () => {
    if (future.length === 0) return;
    const next = future[future.length - 1];
    const newFuture = future.slice(0, future.length - 1);

    setPast(prev => [...prev, { runs: JSON.parse(JSON.stringify(runs)), activeRunId }]);
    setFuture(newFuture);
    setRuns(next.runs);
    setActiveRunId(next.activeRunId);
  };

  const clearAll = () => {
    if (runs.length === 0 && shapes.length === 0) return;
    commitCurrentStateToHistory();
    setRuns([]);
    setShapes([]);
    setActiveRunId('');
  };

  // Auto update startIsColumn, endIsColumn, and snap endpoints to column edge when attached
  useEffect(() => {
    if (runs.length === 0) return;

    const columnShapes = shapes.filter(
      s => s.type === 'square_column' || s.type === 'circular_column'
    );

    let changed = false;
    const updatedRuns = runs.map(run => {
      if (run.isHouseWall || !run.points || run.points.length < 2) return run;

      let startPt = { ...run.points[0] };
      let endPt = { ...run.points[1] };
      let startChanged = false;
      let endChanged = false;

      // Start endpoint check
      let startCol: CanvasShape | undefined;
      if (run.startColumnId) {
        const prevCol = columnShapes.find(s => s.id === run.startColumnId);
        if (prevCol) {
          const attachDist = Math.max(prevCol.width, prevCol.height) / 2 + 3;
          if (Math.hypot(startPt.x - prevCol.x, startPt.y - prevCol.y) <= attachDist) {
            startCol = prevCol;
          }
        }
      }
      if (!startCol) {
        let minStartDist = Infinity;
        columnShapes.forEach(s => {
          const attachDist = Math.max(s.width, s.height) / 2 + 3;
          const dist = Math.hypot(startPt.x - s.x, startPt.y - s.y);
          if (dist <= attachDist && dist < minStartDist) {
            minStartDist = dist;
            startCol = s;
          }
        });
      }

      // End endpoint check
      let endCol: CanvasShape | undefined;
      if (run.endColumnId) {
        const prevCol = columnShapes.find(s => s.id === run.endColumnId);
        if (prevCol) {
          const attachDist = Math.max(prevCol.width, prevCol.height) / 2 + 3;
          if (Math.hypot(endPt.x - prevCol.x, endPt.y - prevCol.y) <= attachDist) {
            endCol = prevCol;
          }
        }
      }
      if (!endCol) {
        let minEndDist = Infinity;
        columnShapes.forEach(s => {
          const attachDist = Math.max(s.width, s.height) / 2 + 3;
          const dist = Math.hypot(endPt.x - s.x, endPt.y - s.y);
          if (dist <= attachDist && dist < minEndDist) {
            minEndDist = dist;
            endCol = s;
          }
        });
      }

      const startAttached = !!startCol;
      const endAttached = !!endCol;
      const startColId = startCol ? startCol.id : undefined;
      const endColId = endCol ? endCol.id : undefined;

      if (startCol && endCol) {
        const targetStart = getColumnEdgePoint(startCol, endPt);
        const targetEnd = getColumnEdgePoint(endCol, targetStart);
        if (Math.hypot(startPt.x - targetStart.x, startPt.y - targetStart.y) > 0.1) {
          startPt = targetStart;
          startChanged = true;
        }
        if (Math.hypot(endPt.x - targetEnd.x, endPt.y - targetEnd.y) > 0.1) {
          endPt = targetEnd;
          endChanged = true;
        }
      } else if (startCol) {
        const targetStart = getColumnEdgePoint(startCol, endPt);
        if (Math.hypot(startPt.x - targetStart.x, startPt.y - targetStart.y) > 0.1) {
          const deltaX = targetStart.x - startPt.x;
          const deltaY = targetStart.y - startPt.y;
          startPt = targetStart;
          endPt = { x: endPt.x + deltaX, y: endPt.y + deltaY };
          startChanged = true;
          endChanged = true;
        }
      } else if (endCol) {
        const targetEnd = getColumnEdgePoint(endCol, startPt);
        if (Math.hypot(endPt.x - targetEnd.x, endPt.y - targetEnd.y) > 0.1) {
          const deltaX = targetEnd.x - endPt.x;
          const deltaY = targetEnd.y - endPt.y;
          endPt = targetEnd;
          startPt = { x: startPt.x + deltaX, y: startPt.y + deltaY };
          startChanged = true;
          endChanged = true;
        }
      }

      if (
        !!run.startIsColumn !== startAttached ||
        !!run.endIsColumn !== endAttached ||
        run.startColumnId !== startColId ||
        run.endColumnId !== endColId ||
        startChanged ||
        endChanged
      ) {
        changed = true;
        return {
          ...run,
          points: [startPt, endPt],
          startIsColumn: startAttached,
          endIsColumn: endAttached,
          startColumnId: startColId,
          endColumnId: endColId,
        };
      }
      return run;
    });

    if (changed) {
      setRuns(updatedRuns);
    }
  }, [runs, shapes]);

  // Streamlined options matching current requirement
  const [options, setOptions] = useState<RailingOptions>({
    style: 'pickets',
    height: 42,
    maxPostSpacing: 60, // Default max 5 feet between posts
    handrailStyle: 'square',
    mountingType: 'deck',
    systemColor: 'Matte Black',
    installed: true,
    removalCost: 0,
    contractorDiscountPercent: 0,
    surfaceType: 'Wood',
    picketWidth: 0.75,
    postWidth: 2.5,
    gridSnapping: true,
    gridSize: 12, // Snap to 12" (1 foot) increments by default
    unitMode: 'feet', // feet (ft & in) vs inches (in)
    elevationCategory: 'low', // Default is 4 ft and lower
    picketInstallRate: 25.30,
    glassInstallRate: 30.00,
    glassLandingPanelRate: 30.00,
  });

  // Calculate live segments and post positions for each run
  const calculatedRuns = useMemo(() => {
    const rawRuns = runs.map(run => {
      const calc = calculateRailing(
        run.points,
        options,
        run.isStair,
        run.stairStepsCount ?? 6,
        run.stairBottomIsStart ?? true,
        run.stairOpening,
        runs,
        run.isHouseWall
      );
      return {
        ...run,
        posts: calc.posts,
        segments: calc.segments,
        totalLength: calc.totalLength,
      };
    });

    interface LandingEndpoint {
      x: number;
      y: number;
    }

    interface StairEndpoint {
      x: number;
      y: number;
      isTop: boolean;
    }

    const landingEndpoints: LandingEndpoint[] = [];
    const stairEndpoints: StairEndpoint[] = [];

    rawRuns.forEach(r => {
      r.segments.forEach(seg => {
        if (seg.isStairOpening && seg.stairOpening) {
          const stairOpening = seg.stairOpening;
          const numRisers = stairOpening.risers;
          const stairRunInches = numRisers * 12;
          const ux = Math.cos(seg.angle);
          const uy = Math.sin(seg.angle);
          const dir = stairOpening.direction;
          const projVec = (dir === StairDirection.UP || dir === StairDirection.LEFT)
            ? { x: uy, y: -ux }
            : { x: -uy, y: ux };

          const p1 = seg.posts[0];
          const p2 = seg.posts[seg.posts.length - 1];

          const sidesToRender = stairOpening.sides === '2' ? [1, 2] : [1];
          sidesToRender.forEach(side => {
            const basePt = side === 1 ? p1 : p2;
            const postX = basePt.x + projVec.x * stairRunInches;
            const postY = basePt.y + projVec.y * stairRunInches;

            stairEndpoints.push({ x: basePt.x, y: basePt.y, isTop: true });
            stairEndpoints.push({ x: postX, y: postY, isTop: false });
          });
        } else {
          if (seg.posts.length >= 2) {
            const sp = seg.posts[0];
            const ep = seg.posts[seg.posts.length - 1];
            landingEndpoints.push({ x: sp.x, y: sp.y });
            landingEndpoints.push({ x: ep.x, y: ep.y });
          }
        }
      });
    });

    const getLandingEndpointsCount = (x: number, y: number): number => {
      return landingEndpoints.filter(pt => Math.abs(pt.x - x) < 1.5 && Math.abs(pt.y - y) < 1.5).length;
    };

    const hasStairEndpoint = (x: number, y: number): boolean => {
      return stairEndpoints.some(pt => Math.abs(pt.x - x) < 1.5 && Math.abs(pt.y - y) < 1.5);
    };

    const getRunDirection = (runPoints: Point[], nodeX: number, nodeY: number): { x: number; y: number } | null => {
      if (!runPoints || runPoints.length < 2) return null;
      const start = runPoints[0];
      const end = runPoints[runPoints.length - 1];
      
      const distStart = Math.sqrt((start.x - nodeX) ** 2 + (start.y - nodeY) ** 2);
      const distEnd = Math.sqrt((end.x - nodeX) ** 2 + (end.y - nodeY) ** 2);
      
      let target: Point;
      let base: Point;
      
      if (distStart < distEnd) {
        base = start;
        target = runPoints[1];
      } else {
        base = end;
        target = runPoints[runPoints.length - 2];
      }
      
      const dx = target.x - base.x;
      const dy = target.y - base.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 0.1) return null;
      return { x: dx / len, y: dy / len };
    };

    interface PostNode {
      x: number;
      y: number;
      posts: { rIdx: number; pIdx: number; post: GeneratedPost }[];
    }

    const nodes: PostNode[] = [];

    rawRuns.forEach((r, rIdx) => {
      r.posts.forEach((post, pIdx) => {
        let node = nodes.find(n => Math.abs(n.x - post.x) < 1.5 && Math.abs(n.y - post.y) < 1.5);
        if (!node) {
          node = { x: post.x, y: post.y, posts: [] };
          nodes.push(node);
        }
        node.posts.push({ rIdx, pIdx, post });
      });
    });

    const columnShapes = shapes.filter(
      s => s.type === 'square_column' || s.type === 'circular_column'
    );

    nodes.forEach(node => {
      const connectedLandingEnds = getLandingEndpointsCount(node.x, node.y);
      const connectedStairEnd = hasStairEndpoint(node.x, node.y);

      const touchesHouseWall = runs.some(r => {
        if (!r.isHouseWall) return false;
        const a = r.points[0];
        const b = r.points[1];
        const proj = projectPointOnSegment(node, a, b);
        const dist = Math.sqrt((node.x - proj.x) ** 2 + (node.y - proj.y) ** 2);
        return dist < 1.5;
      });

      let derivedType: PostType = 'line';

      const hasLinePost = node.posts.some(p => p.post.type === 'line' && !p.post.id.includes('vertex') && !p.post.id.includes('bottom') && !p.post.id.includes('midpoint'));
      const hasMidpointPost = node.posts.some(p => p.post.id.includes('midpoint'));

      const hasStairBottomPost = node.posts.some(p => p.post.id.includes('stair-bottom'));
      const hasOtherLandingPost = node.posts.some(p => 
        !p.post.id.includes('stair-bottom') && 
        !p.post.id.includes('stair-midpoint')
      );

      if (hasMidpointPost) {
        derivedType = 'stair';
      } else if (hasStairBottomPost) {
        if (hasOtherLandingPost || touchesHouseWall) {
          derivedType = 'end';
        } else {
          derivedType = 'stair';
        }
      } else if (connectedStairEnd) {
        if (connectedLandingEnds > 0 || touchesHouseWall) {
          derivedType = 'end';
        } else {
          derivedType = 'stair';
        }
      } else if (touchesHouseWall) {
        derivedType = 'end';
      } else if (connectedLandingEnds > 0) {
        if (connectedLandingEnds >= 2) {
          let derivedJointType: PostType = 'corner';
          const uniqueRunIdxs = Array.from(new Set(node.posts.map(p => p.rIdx)));
          if (uniqueRunIdxs.length === 2) {
            const dirs: { x: number; y: number }[] = [];
            uniqueRunIdxs.forEach(rIdx => {
              const run = rawRuns[rIdx];
              const dir = getRunDirection(run.points, node.x, node.y);
              if (dir) dirs.push(dir);
            });
            if (dirs.length === 2) {
              const dot = Math.max(-1, Math.min(1, dirs[0].x * dirs[1].x + dirs[0].y * dirs[1].y));
              const angleRadians = Math.acos(dot);
              const angleDegrees = (angleRadians * 180) / Math.PI;

              if (Math.abs(angleDegrees - 180) < 5) {
                derivedJointType = 'line';
              } else if (Math.abs(angleDegrees - 90) < 5) {
                derivedJointType = 'corner';
              } else {
                derivedJointType = 'angle';
              }
            }
          }
          derivedType = derivedJointType;
        } else {
          derivedType = 'end';
        }
      } else if (hasLinePost) {
        derivedType = 'line';
      } else {
        derivedType = node.posts[0].post.type;
      }

      node.posts.forEach((item, index) => {
        const isDuplicate = index > 0;
        const postInRun = rawRuns[item.rIdx].posts[item.pIdx];
        postInRun.type = derivedType;
        postInRun.isDuplicate = isDuplicate;

        rawRuns[item.rIdx].segments.forEach(seg => {
          seg.posts.forEach(sp => {
            if (Math.abs(sp.x - node.x) < 0.5 && Math.abs(sp.y - node.y) < 0.5) {
              sp.type = derivedType;
              sp.isDuplicate = isDuplicate;
            }
          });
        });
      });
    });

    rawRuns.forEach(run => {
      run.posts.forEach(post => {
        const isMidStair = post.id.includes('midpoint');
        const isEligible = (post.type === 'start' || post.type === 'end' || post.type === 'stair') && !isMidStair;

        if (isEligible) {
          const isNearColumn = columnShapes.some(s => {
            const attachDist = Math.max(s.width, s.height) / 2 + 8;
            return Math.hypot(post.x - s.x, post.y - s.y) <= attachDist;
          });

          post.isColumn = isNearColumn;

          run.segments.forEach(seg => {
            seg.posts.forEach(sp => {
              if (sp.id === post.id || (Math.abs(sp.x - post.x) < 0.1 && Math.abs(sp.y - post.y) < 0.1)) {
                sp.isColumn = isNearColumn;
              }
            });
          });
        } else {
          post.isColumn = false;
          run.segments.forEach(seg => {
            seg.posts.forEach(sp => {
              if (sp.id === post.id || (Math.abs(sp.x - post.x) < 0.1 && Math.abs(sp.y - post.y) < 0.1)) {
                sp.isColumn = false;
              }
            });
          });
        }
      });
    });

    return rawRuns;
  }, [runs, options, shapes]);

  const isFeet = options.unitMode === 'feet';

  const activeRun = useMemo(() => {
    return runs.find(r => r.id === activeRunId) || runs[0];
  }, [runs, activeRunId]);

  const activeCalculatedRun = useMemo(() => {
    return calculatedRuns.find(cr => cr.id === activeRunId) || calculatedRuns[0];
  }, [calculatedRuns, activeRunId]);

  const activeLength = activeCalculatedRun?.totalLength || 0;

  const handleLengthChange = (newLengthInches: number) => {
    if (!activeRun) return;
    commitCurrentStateToHistory();

    const start = activeRun.points[0];
    const end = activeRun.points[1];
    const sanitizedLength = Math.max(12, Math.min(720, newLengthInches));
    
    let newPoints: Point[] = [];
    if (activeRun.orientation === 'horizontal') {
      newPoints = [
        start,
        { id: activeRun.points[1].id, x: start.x + sanitizedLength, y: start.y },
      ];
    } else if (activeRun.orientation === 'vertical') {
      newPoints = [
        start,
        { id: activeRun.points[1].id, x: start.x, y: start.y + sanitizedLength },
      ];
    } else {
      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      newPoints = [
        start,
        { id: activeRun.points[1].id, x: start.x + sanitizedLength * Math.cos(angle), y: start.y + sanitizedLength * Math.sin(angle) },
      ];
    }

    setRuns(prev => prev.map(r => {
      if (r.id === activeRunId) {
        let updated = { ...r, points: newPoints };
        if (updated.stairOpening?.enabled) {
          updated.stairOpening = clampStairOpeningValues(sanitizedLength, updated.stairOpening);
        }
        return updated;
      }
      return r;
    }));
  };

  const updateStairOpening = (fields: Partial<StairOpening>) => {
    if (!activeRun) return;
    commitCurrentStateToHistory();
    
    const currentOpening = activeRun.stairOpening || {
      enabled: false,
      leftOffset: 0,
      openingWidth: Math.min(3, activeLength / 12),
      risers: 4,
      sides: '1',
      direction: getDefaultStairDirection(activeRun.orientation),
    };

    const merged = { ...currentOpening, ...fields };
    const clamped = clampStairOpeningValues(activeLength, merged);

    setRuns(prev => prev.map(r => r.id === activeRunId ? {
      ...r,
      stairOpening: clamped,
    } : r));
  };

  // Controlled input string state for active run length
  const [tempFeet, setTempFeet] = useState<string>('1');
  const [tempInches, setTempInches] = useState<string>('0');
  const [tempTotalInches, setTempTotalInches] = useState<string>('12');

  useEffect(() => {
    if (activeLength > 0) {
      const f = Math.floor(activeLength / 12);
      const i = Math.round(activeLength % 12);
      setTempFeet(String(f));
      setTempInches(String(i));
      setTempTotalInches(String(Math.round(activeLength)));
    } else {
      setTempFeet('1');
      setTempInches('0');
      setTempTotalInches('12');
    }
  }, [activeRunId, activeLength]);

  const handleCommitLength = () => {
    const f = Number(tempFeet) || 0;
    const i = Number(tempInches) || 0;
    const totalInches = f * 12 + i;
    handleLengthChange(totalInches);
  };

  const handleCommitTotalInches = () => {
    const totalInches = Number(tempTotalInches) || 12;
    handleLengthChange(totalInches);
  };

  const handleStairOpeningToggle = (enabled: boolean) => {
    updateStairOpening({ enabled });
  };

  const handleStairOpeningParamChange = (param: string, value: any) => {
    updateStairOpening({ [param]: value });
  };

  const handleRotateStairRun = () => {
    const activeRunToPivot = runs.find(r => r.id === activeRunId);
    if (!activeRunToPivot || !activeRunToPivot.stairOpening?.enabled) {
      return;
    }

    commitCurrentStateToHistory();

    const start = activeRunToPivot.points[0];
    const end = activeRunToPivot.points[1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;

    // 90° clockwise rotation of (dx, dy) vector around start pivot -> (-dy, dx)
    const newDx = -dy;
    const newDy = dx;

    const newEnd: Point = {
      id: end.id,
      x: start.x + newDx,
      y: start.y + newDy,
    };

    const newPoints: Point[] = [
      { id: start.id, x: start.x, y: start.y },
      newEnd,
    ];

    const nextOrientation: 'horizontal' | 'vertical' =
      Math.abs(newDx) >= Math.abs(newDy) ? 'horizontal' : 'vertical';

    const length = Math.max(12, getDistance(start, newEnd));

    let updatedStairOpening = activeRunToPivot.stairOpening ? { ...activeRunToPivot.stairOpening } : undefined;
    if (updatedStairOpening) {
      // Rotate stair direction 90° CW to match the run's 90° CW rotation
      const directionMap: Record<StairDirection, StairDirection> = {
        [StairDirection.DOWN]: StairDirection.LEFT,
        [StairDirection.LEFT]: StairDirection.UP,
        [StairDirection.UP]: StairDirection.RIGHT,
        [StairDirection.RIGHT]: StairDirection.DOWN,
      };

      if (updatedStairOpening.direction && directionMap[updatedStairOpening.direction]) {
        updatedStairOpening.direction = directionMap[updatedStairOpening.direction];
      } else {
        updatedStairOpening.direction = nextOrientation === 'vertical' ? StairDirection.RIGHT : StairDirection.DOWN;
      }

      updatedStairOpening = clampStairOpeningValues(length, updatedStairOpening);
    }

    setRuns(prev => prev.map(r => r.id === activeRunId ? {
      ...r,
      orientation: nextOrientation,
      points: newPoints,
      stairOpening: updatedStairOpening,
      startIsColumn: false,
      endIsColumn: false,
      startColumnId: undefined,
      endColumnId: undefined,
    } : r));
  };

  const activeRunLengthFeet = activeLength / 12;

  const totalLengthCombined = useMemo(() => {
    return calculatedRuns.reduce((sum, cr) => sum + cr.totalLength, 0);
  }, [calculatedRuns]);

  const totalPostsCombined = useMemo(() => {
    const allPosts = calculatedRuns.flatMap(cr => {
      return cr.posts.filter((p, pIdx) => {
        if (pIdx === 0 && cr.startIsColumn) return false;
        if (pIdx === cr.posts.length - 1 && cr.endIsColumn) return false;
        if (p.isColumn) return false;
        return true;
      });
    });
    
    const uniqueKeys = new Set<string>();
    allPosts.forEach(post => {
      const xKey = Math.round(post.x * 10) / 10;
      const yKey = Math.round(post.y * 10) / 10;
      uniqueKeys.add(`${xKey},${yKey}`);
    });
    
    return uniqueKeys.size;
  }, [calculatedRuns]);

  const totalFlatPicketsInches = useMemo(() => {
    return calculatedRuns.reduce((sum, run) => {
      return sum + run.segments
        .filter(seg => !seg.isStairOpening)
        .reduce((s, seg) => s + seg.length, 0);
    }, 0);
  }, [calculatedRuns]);

  const totalStairPicketsInches = useMemo(() => {
    return calculatedRuns.reduce((sum, run) => {
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

  const allPostsCombined = useMemo(() => {
    return calculatedRuns.flatMap(cr => cr.posts);
  }, [calculatedRuns]);

  const allSegmentsCombined = useMemo(() => {
    return calculatedRuns.flatMap(cr => cr.segments);
  }, [calculatedRuns]);

  const activeBOM = useMemo(() => {
    const raw = generateBOM(allPostsCombined, allSegmentsCombined, totalLengthCombined, options, runs);
    return raw.map((item) => {
      const defaultPrice = item.unitPrice ?? 0;
      const effectiveUnitPrice =
        typeof priceOverrides[item.id] === 'number' ? priceOverrides[item.id] : defaultPrice;
      const isOverridden = typeof priceOverrides[item.id] === 'number';
      const computedAmount =
        Math.round(((item.quantity ?? 0) * effectiveUnitPrice + Number.EPSILON) * 100) / 100;
      return {
        ...item,
        defaultUnitPrice: defaultPrice,
        unitPrice: effectiveUnitPrice,
        isOverridden,
        amount: computedAmount,
      };
    });
  }, [allPostsCombined, allSegmentsCombined, totalLengthCombined, options, runs, priceOverrides]);

  const totalEstimatedCost = useMemo(() => {
    const rawSubtotal = activeBOM.reduce(
      (sum, item) => sum + (typeof item.amount === 'number' ? item.amount : (item.quantity ?? 0) * (item.unitPrice ?? 0)),
      0
    );
    const materialsSubtotal = activeBOM
      .filter((item) => item.category !== 'labor')
      .reduce(
        (sum, item) => sum + (typeof item.amount === 'number' ? item.amount : (item.quantity ?? 0) * (item.unitPrice ?? 0)),
        0
      );
    const discountAmount = materialsSubtotal * ((options.contractorDiscountPercent || 0) / 100);
    const taxableBase = Math.max(0, rawSubtotal - discountAmount);
    const taxAmount = taxableBase * 0.13;
    return taxableBase + taxAmount;
  }, [activeBOM, options.contractorDiscountPercent]);

  const handleAddNewRun = () => {
    commitCurrentStateToHistory();
    const newRunId = `run-${Date.now()}`;
    const newRun: RailingRun = {
      id: newRunId,
      points: [
        { id: `start-${newRunId}`, x: 1000, y: 750 + (runs.length * 60) % 300 },
        { id: `end-${newRunId}`, x: 1240, y: 750 + (runs.length * 60) % 300 },
      ],
      orientation: 'horizontal',
      style: 'pickets',
    };
    setRuns(prev => [...prev, newRun]);
    setActiveRunId(newRunId);
  };

  const handleDuplicateShape = (shapeId: string) => {
    const shapeToCopy = shapes.find(s => s.id === shapeId);
    if (!shapeToCopy) return;

    commitCurrentStateToHistory();
    const newShape: CanvasShape = {
      ...shapeToCopy,
      id: `shape-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      x: Math.min(2400 - 50, shapeToCopy.x + 24),
      y: Math.min(1600 - 50, shapeToCopy.y + 24),
    };

    setShapes(prev => [...prev, newShape]);
    setSelectedShapeId(newShape.id);
  };

  const handleDeleteShape = (shapeId: string) => {
    commitCurrentStateToHistory();
    setShapes(prev => prev.filter(s => s.id !== shapeId));
    if (selectedShapeId === shapeId) {
      setSelectedShapeId(null);
    }
  };

  const renderSidebar = () => (
    <SidebarPanel
      customerName={customerName}
      setCustomerName={setCustomerName}
      options={options}
      setOptions={setOptions}
      totalFlatPicketsInches={totalFlatPicketsInches}
      totalStairPicketsInches={totalStairPicketsInches}
      totalPostsCombined={totalPostsCombined}
      runs={runs}
      setRuns={setRuns}
      activeRunId={activeRunId}
      setActiveRunId={setActiveRunId}
      commitCurrentStateToHistory={commitCurrentStateToHistory}
      calculatedRuns={calculatedRuns}
      tempFeet={tempFeet}
      setTempFeet={setTempFeet}
      tempInches={tempInches}
      setTempInches={setTempInches}
      tempTotalInches={tempTotalInches}
      setTempTotalInches={setTempTotalInches}
      handleCommitLength={handleCommitLength}
      handleCommitTotalInches={handleCommitTotalInches}
      handleStairOpeningToggle={handleStairOpeningToggle}
      handleStairOpeningParamChange={handleStairOpeningParamChange}
      handleRotateStairRun={handleRotateStairRun}
      handleAddRun={handleAddNewRun}
      isFeet={isFeet}
      activeRun={activeRun}
      activeRunLengthFeet={activeRunLengthFeet}
      selectedShapeId={selectedShapeId}
      setSelectedShapeId={setSelectedShapeId}
      shapes={shapes}
      handleDuplicateShape={handleDuplicateShape}
      handleDeleteShape={handleDeleteShape}
    />
  );

  return (
    <div className="h-screen w-screen bg-slate-50 text-slate-800 font-sans flex flex-col overflow-hidden selection:bg-teal-100 selection:text-slate-900">
      
      {/* 1. Header Navigation */}
      <header className="border-b border-slate-200 bg-white px-6 py-3 flex flex-wrap items-center justify-between gap-4 z-20 shadow-xs shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-slate-900 rounded-xl text-white shadow-sm">
            <Construction size={20} className="stroke-[2]" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-slate-900 leading-none">
              Railing Layout Planner
            </h1>
            <p className="text-slate-500 text-xs font-medium mt-0.5">
              Interactive workspace supporting drawing, 3D visualization & real-time cost estimation.
            </p>
          </div>
        </div>

        {/* Navigation Tabs (Plan, Estimating, Final Sketch) */}
        <div className="flex items-center gap-1.5 bg-slate-100/90 p-1 rounded-xl border border-slate-200/80 shadow-2xs">
          <button
            onClick={() => setActiveTab('plan')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'plan'
                ? 'bg-white text-slate-900 shadow-sm border border-slate-250 font-extrabold'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
            }`}
          >
            <LayoutGrid size={15} className={activeTab === 'plan' ? 'text-teal-600' : 'text-slate-500'} />
            <span>2D Layout Plan</span>
          </button>

          <button
            onClick={() => setActiveTab('estimate')}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'estimate'
                ? 'bg-teal-600 text-white shadow-sm font-extrabold'
                : 'bg-teal-50 text-teal-800 hover:bg-teal-100/90 border border-teal-200/90'
            }`}
          >
            <Calculator size={15} className={activeTab === 'estimate' ? 'text-white' : 'text-teal-600'} />
            <span>Estimating & Quote</span>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${
              activeTab === 'estimate' ? 'bg-teal-700 text-white' : 'bg-teal-200/80 text-teal-900'
            }`}>
              ${totalEstimatedCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('final_sketch')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'final_sketch'
                ? 'bg-white text-slate-900 shadow-sm border border-slate-250 font-extrabold'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
            }`}
          >
            <FileText size={15} className={activeTab === 'final_sketch' ? 'text-teal-600' : 'text-slate-500'} />
            <span>Final Sketch</span>
          </button>
        </div>

        {/* Dynamic Metric Dashboard Header Badge */}
        <div className="flex flex-wrap items-center gap-4 bg-slate-50 border border-slate-200 px-3.5 py-1.5 rounded-xl text-xs font-mono">
          <div className="flex items-center gap-2">
            <span className="text-slate-500 font-sans font-semibold">Length:</span>
            <strong className="text-slate-900 text-sm font-bold">{formatLength(totalLengthCombined, isFeet)}</strong>
          </div>
          <div className="w-[1px] h-4 bg-slate-200"></div>
          <div className="flex items-center gap-2">
            <span className="text-slate-500 font-sans font-semibold">Posts:</span>
            <strong className="text-slate-900 text-sm font-bold">{totalPostsCombined}</strong>
          </div>
          <div className="w-[1px] h-4 bg-slate-200"></div>
          <div className="flex items-center gap-2">
            <span className="text-slate-500 font-sans font-semibold">Estimate:</span>
            <strong className="text-teal-600 text-sm font-bold">${totalEstimatedCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
          </div>
        </div>
      </header>

      {/* 2. Main Workspace Layout */}
      <main className="flex-1 w-full min-h-0 overflow-hidden relative">
        {/* 2D LAYOUT PLAN TAB: Edge-to-edge full width layout */}
        <div className={`w-full h-full p-4 flex gap-2 overflow-hidden ${activeTab === 'plan' ? '' : 'hidden'}`}>
          {/* LEFT: Drawing canvas panel grows to fill ALL remaining horizontal space */}
          <div className="flex-1 flex flex-col min-w-0 h-full">
            <DrawingCanvas
              isActive={activeTab === 'plan'}
              runs={runs}
              setRuns={setRuns}
              shapes={shapes}
              setShapes={setShapes}
              selectedShapeId={selectedShapeId}
              setSelectedShapeId={setSelectedShapeId}
              activeRunId={activeRunId}
              setActiveRunId={setActiveRunId}
              options={options}
              setOptions={setOptions}
              calculatedRuns={calculatedRuns}
              onStartAction={commitCurrentStateToHistory}
              undo={undo}
              redo={redo}
              canUndo={canUndo}
              canRedo={canRedo}
              clearAll={clearAll}
              customerName={customerName}
              totalEstimatedCost={totalEstimatedCost}
            />
          </div>

          {/* RIGHT: Sidebar with fixed width */}
          <div
            style={{ width: `${SIDEBAR_WIDTH}px` }}
            className="shrink-0 h-full overflow-y-auto pr-1 flex flex-col gap-5"
          >
            {renderSidebar()}
          </div>
        </div>

        {/* ESTIMATE TAB & FINAL SKETCH TAB: Centered readable layout */}
        <div className={`w-full h-full overflow-y-auto p-4 md:p-6 ${activeTab !== 'plan' ? '' : 'hidden'}`}>
          <div className="max-w-[1600px] w-full mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 items-start pb-12">
            {/* ESTIMATE CONTENT */}
            <div className={`lg:col-span-12 max-w-5xl mx-auto w-full flex flex-col gap-5 z-10 ${activeTab === 'estimate' ? '' : 'hidden'}`}>
              <BOMEstimator
                calculatedPosts={allPostsCombined}
                calculatedSegments={allSegmentsCombined}
                totalLengthInches={totalLengthCombined}
                options={options}
                runs={runs}
                onSwitchToDrawing={() => setActiveTab('plan')}
                customerName={customerName}
                setCustomerName={setCustomerName}
                priceOverrides={priceOverrides}
                setPriceOverrides={setPriceOverrides}
                isActive={activeTab === 'estimate'}
              />
            </div>

            {/* FINAL SKETCH CONTENT */}
            <div className={`lg:col-span-12 flex flex-col gap-5 z-10 ${activeTab === 'final_sketch' ? '' : 'hidden'}`}>
              <FinalSketchTab
                runs={runs}
                shapes={shapes}
                options={options}
                customerName={customerName}
                calculatedRuns={calculatedRuns}
                isTabActive={activeTab === 'final_sketch'}
              />
            </div>
          </div>
        </div>
      </main>

      {/* Footer layout bar */}
      <footer className="mt-auto border-t border-slate-200 bg-white py-3 px-6 text-center text-xs text-slate-400 font-mono flex flex-wrap items-center justify-between gap-4 shadow-2xs shrink-0">
        <div className="flex items-center gap-1.5 justify-center">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
          <span>Interactive Architectural Drawing Board — Unlimited Runs</span>
        </div>
        <span>Railing Layout Planner — Fully Compliant Spacing Calculations</span>
      </footer>
    </div>
  );
}
