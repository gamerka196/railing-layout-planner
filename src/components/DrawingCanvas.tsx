/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { Point, RailingOptions, GeneratedPost, RailSegment, RailingRun, StairDirection, CanvasShape, CanvasShapeType } from '../types';
import { getDistance, formatLength, projectPointOnSegment, getColumnEdgePoint } from '../utils/railingCalc';
import { exportSketchPdf } from '../utils/exportSketchPdf';
import { Move, Grid, ZoomIn, ZoomOut, Compass, RotateCw, RefreshCw, Plus, Trash2, Undo, Redo, Eraser, MousePointer, PenTool, Copy, X, Columns, CheckSquare, Square, Circle, Check, FileDown } from 'lucide-react';

interface DrawingCanvasProps {
  isActive?: boolean;
  readOnly?: boolean;
  runs: RailingRun[];
  setRuns: React.Dispatch<React.SetStateAction<RailingRun[]>>;
  shapes?: CanvasShape[];
  setShapes?: React.Dispatch<React.SetStateAction<CanvasShape[]>>;
  selectedShapeId?: string | null;
  setSelectedShapeId?: (id: string | null) => void;
  activeRunId: string;
  setActiveRunId: (id: string) => void;
  options: RailingOptions;
  setOptions: React.Dispatch<React.SetStateAction<RailingOptions>>;
  calculatedRuns: (RailingRun & {
    posts: GeneratedPost[];
    segments: RailSegment[];
    totalLength: number;
  })[];
  onStartAction: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  clearAll: () => void;
  customerName?: string;
  totalEstimatedCost?: number;
}

const BASE_SCALE = 1.4;
const POST_MARKER_PX = 14;

export function getFixedShapeDimensions(type: CanvasShapeType): { width: number; height: number } {
  switch (type) {
    case 'square_column':
    case 'circular_column':
      return { width: 24, height: 24 };
    case 'pool_rect':
      return { width: 244, height: 124 };
    case 'pool_circle':
      return { width: 184, height: 184 };
    case 'grass_lawn':
      return { width: 244, height: 184 };
    case 'bbq_counter':
      return { width: 100, height: 40 };
    default:
      return { width: 16, height: 16 };
  }
}

function computeRunOrientation(startPoint: { x: number; y: number }, endPoint: { x: number; y: number }): 'horizontal' | 'vertical' | 'angled' {
  const dx = Math.abs(endPoint.x - startPoint.x);
  const dy = Math.abs(endPoint.y - startPoint.y);
  const angleTolerance = 5; // pixels, treat near-straight lines as strictly h/v
  let computedOrientation: 'horizontal' | 'vertical' | 'angled';
  if (dy <= angleTolerance) {
    computedOrientation = 'horizontal';
    endPoint.y = startPoint.y;
  } else if (dx <= angleTolerance) {
    computedOrientation = 'vertical';
    endPoint.x = startPoint.x;
  } else {
    computedOrientation = 'angled';
  }
  return computedOrientation;
}

export default function DrawingCanvas({
  isActive = true,
  readOnly = false,
  runs,
  setRuns,
  shapes,
  setShapes,
  selectedShapeId = null,
  setSelectedShapeId = () => {},
  activeRunId,
  setActiveRunId,
  options,
  setOptions,
  calculatedRuns,
  onStartAction,
  undo,
  redo,
  canUndo,
  canRedo,
  clearAll,
  customerName,
  totalEstimatedCost,
}: DrawingCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const shapeList = shapes || [];

  const [isExportingPdf, setIsExportingPdf] = useState<boolean>(false);

  const handleExportPDF = async () => {
    if (isExportingPdf) return;
    setIsExportingPdf(true);
    try {
      const totalInches = calculatedRuns.reduce((sum, cr) => cr.isHouseWall ? sum : sum + cr.totalLength, 0);
      const totalPostsCount = calculatedRuns.reduce((sum, cr) => {
        if (cr.isHouseWall) return sum;
        return sum + cr.posts.filter((p, pIdx) => {
          if (p.isDuplicate) return false;
          const isStartColumn = pIdx === 0 && cr.startIsColumn;
          const isEndColumn = pIdx === cr.posts.length - 1 && cr.endIsColumn;
          if (isStartColumn || isEndColumn) return false;
          if (p.isColumn) return false;
          return true;
        }).length;
      }, 0);

      await exportSketchPdf({
        runs,
        calculatedRuns,
        shapes: shapeList,
        options,
        customerName,
        totalLengthInches: totalInches,
        totalPosts: totalPostsCount,
        totalCost: totalEstimatedCost,
        svgElement: svgRef.current,
        canvasContainerElement: containerRef.current,
      });
    } catch (err) {
      console.error('PDF export failed:', err);
    } finally {
      setIsExportingPdf(false);
    }
  };

  const [showAddMenu, setShowAddMenu] = useState<boolean>(false);
  const [draggingShapeId, setDraggingShapeId] = useState<string | null>(null);
  const [dragShapeStartCoords, setDragShapeStartCoords] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [dragShapeOffset, setDragShapeOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const selectedShape = shapeList.find(s => s.id === selectedShapeId);
  const [activeSnapColumnId, setActiveSnapColumnId] = useState<string | null>(null);

  // Compute attached runs list for a selected column shape (proximity threshold ATTACH_DISTANCE)
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

  const [draggingHandle, setDraggingHandle] = useState<'start' | 'end' | 'all' | null>(null);
  const [draggingRunId, setDraggingRunId] = useState<string | null>(null);
  const [dragStartCoords, setDragStartCoords] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [dragStartPoints, setDragStartPoints] = useState<Point[]>([]);
  const [isDrawingNew, setIsDrawingNew] = useState<boolean>(false);
  const [toolMode, setToolMode] = useState<'draw' | 'select'>('draw');

  // Internal clipboard and mouse position tracking for Copy, Paste, and Duplicate
  const [clipboard, setClipboard] = useState<RailingRun | null>(null);
  const [shapeClipboard, setShapeClipboard] = useState<CanvasShape | null>(null);
  const [lastCopiedType, setLastCopiedType] = useState<'run' | 'shape' | null>(null);
  const [pasteCount, setPasteCount] = useState<number>(0);
  const isMouseOverRef = useRef<boolean>(false);
  const mouseLogicalRef = useRef<{ x: number; y: number } | null>(null);
  const isFirstRunDrawRef = useRef<boolean>(false);

  // Viewport panning and zooming
  const [zoom, setZoom] = useState<number>(1.0);
  const scale = zoom * BASE_SCALE;
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 50, y: 50 });
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Logical grid size in inches
  const canvasWidth = 2400;
  const canvasHeight = 1600;
  const maxAllowedLength = 720; // 60 feet in inches

  // Shape creation, duplication, and deletion handlers
  const handleAddShape = (type: CanvasShapeType) => {
    onStartAction();
    const dims = getFixedShapeDimensions(type);
    let label = '';

    switch (type) {
      case 'square_column':
        label = 'Square Column';
        break;
      case 'circular_column':
        label = 'Circular Column';
        break;
      case 'pool_rect':
        label = 'Swimming Pool (Rect)';
        break;
      case 'pool_circle':
        label = 'Swimming Pool (Circle)';
        break;
      case 'grass_lawn':
        label = 'Grass Lawn / Area';
        break;
      case 'bbq_counter':
        label = 'BBQ / Kitchen Counter';
        break;
    }

    const viewportCenterX = (-pan.x + 400) / scale;
    const viewportCenterY = (-pan.y + 300) / scale;
    const spawnX = Math.max(100, Math.min(canvasWidth - 100, isNaN(viewportCenterX) ? 300 : viewportCenterX));
    const spawnY = Math.max(100, Math.min(canvasHeight - 100, isNaN(viewportCenterY) ? 250 : viewportCenterY));

    // Stagger offset so multiple shapes don't stack directly on top of each other
    const shapeCount = shapeList.length;
    const offsetX = (shapeCount % 10) * 32;
    const offsetY = (shapeCount % 10) * 32;

    const newShape: CanvasShape = {
      id: `shape-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type,
      x: Math.max(50, Math.min(canvasWidth - 50, spawnX + offsetX)),
      y: Math.max(50, Math.min(canvasHeight - 50, spawnY + offsetY)),
      width: dims.width,
      height: dims.height,
      label,
    };

    if (setShapes) {
      setShapes(prev => [...prev, newShape]);
    }
    // Do not auto-select shape so Object Settings window only appears upon direct click
    setShowAddMenu(false);
  };

  const handleDuplicateShape = (shapeId: string) => {
    const shapeToCopy = shapeList.find(s => s.id === shapeId);
    if (!shapeToCopy) return;

    onStartAction();
    const newShape: CanvasShape = {
      ...shapeToCopy,
      id: `shape-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      x: Math.min(canvasWidth - 50, shapeToCopy.x + 24),
      y: Math.min(canvasHeight - 50, shapeToCopy.y + 24),
    };

    if (setShapes) {
      setShapes(prev => [...prev, newShape]);
    }
    setSelectedShapeId(newShape.id);
  };

  const handleDuplicateSelection = () => {
    if (selectedShapeId) {
      handleDuplicateShape(selectedShapeId);
    } else if (activeRunId) {
      duplicateActiveRun();
    }
  };

  const handleDeleteShape = (shapeId: string) => {
    onStartAction();
    if (setShapes) {
      setShapes(prev => prev.filter(s => s.id !== shapeId));
    }
    if (selectedShapeId === shapeId) {
      setSelectedShapeId(null);
    }
  };

  // Find the currently active run
  const activeRun = runs.find(r => r.id === activeRunId) || runs[0];

  // Find all joint points (endpoints of different runs that are at the exact same location)
  const joints = React.useMemo(() => {
    const endpoints: { x: number; y: number }[] = [];
    runs.forEach(r => {
      if (r.points && r.points.length >= 2) {
        endpoints.push(r.points[0]);
        endpoints.push(r.points[1]);
      }
    });

    const jointPts: { x: number; y: number }[] = [];
    for (let i = 0; i < endpoints.length; i++) {
      for (let j = i + 1; j < endpoints.length; j++) {
        const p1 = endpoints[i];
        const p2 = endpoints[j];
        if (Math.abs(p1.x - p2.x) < 0.1 && Math.abs(p1.y - p2.y) < 0.1) {
          if (!jointPts.some(jc => Math.abs(jc.x - p1.x) < 0.1 && Math.abs(jc.y - p1.y) < 0.1)) {
            jointPts.push(p1);
          }
        }
      }
    }
    return jointPts;
  }, [runs]);

  // Find all top of stairs coordinates in the layout to ensure they are strictly classified as end posts
  const topOfStairsPoints = React.useMemo(() => {
    const pts: { x: number; y: number }[] = [];
    runs.forEach((r) => {
      if (r.stairOpening && r.stairOpening.enabled) {
        const pStart = r.points[0];
        const pEnd = r.points[1];
        const angle = Math.atan2(pEnd.y - pStart.y, pEnd.x - pStart.x);
        const ux = Math.cos(angle);
        const uy = Math.sin(angle);
        const leftOffsetInches = r.stairOpening.leftOffset * 12;
        const openingWidthInches = r.stairOpening.openingWidth * 12;

        pts.push({
          x: pStart.x + ux * leftOffsetInches,
          y: pStart.y + uy * leftOffsetInches,
        });
        pts.push({
          x: pStart.x + ux * (leftOffsetInches + openingWidthInches),
          y: pStart.y + uy * (leftOffsetInches + openingWidthInches),
        });
      }
    });
    return pts;
  }, [runs]);

  const usedLegendItems = React.useMemo(() => {
    let hasEndPost = false;
    let hasLinePost = false;
    let hasCornerPost = false;
    let hasAnglePost = false;
    let hasStairPost = false;
    let hasMidStairPost = false;
    let hasRailingRun = false;
    let hasColumnBracket = false;
    let hasStairSegment = false;

    const hasPicketRun = runs.some(r => !r.style || r.style === 'pickets');
    const hasGlassRun = runs.some(r => r.style === 'glass');

    if (calculatedRuns.length > 0) {
      hasRailingRun = true;
    }

    calculatedRuns.forEach((cRun) => {
      if (cRun.startIsColumn || cRun.endIsColumn) {
        hasColumnBracket = true;
      }

      if (!cRun.isHouseWall) {
        cRun.segments.forEach((seg) => {
          if (seg.isStairOpening && seg.stairOpening) {
            hasStairSegment = true;
          }
        });
      }

      cRun.posts.forEach((post, pIdx) => {
        if (post.isDuplicate) return;

        const isStartColumn = pIdx === 0 && cRun.startIsColumn;
        const isEndColumn = pIdx === cRun.posts.length - 1 && cRun.endIsColumn;

        if (isStartColumn || isEndColumn) {
          hasColumnBracket = true;
          return;
        }

        const isContinuousBracket = post.id.includes('midpoint');

        if (isContinuousBracket) {
          hasMidStairPost = true;
        } else if (post.type === 'corner') {
          hasCornerPost = true;
        } else if (post.type === 'angle') {
          hasAnglePost = true;
        } else if (post.type === 'line') {
          hasLinePost = true;
        } else if (post.type === 'stair') {
          hasStairPost = true;
        } else if (post.type === 'start' || post.type === 'end') {
          hasEndPost = true;
        }
      });
    });

    return {
      hasEndPost,
      hasLinePost,
      hasCornerPost,
      hasAnglePost,
      hasStairPost,
      hasMidStairPost,
      hasRailingRun,
      hasColumnBracket,
      hasStairSegment,
      hasPicketRun,
      hasGlassRun,
    };
  }, [calculatedRuns, runs]);

  // Auto-center all the railing runs in the viewport
  const centerAndFit = (allRuns = runs) => {
    const w = svgRef.current ? svgRef.current.clientWidth : 800;
    const h = svgRef.current ? svgRef.current.clientHeight : 500;

    // Skip when the container isn't actually measurable yet (e.g. its tab/panel
    // is hidden via display:none). Computing a fit from a zero-sized viewport
    // produces a bogus zoom/pan that then persists. A later recompute, once the
    // panel is genuinely visible, will fit correctly instead.
    if (w <= 0 || h <= 0) return;

    if (allRuns.length === 0 && shapeList.length === 0) {
      // Default zoom of 1.0 (100%) centered on the empty canvas
      const targetZoom = 1.0;

      setZoom(targetZoom);
      setPan({
        x: w / 2 - (canvasWidth / 2) * targetZoom * BASE_SCALE,
        y: h / 2 - (canvasHeight / 2) * targetZoom * BASE_SCALE,
      });
      return;
    }

    // Find bounding box across all runs and shapes
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    allRuns.forEach(run => {
      run.points.forEach(pt => {
        if (pt.x < minX) minX = pt.x;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.y > maxY) maxY = pt.y;
      });
    });

    shapeList.forEach(shape => {
      const dims = getFixedShapeDimensions(shape.type);
      const sw = shape.width || dims.width;
      const sh = shape.height || dims.height;
      const halfW = sw / 2;
      const halfH = sh / 2;

      const left = shape.x - halfW;
      const right = shape.x + halfW;
      const top = shape.y - halfH;
      const bottom = shape.y + halfH;

      if (left < minX) minX = left;
      if (right > maxX) maxX = right;
      if (top < minY) minY = top;
      if (bottom > maxY) maxY = bottom;
    });

    if (minX === Infinity) {
      minX = 1000; maxX = 1400; minY = 700; maxY = 900;
    }

    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;

    const spanX = Math.max(150, maxX - minX);
    const spanY = Math.max(150, maxY - minY);

    const padding = readOnly ? 160 : 150; // Balanced padding around elements
    const bestZoomX = (w - padding) / (spanX * BASE_SCALE);
    const bestZoomY = (h - padding) / (spanY * BASE_SCALE);
    const bestZoom = Math.max(0.35, Math.min(2.5, Math.min(bestZoomX, bestZoomY)));

    setZoom(bestZoom);
    setPan({
      x: w / 2 - midX * bestZoom * BASE_SCALE,
      y: h / 2 - midY * bestZoom * BASE_SCALE,
    });
  };

  // Reset zoom & center button handler: sets zoom to exactly 1.0 (100%) and centers drawing bounding box or empty canvas
  const resetZoomAndCenter = (allRuns = runs) => {
    const w = svgRef.current ? svgRef.current.clientWidth : 800;
    const h = svgRef.current ? svgRef.current.clientHeight : 500;
    const targetZoom = 1.0;

    // Same guard as centerAndFit: don't compute a fit from a zero-sized viewport.
    if (w <= 0 || h <= 0) return;

    if (allRuns.length === 0) {
      setZoom(targetZoom);
      setPan({
        x: w / 2 - (canvasWidth / 2) * targetZoom * BASE_SCALE,
        y: h / 2 - (canvasHeight / 2) * targetZoom * BASE_SCALE,
      });
      return;
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    allRuns.forEach(run => {
      run.points.forEach(pt => {
        if (pt.x < minX) minX = pt.x;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.y > maxY) maxY = pt.y;
      });
    });

    if (minX === Infinity) {
      minX = 1000; maxX = 1400; minY = 700; maxY = 900;
    }

    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;

    setZoom(targetZoom);
    setPan({
      x: w / 2 - midX * targetZoom * BASE_SCALE,
      y: h / 2 - midY * targetZoom * BASE_SCALE,
    });
  };
  // Zoom in/out while keeping the point at the center of the viewport fixed,
  // so the drawing grows/shrinks in place instead of sliding away
  const zoomAroundCenter = (nextZoom: number) => {
    const clamped = Math.min(4, Math.max(0.4, parseFloat(nextZoom.toFixed(2))));
    const w = svgRef.current ? svgRef.current.clientWidth : 800;
    const h = svgRef.current ? svgRef.current.clientHeight : 500;
    const cx = w / 2;
    const cy = h / 2;
    const logicalX = (cx - pan.x) / scale;
    const logicalY = (cy - pan.y) / scale;
    setPan({ x: cx - logicalX * clamped * BASE_SCALE, y: cy - logicalY * clamped * BASE_SCALE });
    setZoom(clamped);
  };

  useEffect(() => {
    if (!readOnly) return;

    centerAndFit();

    const el = svgRef.current;
    if (!el) return;

    let resizeTimer: NodeJS.Timeout;
    const ro = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        centerAndFit();
      }, 30);
    });

    ro.observe(el);

    return () => {
      ro.disconnect();
      clearTimeout(resizeTimer);
    };
    // isActive is included so that when this read-only panel's tab becomes the
    // visible one, we deterministically recompute the fit with a real, non-zero
    // viewport size instead of relying solely on the ResizeObserver to catch the
    // display:none -> visible transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, runs.length, shapeList.length, isActive]);

  // Map screen mouse pointer coordinates to canvas logical coordinates
  const getLogicalCoords = (clientX: number, clientY: number): { x: number; y: number } => {
    const svgEl = svgRef.current;
    if (!svgEl) return { x: 0, y: 0 };

    const rect = svgEl.getBoundingClientRect();
    const screenX = clientX - rect.left;
    const screenY = clientY - rect.top;

    let logicalX = (screenX - pan.x) / scale;
    let logicalY = (screenY - pan.y) / scale;

    // Apply grid snapping if active
    if (options.gridSnapping) {
      const size = options.gridSize; // e.g. 1", 12"
      logicalX = Math.round(logicalX / size) * size;
      logicalY = Math.round(logicalY / size) * size;
    }

    // Keep within bounds
    return {
      x: Math.max(20, Math.min(canvasWidth - 20, logicalX)),
      y: Math.max(20, Math.min(canvasHeight - 20, logicalY)),
    };
  };

  // Start dragging handles or panning
  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    // If right click, middle click, or shift key, pan the board
    if (e.button === 1 || e.button === 2 || e.shiftKey) {
      e.preventDefault();
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      return;
    }

    if (readOnly) return;

    const target = e.target as SVGElement;

    // Check if clicking on a canvas shape
    const shapeId = target.getAttribute('data-shape-id');

    if (shapeId) {
      e.stopPropagation();
      const targetShape = shapeList.find(s => s.id === shapeId);
      if (targetShape) {
        onStartAction();
        setSelectedShapeId(shapeId);
        setDraggingShapeId(shapeId);
        const coords = getLogicalCoords(e.clientX, e.clientY);
        setDragShapeStartCoords(coords);
        setDragShapeOffset({ x: coords.x - targetShape.x, y: coords.y - targetShape.y });
      }
      return;
    }

    const handleType = target.getAttribute('data-handle-type') as 'start' | 'end' | 'middle';
    const runId = target.getAttribute('data-run-id');

    if (handleType && runId) {
      e.stopPropagation();
      const selectedRun = runs.find(r => r.id === runId);
      if (selectedRun && selectedRun.points.length >= 2) {
        onStartAction(); // Save history state before starting drag/resize action
        setActiveRunId(runId);
        setDraggingRunId(runId);
        setDraggingHandle(handleType === 'middle' ? 'all' : handleType);
        const coords = getLogicalCoords(e.clientX, e.clientY);
        setDragStartCoords(coords);
        setDragStartPoints([...selectedRun.points]);
      }
      return;
    }

    if (toolMode === 'select') {
      setActiveRunId('');
      setSelectedShapeId(null);
      return;
    }

    setSelectedShapeId(null);

    // If click on empty space, draw a brand-new run by dragging
    onStartAction(); // Save history state before drawing a brand-new run
    const coords = getLogicalCoords(e.clientX, e.clientY);
    const newRunId = `run-${Date.now()}`;

    isFirstRunDrawRef.current = (runs.length === 0);
    setIsDrawingNew(true);
    const startPt = { id: `start-${newRunId}`, x: coords.x, y: coords.y };
    const endPt = { id: `end-${newRunId}`, x: coords.x, y: coords.y };

    const newRun: RailingRun = {
      id: newRunId,
      points: [startPt, endPt],
      orientation: 'angled',
      style: 'pickets',
    };

    setRuns(prev => [...prev, newRun]);
    setActiveRunId(newRunId);
    setDraggingRunId(newRunId);
    setDraggingHandle('end');
    setDragStartCoords(coords);
    setDragStartPoints([
      { id: `start-${newRunId}`, x: coords.x, y: coords.y },
      { id: `end-${newRunId}`, x: coords.x, y: coords.y },
    ]);
  };

  // Mouse move updates positioning, lengths, and enforces horizontal/vertical locks
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const currentCoords = getLogicalCoords(e.clientX, e.clientY);
    mouseLogicalRef.current = currentCoords;

    if (isPanning) {
      setPan({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      });
      return;
    }

    if (readOnly) return;

    if (draggingShapeId) {
      if (setShapes) {
        setShapes(prev => prev.map(s => {
          if (s.id === draggingShapeId) {
            return {
              ...s,
              x: Math.max(20, Math.min(canvasWidth - 20, currentCoords.x - dragShapeOffset.x)),
              y: Math.max(20, Math.min(canvasHeight - 20, currentCoords.y - dragShapeOffset.y)),
            };
          }
          return s;
        }));
      }
      return;
    }

    if (!draggingHandle || !draggingRunId) return;

    const startPt = dragStartPoints[0];
    const endPt = dragStartPoints[1];

    const targetRun = runs.find(r => r.id === draggingRunId);
    if (!targetRun) return;
    const orientation = targetRun.orientation;

    // Find endpoints of other runs that we can snap to
    const otherEndpoints: { x: number; y: number }[] = [];
    runs.forEach(r => {
      if (r.id !== draggingRunId) {
        if (r.points && r.points.length >= 2) {
          otherEndpoints.push(r.points[0]);
          otherEndpoints.push(r.points[1]);
        }
      }
    });

    // Also include bottom stair posts of other runs from calculatedRuns
    calculatedRuns.forEach(cr => {
      if (cr.id !== draggingRunId) {
        cr.posts.forEach(post => {
          if (post.id.startsWith('post-stair-bottom-')) {
            otherEndpoints.push({ x: post.x, y: post.y });
          }
        });
      }
    });
    // Also snap to stair anchor posts of other runs' stair openings, so a
    // landing run can attach exactly on them and the merge/conversion fires.
    runs.forEach(r => {
      if (r.id === draggingRunId) return;
      if (r.stairOpening && r.stairOpening.enabled && r.points && r.points.length >= 2) {
        const pStart = r.points[0];
        const pEnd = r.points[1];
        const angle = Math.atan2(pEnd.y - pStart.y, pEnd.x - pStart.x);
        const ux = Math.cos(angle);
        const uy = Math.sin(angle);
        const leftOffsetInches = r.stairOpening.leftOffset * 12;
        const openingWidthInches = r.stairOpening.openingWidth * 12;
        const stairRunInches = r.stairOpening.risers * 12;
        const projVec = getProjectionVector(angle, r.stairOpening.direction);

        const opStartPt = {
          x: pStart.x + ux * leftOffsetInches,
          y: pStart.y + uy * leftOffsetInches,
        };
        const opEndPt = {
          x: pStart.x + ux * (leftOffsetInches + openingWidthInches),
          y: pStart.y + uy * (leftOffsetInches + openingWidthInches),
        };

        // Top stair anchors (opening borders) — snappable even when mid-run
        otherEndpoints.push(opStartPt);
        otherEndpoints.push(opEndPt);

        // Bottom stair anchors: side 1 projects from the opening start,
        // side 2 (if enabled) from the opening end
        const basePts = r.stairOpening.sides === '2' ? [opStartPt, opEndPt] : [opStartPt];
        basePts.forEach(basePt => {
          otherEndpoints.push({
            x: basePt.x + projVec.x * stairRunInches,
            y: basePt.y + projVec.y * stairRunInches,
          });
        });
      }
    });
    const snapThreshold = 12; // snap within 12 inches (1 foot)
    const columnShapes = shapeList.filter(s => s.type === 'square_column' || s.type === 'circular_column');
    
    const getBestSnapPt = (pt: { x: number; y: number }, excludeRunId: string): { x: number; y: number } | null => {
      // 1. Check column face snapping (top priority when dragging endpoint near column)
      for (const col of columnShapes) {
        const attachDist = Math.max(col.width, col.height) / 2 + 12;
        const dist = Math.hypot(pt.x - col.x, pt.y - col.y);
        if (dist <= attachDist) {
          setActiveSnapColumnId(col.id);
          if (draggingHandle === 'start') {
            return getColumnEdgePoint(col, endPt);
          } else if (draggingHandle === 'end') {
            return getColumnEdgePoint(col, startPt);
          }
          return null;
        }
      }

      setActiveSnapColumnId(null);

      // 2. Direct endpoint snaps
      for (const opt of otherEndpoints) {
        const dist = Math.sqrt(Math.pow(pt.x - opt.x, 2) + Math.pow(pt.y - opt.y, 2));
        if (dist < snapThreshold) {
          return opt;
        }
      }

      // 3. Projection snaps to any house wall run
      let bestWallProj: { x: number; y: number } | null = null;
      let minWallDist = snapThreshold;

      runs.forEach(r => {
        if (r.id !== excludeRunId && r.isHouseWall && r.points && r.points.length >= 2) {
          const a = r.points[0];
          const b = r.points[1];
          const proj = projectPointOnSegment(pt, a, b);
          const dist = Math.sqrt((pt.x - proj.x) ** 2 + (pt.y - proj.y) ** 2);
          if (dist < minWallDist) {
            minWallDist = dist;
            bestWallProj = proj;
          }
        }
      });

      return bestWallProj;
    };

    let snapPt: { x: number; y: number } | null = null;

    // Disable snapping during brand-new free-drawing as requested by user
    if (!isDrawingNew) {
      snapPt = getBestSnapPt(currentCoords, draggingRunId);
    }

    let updatedPoints: Point[] = [];

    if (draggingHandle === 'all') {
      // Move entire railing run relative to drag delta
      let dx = currentCoords.x - dragStartCoords.x;
      let dy = currentCoords.y - dragStartCoords.y;

      const newStart = { ...startPt, x: startPt.x + dx, y: startPt.y + dy };
      const newEnd = { ...endPt, x: endPt.x + dx, y: endPt.y + dy };

      // Snap the entire run to close endpoints (only if not drawing new)
      let snapStartPt: { x: number; y: number } | null = null;
      if (!isDrawingNew) {
        snapStartPt = getBestSnapPt(newStart, draggingRunId);
      }

      if (snapStartPt) {
        const snapDx = snapStartPt.x - newStart.x;
        const snapDy = snapStartPt.y - newStart.y;
        dx += snapDx;
        dy += snapDy;
      } else {
        // Try snapping the end point (only if not drawing new)
        let snapEndPt: { x: number; y: number } | null = null;
        if (!isDrawingNew) {
          snapEndPt = getBestSnapPt(newEnd, draggingRunId);
        }
        if (snapEndPt) {
          const snapDx = snapEndPt.x - newEnd.x;
          const snapDy = snapEndPt.y - newEnd.y;
          dx += snapDx;
          dy += snapDy;
        }
      }

      // Clamp delta so both endpoints remain inside canvas bounds without altering length
      const minX = Math.min(startPt.x, endPt.x);
      const maxX = Math.max(startPt.x, endPt.x);
      const minY = Math.min(startPt.y, endPt.y);
      const maxY = Math.max(startPt.y, endPt.y);

      dx = Math.max(20 - minX, Math.min((canvasWidth - 20) - maxX, dx));
      dy = Math.max(20 - minY, Math.min((canvasHeight - 20) - maxY, dy));

      updatedPoints = [
        { ...startPt, x: startPt.x + dx, y: startPt.y + dy },
        { ...endPt, x: endPt.x + dx, y: endPt.y + dy },
      ];
    } else if (draggingHandle === 'start') {
      // Adjust start post location. End post stays locked.
      let newX = currentCoords.x;
      let newY = currentCoords.y;
      const targetEndPt = { ...endPt };

      if (snapPt) {
        newX = snapPt.x;
        newY = snapPt.y;
      }

      // Calculate new length to ensure it doesn't exceed 60 feet
      const currentLength = Math.sqrt(Math.pow(targetEndPt.x - newX, 2) + Math.pow(targetEndPt.y - newY, 2));
      if (currentLength <= maxAllowedLength) {
        updatedPoints = [
          { ...startPt, x: newX, y: newY },
          targetEndPt,
        ];
      } else {
        // Project at max distance
        const angle = Math.atan2(targetEndPt.y - newY, targetEndPt.x - newX);
        const maxNewX = targetEndPt.x - maxAllowedLength * Math.cos(angle);
        const maxNewY = targetEndPt.y - maxAllowedLength * Math.sin(angle);
        updatedPoints = [
          { ...startPt, x: maxNewX, y: maxNewY },
          targetEndPt,
        ];
      }
    } else if (draggingHandle === 'end') {
      // Adjust end post location. Start post stays locked.
      let newX = currentCoords.x;
      let newY = currentCoords.y;
      const targetStartPt = { ...startPt };

      if (snapPt) {
        newX = snapPt.x;
        newY = snapPt.y;
      }

      // Calculate new length
      const currentLength = Math.sqrt(Math.pow(newX - targetStartPt.x, 2) + Math.pow(newY - targetStartPt.y, 2));
      if (currentLength <= maxAllowedLength) {
        updatedPoints = [
          targetStartPt,
          { ...endPt, x: newX, y: newY },
        ];
      } else {
        // Project at max distance
        const angle = Math.atan2(newY - targetStartPt.y, newX - targetStartPt.x);
        const maxNewX = targetStartPt.x + maxAllowedLength * Math.cos(angle);
        const maxNewY = targetStartPt.y + maxAllowedLength * Math.sin(angle);
        updatedPoints = [
          targetStartPt,
          { ...endPt, x: maxNewX, y: maxNewY },
        ];
      }
    }

    if (updatedPoints.length === 2) {
      // Prevent drawing runs on top of each other (parallel & overlapping)
      const wouldOverlap = runs.some(r => {
        if (r.id === draggingRunId) return false;

        const p1 = updatedPoints[0];
        const p2 = updatedPoints[1];
        const otherP1 = r.points[0];
        const otherP2 = r.points[1];

        // Advanced multi-angle overlap check:
        // 1. Calculate angles of both segments
        const angle1 = Math.atan2(p2.y - p1.y, p2.x - p1.x);
        const angle2 = Math.atan2(otherP2.y - otherP1.y, otherP2.x - otherP1.x);

        // 2. Check if they are nearly parallel (difference in angle is close to 0 or PI)
        let diff = Math.abs(angle1 - angle2);
        while (diff > Math.PI) diff -= Math.PI;
        const isParallel = diff < 0.035 || diff > Math.PI - 0.035; // ~2 degrees tolerance

        if (isParallel) {
          // 3. Check perpendicular distance from p1 to the infinite line of the other run
          const dx = otherP2.x - otherP1.x;
          const dy = otherP2.y - otherP1.y;
          const otherLength = Math.sqrt(dx * dx + dy * dy);
          if (otherLength > 0.1) {
            const perpDist = Math.abs((p1.x - otherP1.x) * dy - (p1.y - otherP1.y) * dx) / otherLength;

            if (perpDist < 2) { // within 2 inches of each other
              // 4. Check if their projections along the run direction overlap
              const ux = dx / otherLength;
              const uy = dy / otherLength;

              const projA = p1.x * ux + p1.y * uy;
              const projB = p2.x * ux + p2.y * uy;
              const projC = otherP1.x * ux + otherP1.y * uy;
              const projD = otherP2.x * ux + otherP2.y * uy;

              const min1 = Math.min(projA, projB);
              const max1 = Math.max(projA, projB);
              const min2 = Math.min(projC, projD);
              const max2 = Math.max(projC, projD);

              const overlap = Math.min(max1, max2) - Math.max(min1, min2);
              if (overlap > 4) { // overlap of more than 4 inches
                return true;
              }
            }
          }
        }
        return false;
      });

      if (!wouldOverlap || draggingHandle === 'all') {
        setRuns(prev => prev.map(r => r.id === draggingRunId ? { ...r, points: updatedPoints } : r));
      }
    }
  };

  const handleMouseUp = () => {
    if (readOnly) {
      setDraggingShapeId(null);
      setDraggingRunId(null);
      setDraggingHandle(null);
      setIsPanning(false);
      setIsDrawingNew(false);
      return;
    }

    if (draggingShapeId) {
      setDraggingShapeId(null);
    }

    if (draggingRunId) {
      const targetRun = runs.find(r => r.id === draggingRunId);
      if (targetRun) {
        let ptsToProcess = [...targetRun.points];

        // Ensure off-axis coordinate is snapped if near-straight before column snapping
        computeRunOrientation(ptsToProcess[0], ptsToProcess[1]);

        // Column snapping on release (mouseup / touchend)
        const columnShapes = shapeList.filter(s => s.type === 'square_column' || s.type === 'circular_column');
        let p0 = { ...ptsToProcess[0] };
        let p1 = { ...ptsToProcess[1] };
        // Check start endpoint
        let col0: CanvasShape | undefined;
        let minD0 = Infinity;
        columnShapes.forEach(s => {
          const attachDist = Math.max(s.width, s.height) / 2 + 12;
          const d = Math.hypot(p0.x - s.x, p0.y - s.y);
          if (d <= attachDist && d < minD0) {
            minD0 = d;
            col0 = s;
          }
        });

        // Check end endpoint
        let col1: CanvasShape | undefined;
        let minD1 = Infinity;
        columnShapes.forEach(s => {
          const attachDist = Math.max(s.width, s.height) / 2 + 12;
          const d = Math.hypot(p1.x - s.x, p1.y - s.y);
          if (d <= attachDist && d < minD1) {
            minD1 = d;
            col1 = s;
          }
        });

        let p0Attached = !!col0;
        let p1Attached = !!col1;
        let p0ColId = col0 ? col0.id : undefined;
        let p1ColId = col1 ? col1.id : undefined;

        if (col0 && col1) {
          // CASE 2 — BOTH endpoints attach to columns: snap each to its column edge point
          const target0 = getColumnEdgePoint(col0, p1);
          const target1 = getColumnEdgePoint(col1, p0);
          p0 = { ...p0, x: target0.x, y: target0.y };
          p1 = { ...p1, x: target1.x, y: target1.y };
        } else if (col0) {
          const target0 = getColumnEdgePoint(col0, p1);
          if (draggingHandle === 'start') {
            p0 = { ...p0, x: target0.x, y: target0.y };
          } else if (draggingHandle === 'end') {
            p0 = { ...p0, x: target0.x, y: target0.y };
          } else {
            // Dragging middle -> translate ENTIRE run rigidly
            const deltaX = target0.x - p0.x;
            const deltaY = target0.y - p0.y;
            p0 = { ...p0, x: target0.x, y: target0.y };
            p1 = { ...p1, x: p1.x + deltaX, y: p1.y + deltaY };
          }
        } else if (col1) {
          const target1 = getColumnEdgePoint(col1, p0);
          if (draggingHandle === 'end') {
            p1 = { ...p1, x: target1.x, y: target1.y };
          } else if (draggingHandle === 'start') {
            p1 = { ...p1, x: target1.x, y: target1.y };
          } else {
            // Dragging middle -> translate ENTIRE run rigidly
            const deltaX = target1.x - p1.x;
            const deltaY = target1.y - p1.y;
            p1 = { ...p1, x: target1.x, y: target1.y };
            p0 = { ...p0, x: p0.x + deltaX, y: p0.y + deltaY };
          }
        }

        ptsToProcess = [p0, p1];

        if (getDistance(ptsToProcess[0], ptsToProcess[1]) < 6) {
          // Clean up or reset if segment is too short
          const remaining = runs.filter(r => r.id !== draggingRunId);
          setRuns(remaining);
          if (remaining.length > 0) {
            setActiveRunId(remaining[0].id);
          } else {
            setActiveRunId('');
          }
        } else {
          // Apply final points, orientation, and column attachment flags
          const computedOrientation = computeRunOrientation(ptsToProcess[0], ptsToProcess[1]);
          const updatedRuns = runs.map(r => r.id === draggingRunId ? {
            ...r,
            points: ptsToProcess,
            orientation: computedOrientation,
            startIsColumn: p0Attached,
            endIsColumn: p1Attached,
            startColumnId: p0ColId,
            endColumnId: p1ColId,
          } : r);

          setRuns(updatedRuns);
        }
      }
    }

    setDraggingHandle(null);
    setDraggingRunId(null);
    setIsPanning(false);
    setIsDrawingNew(false);
    isFirstRunDrawRef.current = false;
  };

  const handleTouchStart = (e: React.TouchEvent<SVGSVGElement>) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      handleMouseDown({
        clientX: touch.clientX,
        clientY: touch.clientY,
        target: e.target,
        button: 0,
        shiftKey: false,
        stopPropagation: () => e.stopPropagation(),
        preventDefault: () => e.preventDefault(),
      } as unknown as React.MouseEvent<SVGSVGElement>);
    }
  };

  const handleTouchMove = (e: React.TouchEvent<SVGSVGElement>) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      handleMouseMove({
        clientX: touch.clientX,
        clientY: touch.clientY,
        target: e.target,
        stopPropagation: () => e.stopPropagation(),
        preventDefault: () => e.preventDefault(),
      } as unknown as React.MouseEvent<SVGSVGElement>);
    }
  };

  const handleTouchEnd = () => {
    handleMouseUp();
  };

  // Reset to single default run
  const resetToAllDefaults = () => {
    onStartAction();
    setRuns([]);
    setActiveRunId('');
  };

  const addNewRun = () => {
    onStartAction();
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

  const handleDeleteActiveSelection = () => {
    if (selectedShapeId) {
      handleDeleteShape(selectedShapeId);
    } else if (activeRunId) {
      onStartAction();
      if (runs.length <= 1) {
        setRuns([]);
        setActiveRunId('');
      } else {
        const remaining = runs.filter(r => r.id !== activeRunId);
        setRuns(remaining);
        setActiveRunId(remaining.length > 0 ? remaining[0].id : '');
      }
    }
  };

  const copySelectedRun = () => {
    const activeRunToCopy = runs.find(r => r.id === activeRunId);
    if (activeRunToCopy) {
      setClipboard(JSON.parse(JSON.stringify(activeRunToCopy)));
      setLastCopiedType('run');
      setPasteCount(0);
    }
  };

  const copySelectedShape = () => {
    const shapeToCopy = shapeList.find(s => s.id === selectedShapeId);
    if (shapeToCopy) {
      setShapeClipboard(JSON.parse(JSON.stringify(shapeToCopy)));
      setLastCopiedType('shape');
      setPasteCount(0);
    }
  };

  const pasteSelection = () => {
    if (lastCopiedType === 'shape' && shapeClipboard) {
      onStartAction();
      const nextPasteCount = pasteCount + 1;
      setPasteCount(nextPasteCount);

      const newShape: CanvasShape = {
        ...shapeClipboard,
        id: `shape-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        x: Math.min(canvasWidth - 50, shapeClipboard.x + 24 * nextPasteCount),
        y: Math.min(canvasHeight - 50, shapeClipboard.y + 24 * nextPasteCount),
      };

      if (setShapes) {
        setShapes(prev => [...prev, newShape]);
      }
      setSelectedShapeId(newShape.id);
    } else if (clipboard) {
      pasteRun();
    }
  };

  const pasteRun = (forceOffset = false) => {
    if (!clipboard) return;

    onStartAction();

    const nextPasteCount = pasteCount + 1;
    setPasteCount(nextPasteCount);

    const p1 = clipboard.points[0];
    const p2 = clipboard.points[1];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;

    let baseX = p1.x;
    let baseY = p1.y;

    if (isMouseOverRef.current && mouseLogicalRef.current && !forceOffset) {
      const size = options.gridSize || 12;
      const snappedX = Math.round(mouseLogicalRef.current.x / size) * size;
      const snappedY = Math.round(mouseLogicalRef.current.y / size) * size;

      baseX = snappedX + 24 * (nextPasteCount - 1);
      baseY = snappedY + 24 * (nextPasteCount - 1);
    } else {
      baseX = p1.x + 24 * nextPasteCount;
      baseY = p1.y + 24 * nextPasteCount;
    }

    const newRunId = `run-${Date.now()}`;
    const newPoints = [
      { id: `start-${newRunId}`, x: Math.max(20, Math.min(canvasWidth - 20, baseX)), y: Math.max(20, Math.min(canvasHeight - 20, baseY)) },
      { id: `end-${newRunId}`, x: Math.max(20, Math.min(canvasWidth - 20, baseX + dx)), y: Math.max(20, Math.min(canvasHeight - 20, baseY + dy)) },
    ];

    const newRun: RailingRun = {
      ...clipboard,
      id: newRunId,
      points: newPoints,
    };
    if (clipboard.stairOpening) {
      newRun.stairOpening = { ...clipboard.stairOpening };
    }

    setRuns(prev => [...prev, newRun]);
    setActiveRunId(newRunId);
  };

  const duplicateActiveRun = () => {
    const activeRunToCopy = runs.find(r => r.id === activeRunId);
    if (activeRunToCopy) {
      const runCopy = JSON.parse(JSON.stringify(activeRunToCopy));
      setClipboard(runCopy);
      setLastCopiedType('run');

      onStartAction();

      const nextPasteCount = pasteCount + 1;
      setPasteCount(nextPasteCount);

      const p1 = runCopy.points[0];
      const p2 = runCopy.points[1];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;

      const baseX = p1.x + 24 * nextPasteCount;
      const baseY = p1.y + 24 * nextPasteCount;

      const newRunId = `run-${Date.now()}`;
      const newPoints = [
        { id: `start-${newRunId}`, x: Math.max(20, Math.min(canvasWidth - 20, baseX)), y: Math.max(20, Math.min(canvasHeight - 20, baseY)) },
        { id: `end-${newRunId}`, x: Math.max(20, Math.min(canvasWidth - 20, baseX + dx)), y: Math.max(20, Math.min(canvasHeight - 20, baseY + dy)) },
      ];

      const newRun: RailingRun = {
        ...runCopy,
        id: newRunId,
        points: newPoints,
      };
      if (runCopy.stairOpening) {
        newRun.stairOpening = { ...runCopy.stairOpening };
      }

      setRuns(prev => [...prev, newRun]);
      setActiveRunId(newRunId);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isActive || readOnly) return;

      const activeEl = document.activeElement;
      if (activeEl && (
        activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        (activeEl as HTMLElement).isContentEditable
      )) {
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedShapeId || activeRunId) {
          e.preventDefault();
          handleDeleteActiveSelection();
          return;
        }
      }

      const isCmdOrCtrl = e.metaKey || e.ctrlKey;
      if (isCmdOrCtrl) {
        if (e.key === 'c' || e.key === 'C') {
          if (selectedShapeId) {
            e.preventDefault();
            copySelectedShape();
          } else if (activeRunId) {
            e.preventDefault();
            copySelectedRun();
          }
        } else if (e.key === 'v' || e.key === 'V') {
          if ((lastCopiedType === 'shape' && shapeClipboard) || (lastCopiedType === 'run' && clipboard) || clipboard) {
            e.preventDefault();
            pasteSelection();
          }
        } else if (e.key === 'd' || e.key === 'D') {
          if (selectedShapeId || activeRunId) {
            e.preventDefault();
            handleDuplicateSelection();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isActive, runs, activeRunId, toolMode, clipboard, shapeClipboard, lastCopiedType, pasteCount, options.gridSize, selectedShapeId, shapeList]);

  const isFeet = options.unitMode === 'feet';

  const getProjectionVector = (angle: number, dir: StairDirection) => {
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    if (dir === StairDirection.UP || dir === StairDirection.LEFT) {
      return { x: uy, y: -ux };
    } else {
      return { x: -uy, y: ux };
    }
  };

  // Calculate overall metrics
  const totalInchesAll = calculatedRuns.reduce((sum, cr) => cr.isHouseWall ? sum : sum + cr.totalLength, 0);
  const totalPostsAll = calculatedRuns.reduce((sum, cr) => {
    if (cr.isHouseWall) return sum;
    return sum + cr.posts.filter((p, pIdx) => {
      if (p.isDuplicate) return false;
      const isStartColumn = pIdx === 0 && cr.startIsColumn;
      const isEndColumn = pIdx === cr.posts.length - 1 && cr.endIsColumn;
      if (isStartColumn || isEndColumn) return false;
      if (p.isColumn) return false;
      return true;
    }).length;
  }, 0);

  return (
    <div ref={containerRef} className="flex flex-col w-full h-full bg-white text-slate-900 rounded-2xl overflow-hidden border border-slate-200/80 shadow-lg relative">

      {/* 1. Header Control Strip */}
      {!readOnly && (
        <div className="flex flex-wrap items-center justify-between px-5 py-3.5 bg-slate-50 border-b border-slate-200 z-10 gap-3">
          <div className="flex items-center gap-2.5">
          {/* "+ Add" Popover Button */}
          <div className="relative z-30">
            <button
              onClick={() => setShowAddMenu(prev => !prev)}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-lg border transition-all flex items-center gap-1.5 shadow-xs focus:outline-none ${
                showAddMenu
                  ? 'bg-teal-600 text-white border-teal-700 shadow-md'
                  : 'bg-white text-slate-800 border-slate-200 hover:bg-slate-50 hover:border-slate-350'
              }`}
              title="Add shapes (columns, pools, grass lawn, BBQ counter) to canvas"
            >
              <Plus size={14} className={showAddMenu ? 'text-white' : 'text-teal-600'} />
              <span>Add</span>
            </button>

            {showAddMenu && (
              <div className="absolute top-full left-0 mt-2 w-56 bg-white border border-slate-200 rounded-xl shadow-xl z-50 p-2.5 space-y-2 animate-in fade-in slide-in-from-top-1 duration-150">
                <div className="px-2 py-1 border-b border-slate-100">
                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block font-sans">
                    CLICK TO ADD TO CANVAS
                  </span>
                </div>

                <div className="space-y-0.5">
                  {/* Square Column */}
                  <button
                    onClick={() => handleAddShape('square_column')}
                    className="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg hover:bg-slate-100 text-left transition-colors group"
                  >
                    <div className="w-5 h-5 rounded border border-slate-400 bg-slate-100 flex items-center justify-center shrink-0 shadow-2xs">
                      <div className="w-2.5 h-2.5 border border-slate-500 bg-slate-200 rounded-xs"></div>
                    </div>
                    <span className="text-xs font-semibold text-slate-700 group-hover:text-slate-900">
                      Square Column
                    </span>
                  </button>

                  {/* Circular Column */}
                  <button
                    onClick={() => handleAddShape('circular_column')}
                    className="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg hover:bg-slate-100 text-left transition-colors group"
                  >
                    <div className="w-5 h-5 rounded-full border border-slate-400 bg-slate-100 flex items-center justify-center shrink-0 shadow-2xs">
                      <div className="w-2.5 h-2.5 border border-slate-500 bg-slate-200 rounded-full"></div>
                    </div>
                    <span className="text-xs font-semibold text-slate-700 group-hover:text-slate-900">
                      Circular Column
                    </span>
                  </button>

                  {/* Swimming Pool (Rect) */}
                  <button
                    onClick={() => handleAddShape('pool_rect')}
                    className="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg hover:bg-slate-100 text-left transition-colors group"
                  >
                    <div className="w-5 h-3 rounded-xs bg-cyan-400 border border-cyan-500 shrink-0 shadow-2xs"></div>
                    <span className="text-xs font-semibold text-slate-700 group-hover:text-slate-900">
                      Swimming Pool (Rect)
                    </span>
                  </button>

                  {/* Swimming Pool (Circle) */}
                  <button
                    onClick={() => handleAddShape('pool_circle')}
                    className="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg hover:bg-slate-100 text-left transition-colors group"
                  >
                    <div className="w-4 h-4 rounded-full bg-cyan-400 border border-cyan-500 shrink-0 shadow-2xs"></div>
                    <span className="text-xs font-semibold text-slate-700 group-hover:text-slate-900">
                      Swimming Pool (Circle)
                    </span>
                  </button>

                  {/* Grass Lawn / Area */}
                  <button
                    onClick={() => handleAddShape('grass_lawn')}
                    className="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg hover:bg-slate-100 text-left transition-colors group"
                  >
                    <div className="w-5 h-3 rounded-xs bg-emerald-500 border border-emerald-600 shrink-0 shadow-2xs"></div>
                    <span className="text-xs font-semibold text-slate-700 group-hover:text-slate-900">
                      Grass Lawn / Area
                    </span>
                  </button>

                  {/* BBQ / Kitchen Counter */}
                  <button
                    onClick={() => handleAddShape('bbq_counter')}
                    className="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg hover:bg-slate-100 text-left transition-colors group"
                  >
                    <div className="w-5 h-3.5 rounded-xs bg-slate-800 border border-slate-900 shrink-0 shadow-2xs"></div>
                    <span className="text-xs font-semibold text-slate-700 group-hover:text-slate-900">
                      BBQ / Kitchen Counter
                    </span>
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="h-4 w-[1px] bg-slate-200"></div>

          {/* Tool Modes: DRAW / SELECT */}
          <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-2xs items-center gap-0.5">
            <button
              onClick={() => setToolMode('draw')}
              className={`px-3 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all focus:outline-none ${toolMode === 'draw'
                ? 'bg-teal-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              title="Draw Mode"
            >
              <PenTool size={13} />
              <span>DRAW</span>
            </button>
            <button
              onClick={() => setToolMode('select')}
              className={`px-3 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all focus:outline-none ${toolMode === 'select'
                ? 'bg-teal-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              title="Select Mode: Select and move entire runs"
            >
              <MousePointer size={13} />
              <span>SELECT</span>
            </button>
          </div>

          <div className="h-4 w-[1px] bg-slate-200"></div>

          {/* History control group */}
          <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-2xs items-center">
            <button
              onClick={undo}
              disabled={!canUndo}
              className="p-1.5 rounded-md hover:bg-slate-50 disabled:opacity-30 disabled:hover:bg-transparent text-slate-600 hover:text-slate-900 disabled:text-slate-400 transition-colors"
              title="Go Back (Undo last action)"
            >
              <Undo size={14} />
            </button>
            <div className="w-[1px] h-4 bg-slate-200"></div>
            <button
              onClick={redo}
              disabled={!canRedo}
              className="p-1.5 rounded-md hover:bg-slate-50 disabled:opacity-30 disabled:hover:bg-transparent text-slate-600 hover:text-slate-900 disabled:text-slate-400 transition-colors"
              title="Move Forward (Redo last action)"
            >
              <Redo size={14} />
            </button>
          </div>

          <div className="h-4 w-[1px] bg-slate-200"></div>

          <span className="text-xs text-slate-500 font-medium hidden md:inline">
            {toolMode === 'draw'
              ? ''
              : 'Select Mode: Click a run to select it. Drag its body to move rigidly; drag its endpoints to resize.'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Delete active selection (run or shape) */}
          <button
            onClick={handleDeleteActiveSelection}
            disabled={!selectedShapeId && (!activeRunId || !runs.some(r => r.id === activeRunId))}
            className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 hover:border-red-300 transition-all flex items-center gap-1.5 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
            title="Delete the currently selected run or object"
          >
            <Trash2 size={13} />
            <span>Delete Active</span>
          </button>

          {/* Duplicate active selection (run or shape) */}
          {(activeRun || selectedShape) && (
            <button
              onClick={handleDuplicateSelection}
              className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-teal-50 text-teal-600 border border-teal-200 hover:bg-teal-100 hover:border-teal-300 transition-all flex items-center gap-1.5 shadow-sm"
              title="Duplicate the selected run or object"
            >
              <Copy size={13} />
              <span>Duplicate</span>
            </button>
          )}

          {/* Clear All button */}
          {(runs.length > 0 || shapeList.length > 0) && (
            <button
              onClick={clearAll}
              className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 hover:border-red-300 transition-all flex items-center gap-1.5 shadow-sm"
              title="Clear all runs and canvas objects"
            >
              <Eraser size={13} />
              <span>Clear All</span>
            </button>
          )}

          {/* Download Sketch PDF button */}
          <button
            onClick={handleExportPDF}
            disabled={isExportingPdf}
            className="px-3.5 py-1.5 text-xs font-bold rounded-lg bg-teal-600 text-white hover:bg-teal-700 active:bg-teal-800 transition-all flex items-center gap-1.5 shadow-sm disabled:opacity-50 cursor-pointer border border-teal-700"
            title="Download final 2D site plan sketch in PDF format with company logo, legend, and system breakdown"
          >
            <FileDown size={14} className={isExportingPdf ? 'animate-bounce' : 'stroke-[2.5]'} />
            <span>{isExportingPdf ? 'Exporting PDF...' : 'Download Sketch PDF'}</span>
          </button>
        </div>
      </div>
      )}

      {/* 2. Main Interactive Drawing Stage */}
      <div className={`flex-1 relative overflow-hidden select-none bg-white ${isPanning
        ? 'cursor-grabbing'
        : draggingHandle === 'all'
          ? 'cursor-grabbing'
          : draggingHandle
            ? 'cursor-move'
            : toolMode === 'select'
              ? 'cursor-default'
              : 'cursor-crosshair'
        }`}>

        {/* Drawing Stage Legend (Crisp architectural legend card, hidden in readOnly mode) */}
        {!readOnly && runs.length > 0 && (
          <div className={`absolute ${readOnly ? 'top-4 left-4' : 'bottom-4 right-16'} bg-white/95 border border-slate-200 rounded-xl p-2 shadow-md z-10 backdrop-blur-sm flex flex-col gap-1.5 max-w-[145px] text-[10px]`}>
            <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
              <span className="font-bold text-slate-800 uppercase tracking-wider text-[9px]">Legend</span>
              <span className="text-[8px] font-mono text-emerald-600 font-bold bg-emerald-50 px-1 py-0.2 rounded">Active</span>
            </div>

            <div className="space-y-1.5">
              {/* End Post */}
              {usedLegendItems.hasEndPost && (
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 bg-black border border-slate-250 shrink-0 shadow-xs"></div>
                  <div>
                    <p className="font-bold text-slate-800 text-[10px] leading-tight">End Post</p>
                    <p className="text-[8px] text-slate-500 leading-none mt-0.5 font-mono">Anchor end (Black)</p>
                  </div>
                </div>
              )}

              {/* Intermediate Line Post */}
              {usedLegendItems.hasLinePost && (
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 bg-emerald-500 border border-slate-250 shrink-0 shadow-xs"></div>
                  <div>
                    <p className="font-bold text-slate-800 text-[10px] leading-tight">Line Post</p>
                    <p className="text-[8px] text-slate-500 leading-none mt-0.5 font-mono">Line support</p>
                  </div>
                </div>
              )}

              {/* Corner Post (Joint) */}
              {usedLegendItems.hasCornerPost && (
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 bg-blue-600 border border-slate-250 shrink-0 shadow-xs"></div>
                  <div>
                    <p className="font-bold text-slate-800 text-[10px] leading-tight">Corner Post</p>
                    <p className="text-[8px] text-slate-500 leading-none mt-0.5 font-mono">Run joint</p>
                  </div>
                </div>
              )}

              {/* 45° Angle Post (Angled run joint) */}
              {usedLegendItems.hasAnglePost && (
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 bg-orange-500 border border-slate-250 shrink-0 shadow-xs"></div>
                  <div>
                    <p className="font-bold text-slate-800 text-[10px] leading-tight">45° Post</p>
                    <p className="text-[8px] text-slate-500 leading-none mt-0.5 font-mono">Angled run joint</p>
                  </div>
                </div>
              )}

              {/* Stair Post */}
              {usedLegendItems.hasStairPost && (
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 bg-pink-500 border border-slate-250 shrink-0 shadow-xs"></div>
                  <div>
                    <p className="font-bold text-slate-800 text-[10px] leading-tight">Stair Post</p>
                    <p className="text-[8px] text-slate-500 leading-none mt-0.5 font-mono">Bottom stair anchor (Pink)</p>
                  </div>
                </div>
              )}

              {/* Continuous Bracket */}
              {usedLegendItems.hasMidStairPost && (
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 bg-pink-500 border-2 border-green-500 shrink-0 shadow-xs"></div>
                  <div>
                    <p className="font-bold text-slate-800 text-[10px] leading-tight">Mid-Stair Post</p>
                    <p className="text-[8px] text-slate-500 leading-none mt-0.5 font-mono">Continuous bracket (Green outline)</p>
                  </div>
                </div>
              )}

              {/* Column Bracket */}
              {usedLegendItems.hasColumnBracket && (
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 bg-orange-600 border border-orange-700 shrink-0 shadow-xs rounded-xs"></div>
                  <div>
                    <p className="font-bold text-slate-800 text-[10px] leading-tight">Column Bracket</p>
                    <p className="text-[8px] text-slate-500 leading-none mt-0.5 font-mono">Top & Bottom (Orange)</p>
                  </div>
                </div>
              )}

              {/* Picket Railing Line */}
              {usedLegendItems.hasPicketRun && (
                <div className="flex items-center gap-1.5 border-t border-slate-100 pt-1.5 mt-0.5">
                  <div className="w-4 h-[2px] bg-black shrink-0 rounded-full"></div>
                  <div>
                    <p className="font-bold text-slate-800 text-[10px] leading-tight">Picket Railing</p>
                    <p className="text-[8px] text-slate-500 leading-none mt-0.5 font-mono">Railing run</p>
                  </div>
                </div>
              )}

              {/* Glass Railing Line */}
              {usedLegendItems.hasGlassRun && (
                <div className="flex items-center gap-1.5 border-t border-slate-100 pt-1.5 mt-0.5">
                  <div className="w-4 h-[2px] bg-[#3b82f6] shrink-0 rounded-full"></div>
                  <div>
                    <p className="font-bold text-slate-800 text-[10px] leading-tight">Glass Railing</p>
                    <p className="text-[8px] text-slate-500 leading-none mt-0.5 font-mono">Railing run</p>
                  </div>
                </div>
              )}

              {/* Stair Railing Line */}
              {usedLegendItems.hasStairSegment && (
                <div className="flex items-center gap-1.5 border-t border-slate-100 pt-1.5 mt-0.5">
                  <div className="w-4 h-[2px] bg-[#94a3b8] shrink-0 rounded-full"></div>
                  <div>
                    <p className="font-bold text-slate-800 text-[10px] leading-tight">Stair Railing</p>
                    <p className="text-[8px] text-slate-500 leading-none mt-0.5 font-mono">Stair side rail</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Viewport Control Box */}
        {!readOnly && (
          <div className="absolute bottom-4 right-4 flex flex-col bg-white border border-slate-200 rounded-xl p-1 gap-1 shadow-md z-10">
            <button
              onClick={() => centerAndFit()}
              className="p-2 rounded-lg hover:bg-slate-50 text-teal-600 transition-colors"
              title="Auto Center View"
            >
              <Compass size={14} />
            </button>
            <div className="h-[1px] bg-slate-100 my-1 mx-1.5"></div>
            <button
              onClick={() => setOptions(prev => ({ ...prev, gridSnapping: !prev.gridSnapping }))}
              className={`p-2 rounded-lg transition-all ${options.gridSnapping ? 'text-teal-600 bg-teal-50 border border-teal-150' : 'text-slate-400 hover:bg-slate-50'
                }`}
              title="Toggle Grid Snapping"
            >
              <Grid size={14} />
            </button>
          </div>
        )}

        {/* Floating Zoom Control Toolbar */}
        {!readOnly && (
          <div className="absolute bottom-4 left-4 flex items-center bg-white border border-slate-200 rounded-xl p-1 gap-1.5 shadow-md z-10 backdrop-blur-sm select-none" id="zoom-control-toolbar">
            {/* Zoom In Button */}
            <button
              onClick={() => zoomAroundCenter(zoom + 0.1)}
              className="p-1.5 bg-slate-50 hover:bg-slate-100 active:bg-slate-200 border border-slate-200 rounded-lg text-slate-700 hover:text-slate-900 transition-colors flex items-center justify-center shrink-0"
              title="Zoom In"
              id="zoom-in-btn"
            >
              <ZoomIn size={14} className="stroke-[2.5]" />
            </button>

            {/* Zoom Percentage Label */}
            <span className="text-slate-700 font-mono font-bold text-[11px] px-1 select-none min-w-[42px] text-center" id="zoom-percentage-label">
              {Math.round(zoom * 100)}%
            </span>

            {/* Zoom Out Button */}
            <button
              onClick={() => zoomAroundCenter(zoom - 0.1)}
              className="p-1.5 bg-slate-50 hover:bg-slate-100 active:bg-slate-200 border border-slate-200 rounded-lg text-slate-700 hover:text-slate-900 transition-colors flex items-center justify-center shrink-0"
              title="Zoom Out"
              id="zoom-out-btn"
            >
              <ZoomOut size={14} className="stroke-[2.5]" />
            </button>

            {/* Separator line */}
            <div className="w-[1px] h-4 bg-slate-200"></div>

            {/* Reset Zoom & Center Button */}
            <button
              onClick={() => resetZoomAndCenter()}
              className="px-2.5 py-1.5 bg-teal-50 hover:bg-teal-100 active:bg-teal-200 border border-teal-200 rounded-lg text-teal-700 font-bold text-[10px] uppercase tracking-wider transition-all shadow-xs"
              title="Reset Zoom to 100% & Auto Center"
              id="zoom-reset-btn"
            >
              RESET
            </button>
          </div>
        )}

        {/* Scale/Status footer indicators (Shifted up slightly above the zoom toolbar) */}
        {!readOnly && (
          <div className="absolute bottom-16 left-4 flex bg-white/95 border border-slate-200 rounded-xl px-3 py-1.5 text-[10px] text-slate-500 font-mono gap-3 items-center shadow-sm z-10 backdrop-blur-sm" id="scale-status-indicators">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-teal-500"></div>
              <span>Selected Lock: <strong className="text-slate-800 capitalize font-bold">{activeRun?.orientation || 'horizontal'}</strong></span>
            </div>
            <div className="w-[1px] h-3 bg-slate-200"></div>
            <div>
              <span>Increment Snap: <strong className="text-slate-800 font-bold">{options.gridSnapping ? `${options.gridSize}"` : "None"}</strong></span>
            </div>
            <div className="w-[1px] h-3 bg-slate-200"></div>
            <div>
              <span>Total Runs: <strong className="text-teal-600 font-bold">{runs.length}</strong></span>
            </div>
          </div>
        )}

        {/* CAD Blueprint SVG Stage (White drafting sheet on clean grey board) */}
        <svg
          ref={svgRef}
          className="w-full h-full bg-slate-100 touch-none"
          onMouseEnter={() => { isMouseOverRef.current = true; }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onMouseLeave={() => {
            isMouseOverRef.current = false;
            mouseLogicalRef.current = null;
            handleMouseUp();
          }}
          onContextMenu={(e) => e.preventDefault()}
          id="railing-svg-stage"
        >
          {/* Crisp, light grey architectural patterns */}
          <defs>
            <pattern id="light-grid-minor" width={24 * scale} height={24 * scale} patternUnits="userSpaceOnUse">
              <path d={`M ${24 * scale} 0 L 0 0 0 ${24 * scale}`} fill="none" stroke="#f1f5f9" strokeWidth="0.8" opacity="1.0" />
            </pattern>
            <pattern id="light-grid-major" width={120 * scale} height={120 * scale} patternUnits="userSpaceOnUse">
              <rect width={120 * scale} height={120 * scale} fill="url(#light-grid-minor)" />
              <path d={`M ${120 * scale} 0 L 0 0 0 ${120 * scale}`} fill="none" stroke="#cbd5e1" strokeWidth="1.2" opacity="0.8" />
            </pattern>
          </defs>

          {/* Drawing Layer Group */}
          <g style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}>
            {/* White Paper Layout Sheet */}
            <rect
              x={0}
              y={0}
              width={canvasWidth * scale}
              height={canvasHeight * scale}
              fill="#ffffff"
              stroke="#cbd5e1"
              strokeWidth={1.5}
              style={{ filter: 'drop-shadow(0px 2px 8px rgba(15, 23, 42, 0.06))' }}
            />

            {/* Grid pattern overlay restricted to the sheet boundary */}
            <rect
              x={0}
              y={0}
              width={canvasWidth * scale}
              height={canvasHeight * scale}
              fill="url(#light-grid-major)"
              className="pointer-events-none"
            />

            {/* Pass 0 — Added canvas shapes (columns, pools, grass lawn, bbq counter) */}
            {shapeList.map((shape) => {
              const dims = getFixedShapeDimensions(shape.type);
              const cx = shape.x * scale;
              const cy = shape.y * scale;
              const sw = dims.width * scale;
              const sh = dims.height * scale;
              const isSelected = selectedShapeId === shape.id;

              return (
                <g key={`shape-${shape.id}`} className="cursor-grab active:cursor-grabbing">
                  {/* Selection Highlight Box */}
                  {isSelected && (
                    <rect
                      x={cx - sw / 2 - 6 * scale}
                      y={cy - sh / 2 - 6 * scale}
                      width={sw + 12 * scale}
                      height={sh + 12 * scale}
                      fill="none"
                      stroke="#0d9488"
                      strokeWidth={2 * scale}
                      strokeDasharray="4,4"
                      rx={6 * scale}
                      className="pointer-events-none animate-pulse"
                    />
                  )}

                  {/* Shape Graphics */}
                  {shape.type === 'square_column' && (
                    <g>
                      {(activeSnapColumnId === shape.id || runs.some(r => {
                        if (r.isHouseWall || !r.points || r.points.length < 2) return false;
                        const dist = Math.max(dims.width, dims.height) / 2 + 8;
                        return (r.startIsColumn && Math.hypot(r.points[0].x - shape.x, r.points[0].y - shape.y) <= dist) ||
                               (r.endIsColumn && Math.hypot(r.points[1].x - shape.x, r.points[1].y - shape.y) <= dist);
                      })) && (
                        <rect
                          x={cx - sw / 2 - 4 * scale}
                          y={cy - sh / 2 - 4 * scale}
                          width={sw + 8 * scale}
                          height={sh + 8 * scale}
                          rx={5 * scale}
                          fill="none"
                          stroke="#0d9488"
                          strokeWidth={2.5 * scale}
                          strokeDasharray="4 2"
                          className="pointer-events-none animate-pulse"
                        />
                      )}
                      <rect
                        x={cx - sw / 2}
                        y={cy - sh / 2}
                        width={sw}
                        height={sh}
                        rx={3 * scale}
                        fill="#f8fafc"
                        stroke="#334155"
                        strokeWidth={2.5 * scale}
                        data-shape-id={shape.id}
                      />
                      <line
                        x1={cx - sw / 2}
                        y1={cy - sh / 2}
                        x2={cx + sw / 2}
                        y2={cy + sh / 2}
                        stroke="#cbd5e1"
                        strokeWidth={1.5 * scale}
                        className="pointer-events-none"
                      />
                      <line
                        x1={cx + sw / 2}
                        y1={cy - sh / 2}
                        x2={cx - sw / 2}
                        y2={cy + sh / 2}
                        stroke="#cbd5e1"
                        strokeWidth={1.5 * scale}
                        className="pointer-events-none"
                      />
                    </g>
                  )}

                  {shape.type === 'circular_column' && (
                    <g>
                      {(activeSnapColumnId === shape.id || runs.some(r => {
                        if (r.isHouseWall || !r.points || r.points.length < 2) return false;
                        const dist = Math.max(dims.width, dims.height) / 2 + 8;
                        return (r.startIsColumn && Math.hypot(r.points[0].x - shape.x, r.points[0].y - shape.y) <= dist) ||
                               (r.endIsColumn && Math.hypot(r.points[1].x - shape.x, r.points[1].y - shape.y) <= dist);
                      })) && (
                        <circle
                          cx={cx}
                          cy={cy}
                          r={sw / 2 + 4 * scale}
                          fill="none"
                          stroke="#0d9488"
                          strokeWidth={2.5 * scale}
                          strokeDasharray="4 2"
                          className="pointer-events-none animate-pulse"
                        />
                      )}
                      <circle
                        cx={cx}
                        cy={cy}
                        r={sw / 2}
                        fill="#f8fafc"
                        stroke="#334155"
                        strokeWidth={2.5 * scale}
                        data-shape-id={shape.id}
                      />
                      <circle
                        cx={cx}
                        cy={cy}
                        r={sw / 4}
                        fill="none"
                        stroke="#cbd5e1"
                        strokeWidth={1.5 * scale}
                        className="pointer-events-none"
                      />
                    </g>
                  )}

                  {shape.type === 'pool_rect' && (
                    <g>
                      <rect
                        x={cx - sw / 2}
                        y={cy - sh / 2}
                        width={sw}
                        height={sh}
                        rx={8 * scale}
                        fill="#38bdf8"
                        fillOpacity={0.25}
                        stroke="#0284c7"
                        strokeWidth={3 * scale}
                        data-shape-id={shape.id}
                      />
                      <rect
                        x={cx - sw / 2 + 4 * scale}
                        y={cy - sh / 2 + 4 * scale}
                        width={sw - 8 * scale}
                        height={sh - 8 * scale}
                        rx={6 * scale}
                        fill="none"
                        stroke="#38bdf8"
                        strokeWidth={1.5 * scale}
                        strokeDasharray="6,4"
                        className="pointer-events-none"
                      />
                    </g>
                  )}

                  {shape.type === 'pool_circle' && (
                    <g>
                      <circle
                        cx={cx}
                        cy={cy}
                        r={sw / 2}
                        fill="#38bdf8"
                        fillOpacity={0.25}
                        stroke="#0284c7"
                        strokeWidth={3 * scale}
                        data-shape-id={shape.id}
                      />
                      <circle
                        cx={cx}
                        cy={cy}
                        r={sw / 2 - 4 * scale}
                        fill="none"
                        stroke="#38bdf8"
                        strokeWidth={1.5 * scale}
                        strokeDasharray="6,4"
                        className="pointer-events-none"
                      />
                    </g>
                  )}

                  {shape.type === 'grass_lawn' && (
                    <g>
                      <rect
                        x={cx - sw / 2}
                        y={cy - sh / 2}
                        width={sw}
                        height={sh}
                        rx={6 * scale}
                        fill="#4ade80"
                        fillOpacity={0.22}
                        stroke="#16a34a"
                        strokeWidth={2.5 * scale}
                        data-shape-id={shape.id}
                      />
                    </g>
                  )}

                  {shape.type === 'bbq_counter' && (
                    <g>
                      <rect
                        x={cx - sw / 2}
                        y={cy - sh / 2}
                        width={sw}
                        height={sh}
                        rx={4 * scale}
                        fill="#1e293b"
                        stroke="#0f172a"
                        strokeWidth={2.5 * scale}
                        data-shape-id={shape.id}
                      />
                      <rect
                        x={cx - sw / 4}
                        y={cy - sh / 3}
                        width={sw / 2}
                        height={(2 * sh) / 3}
                        rx={2 * scale}
                        fill="#334155"
                        stroke="#475569"
                        strokeWidth={1.5 * scale}
                        className="pointer-events-none"
                      />
                    </g>
                  )}


                </g>
              );
            })}

            {/* Pass 1 — draw every run's rail lines, stair treads, dimension labels, and other underlays */}
            {(() => {
              const allPosts: { x: number; y: number }[] = [];
              calculatedRuns.forEach(cr => {
                cr.posts.forEach(p => {
                  if (!p.isDuplicate) {
                    allPosts.push({ x: p.x, y: p.y });
                  }
                });
              });

              const pointToSegmentDistance = (
                px: number, py: number,
                ax: number, ay: number,
                bx: number, by: number
              ): number => {
                const dxSegment = bx - ax;
                const dySegment = by - ay;
                const lenSq = dxSegment * dxSegment + dySegment * dySegment;
                if (lenSq === 0) {
                  return Math.hypot(px - ax, py - ay);
                }
                let t = ((px - ax) * dxSegment + (py - ay) * dySegment) / lenSq;
                t = Math.max(0, Math.min(1, t));
                const projX = ax + t * dxSegment;
                const projY = ay + t * dySegment;
                return Math.hypot(px - projX, py - projY);
              };

              const getClearance = (px: number, py: number, currentRunId?: string): number => {
                const pillWidthInches = 70 / scale;
                const pillHeightInches = 22 / scale;
                const pillXMin = px - pillWidthInches / 2;
                const pillXMax = px + pillWidthInches / 2;
                const pillYMin = py - pillHeightInches / 2;
                const pillYMax = py + pillHeightInches / 2;

                const intersectsAnyPost = allPosts.some(post => {
                  const postSizeInches = POST_MARKER_PX / scale;
                  const postHalf = postSizeInches / 2;
                  const postXMin = post.x - postHalf;
                  const postXMax = post.x + postHalf;
                  const postYMin = post.y - postHalf;
                  const postYMax = post.y + postHalf;

                  return (
                    pillXMin <= postXMax &&
                    pillXMax >= postXMin &&
                    pillYMin <= postYMax &&
                    pillYMax >= postYMin
                  );
                });

                if (intersectsAnyPost) {
                  return 0;
                }

                let minDistance = Infinity;

                calculatedRuns.forEach(cr => {
                  if (cr.id === currentRunId) return;

                  cr.segments.forEach(s => {
                    if (!s.posts || s.posts.length < 2) return;

                    const sSp = s.posts[0];
                    const sEp = s.posts[s.posts.length - 1];

                    const distToLine = pointToSegmentDistance(px, py, sSp.x, sSp.y, sEp.x, sEp.y);
                    if (distToLine < minDistance) {
                      minDistance = distToLine;
                    }

                    if (s.isStairOpening && s.stairOpening && s.stairOpening.enabled) {
                      const stairOpening = s.stairOpening;
                      const numRisers = stairOpening.risers;
                      const stairRunInches = numRisers * 12;
                      const projVec = getProjectionVector(s.angle, stairOpening.direction);

                      const psp = {
                        x: sSp.x + projVec.x * stairRunInches,
                        y: sSp.y + projVec.y * stairRunInches,
                      };
                      const pep = {
                        x: sEp.x + projVec.x * stairRunInches,
                        y: sEp.y + projVec.y * stairRunInches,
                      };

                      const d1 = pointToSegmentDistance(px, py, sSp.x, sSp.y, psp.x, psp.y);
                      const d2 = pointToSegmentDistance(px, py, sEp.x, sEp.y, pep.x, pep.y);
                      const d3 = pointToSegmentDistance(px, py, psp.x, psp.y, pep.x, pep.y);

                      if (d1 < minDistance) minDistance = d1;
                      if (d2 < minDistance) minDistance = d2;
                      if (d3 < minDistance) minDistance = d3;
                    }
                  });
                });

                shapeList.forEach(shape => {
                  const isCircular = shape.type === 'circular_column' || shape.type === 'pool_circle';
                  if (isCircular) {
                    const cx = shape.x;
                    const cy = shape.y;
                    const radius = shape.width / 2;
                    const distToCenter = Math.hypot(px - cx, py - cy);
                    const distToBoundary = Math.max(0, distToCenter - radius);
                    if (distToBoundary < minDistance) {
                      minDistance = distToBoundary;
                    }
                  } else {
                    const minX = shape.x - shape.width / 2;
                    const maxX = shape.x + shape.width / 2;
                    const minY = shape.y - shape.height / 2;
                    const maxY = shape.y + shape.height / 2;

                    const dx = Math.max(minX - px, 0, px - maxX);
                    const dy = Math.max(minY - py, 0, py - maxY);
                    const distToRect = Math.hypot(dx, dy);
                    if (distToRect < minDistance) {
                      minDistance = distToRect;
                    }
                  }
                });

                return minDistance;
              };

              const computeOptimalLabelOffset = (
                baseX: number,
                baseY: number,
                perpX: number,
                perpY: number,
                baseOffset: number,
                runId?: string
              ) => {
                const clearancePlus = getClearance(baseX + baseOffset * perpX, baseY + baseOffset * perpY, runId);
                const clearanceMinus = getClearance(baseX - baseOffset * perpX, baseY - baseOffset * perpY, runId);

                let chosenSign = clearancePlus >= clearanceMinus ? 1 : -1;
                let finalOffset = baseOffset;

                if (clearancePlus < 24 && clearanceMinus < 24) {
                  const steps = [baseOffset + 12, baseOffset + 24, baseOffset + 36];
                  let bestClearance = Math.max(clearancePlus, clearanceMinus);
                  let bestSign = chosenSign;
                  let bestOffset = baseOffset;
                  let foundClear = false;

                  for (const stepOffset of steps) {
                    for (const sign of [chosenSign, -chosenSign]) {
                      const cl = getClearance(baseX + sign * stepOffset * perpX, baseY + sign * stepOffset * perpY, runId);
                      if (cl > bestClearance) {
                        bestClearance = cl;
                        bestSign = sign;
                        bestOffset = stepOffset;
                      }
                      if (cl >= 24) {
                        bestClearance = cl;
                        bestSign = sign;
                        bestOffset = stepOffset;
                        foundClear = true;
                        break;
                      }
                    }
                    if (foundClear) break;
                  }

                  chosenSign = bestSign;
                  finalOffset = bestOffset;
                }

                return {
                  x: baseX + chosenSign * finalOffset * perpX,
                  y: baseY + chosenSign * finalOffset * perpY,
                };
              };

              return calculatedRuns.map((cRun) => {
              const p1 = cRun.points[0];
              const p2 = cRun.points[1];
              const isActive = cRun.id === activeRunId;
              const runLength = cRun.totalLength;
              const runScreenLength = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2) * scale;
              const endpointHitRadius = Math.min(24, Math.max(8, runScreenLength * 0.35));

              return (
                <g key={`${cRun.id}-underlays`} className={toolMode === 'draw' ? 'pointer-events-none' : ''}>
                  {/* 1. Transparent thick line representing active drag/click area */}
                  <line
                    x1={p1.x * scale}
                    y1={p1.y * scale}
                    x2={p2.x * scale}
                    y2={p2.y * scale}
                    stroke="transparent"
                    strokeWidth={24}
                    className="cursor-grab active:cursor-grabbing"
                    data-handle-type="middle"
                    data-run-id={cRun.id}
                  />

                  {/* 2. Visual rendering of House Wall if designated */}
                  {cRun.isHouseWall && (() => {
                    const labelX = ((p1.x + p2.x) / 2) * scale;
                    const labelY = ((p1.y + p2.y) / 2) * scale;
                    const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
                    let wallAngleDeg = (angle * 180) / Math.PI;
                    if (wallAngleDeg > 90) {
                      wallAngleDeg -= 180;
                    } else if (wallAngleDeg < -90) {
                      wallAngleDeg += 180;
                    }

                    return (
                      <g key={`house-wall-visual-${cRun.id}`}>
                        {isActive && (
                          <line
                            x1={p1.x * scale}
                            y1={p1.y * scale}
                            x2={p2.x * scale}
                            y2={p2.y * scale}
                            stroke="#ccfbf1" // light teal highlight glow
                            strokeWidth={12 * scale}
                            strokeLinecap="round"
                          />
                        )}
                        <line
                          x1={p1.x * scale}
                          y1={p1.y * scale}
                          x2={p2.x * scale}
                          y2={p2.y * scale}
                          stroke="#94a3b8" // muted slate-400 gray
                          strokeWidth={6 * scale} // thicker line
                          strokeLinecap="square"
                          className="transition-all cursor-grab active:cursor-grabbing"
                          data-handle-type="middle"
                          data-run-id={cRun.id}
                        />
                        <g transform={`rotate(${wallAngleDeg}, ${labelX}, ${labelY})`}>
                          <text
                            x={labelX}
                            y={labelY - 10 * scale}
                            fill="#64748b" // slate-500
                            fontSize={Math.max(8, 9 * scale)}
                            fontWeight="extrabold"
                            textAnchor="middle"
                            letterSpacing="1px"
                            className="pointer-events-none select-none font-sans"
                          >
                            HOUSE WALL
                          </text>
                        </g>
                      </g>
                    );
                  })()}

                  {/* 3. Visual handrail segments (with cutout gaps for stair openings, and projections) */}
                  {!cRun.isHouseWall && cRun.segments.map((seg, sIdx) => {
                    const spX = seg.posts[0].x * scale;
                    const spY = seg.posts[0].y * scale;
                    const epX = seg.posts[seg.posts.length - 1].x * scale;
                    const epY = seg.posts[seg.posts.length - 1].y * scale;

                    if (seg.isStairOpening && seg.stairOpening) {
                      // Draw stair opening projection
                      const stairOpening = seg.stairOpening;
                      const numRisers = stairOpening.risers;
                      const stairRunInches = numRisers * 12;
                      const projVec = getProjectionVector(seg.angle, stairOpening.direction);

                      const projX = projVec.x * stairRunInches * scale;
                      const projY = projVec.y * stairRunInches * scale;

                      const endSpX = spX + projX;
                      const endSpY = spY + projY;
                      const endEpX = epX + projX;
                      const endEpY = epY + projY;

                      // Generate tread lines
                      const treads = [];
                      for (let k = 1; k < numRisers; k++) {
                        const ratio = k / numRisers;
                        const txStart = spX + projX * ratio;
                        const tyStart = spY + projY * ratio;
                        const txEnd = epX + projX * ratio;
                        const tyEnd = epY + projY * ratio;

                        treads.push(
                          <line
                            key={`stair-op-tread-${seg.id}-${k}`}
                            x1={txStart}
                            y1={tyStart}
                            x2={txEnd}
                            y2={tyEnd}
                            stroke={isActive ? '#0f766e' : '#475569'}
                            strokeWidth={2 * scale}
                            opacity={0.85}
                            className="cursor-grab active:cursor-grabbing"
                            data-handle-type="middle"
                            data-run-id={cRun.id}
                          />
                        );
                      }

                      // Side stringers (thin lines)
                      const stringers = [
                        <line
                          key={`stair-op-str-l-${seg.id}`}
                          x1={spX}
                          y1={spY}
                          x2={endSpX}
                          y2={endSpY}
                          stroke="#cbd5e1"
                          strokeWidth={1.5 * scale}
                          strokeDasharray="2,2"
                          className="cursor-grab active:cursor-grabbing"
                          data-handle-type="middle"
                          data-run-id={cRun.id}
                        />,
                        <line
                          key={`stair-op-str-r-${seg.id}`}
                          x1={epX}
                          y1={epY}
                          x2={endEpX}
                          y2={endEpY}
                          stroke="#cbd5e1"
                          strokeWidth={1.5 * scale}
                          strokeDasharray="2,2"
                          className="cursor-grab active:cursor-grabbing"
                          data-handle-type="middle"
                          data-run-id={cRun.id}
                        />
                      ];

                      // Side railings (matching regular railing line visual styling)
                      const railings = [];

                      const divisions = numRisers > 5 ? 2 : 1;

                      for (let div = 0; div < divisions; div++) {
                        const ratioStart = div / divisions;
                        const ratioEnd = (div + 1) / divisions;

                        // Side 1 (Left Stringer Side)
                        const sX1 = spX + (endSpX - spX) * ratioStart;
                        const sY1 = spY + (endSpY - spY) * ratioStart;
                        const sX2 = spX + (endSpX - spX) * ratioEnd;
                        const sY2 = spY + (endSpY - spY) * ratioEnd;

                        railings.push(
                          <g key={`stair-op-rail-l-grp-${seg.id}-${div}`}>
                            {isActive && (
                              <line
                                x1={sX1}
                                y1={sY1}
                                x2={sX2}
                                y2={sY2}
                                stroke="#ccfbf1" // light teal highlight glow
                                strokeWidth={7 * scale}
                                strokeLinecap="round"
                              />
                            )}
                            <line
                              key={`stair-op-rail-l-${seg.id}-${div}`}
                              x1={sX1}
                              y1={sY1}
                              x2={sX2}
                              y2={sY2}
                              stroke={cRun.style === 'glass' ? '#3b82f6' : '#000000'} // Blue if glass, solid bold black if pickets/unset
                              strokeWidth={3 * scale}
                              strokeLinecap="butt"
                              className="transition-all cursor-grab active:cursor-grabbing"
                              data-handle-type="middle"
                              data-run-id={cRun.id}
                            />
                          </g>
                        );

                        // Side 2 (Right Stringer Side - if sides is '2')
                        if (stairOpening.sides === '2') {
                          const eX1 = epX + (endEpX - epX) * ratioStart;
                          const eY1 = epY + (endEpY - epY) * ratioStart;
                          const eX2 = epX + (endEpX - epX) * ratioEnd;
                          const eY2 = epY + (endEpY - epY) * ratioEnd;

                          railings.push(
                            <g key={`stair-op-rail-r-grp-${seg.id}-${div}`}>
                              {isActive && (
                                <line
                                  x1={eX1}
                                  y1={eY1}
                                  x2={eX2}
                                  y2={eY2}
                                  stroke="#ccfbf1" // light teal highlight glow
                                  strokeWidth={7 * scale}
                                  strokeLinecap="round"
                                />
                              )}
                              <line
                                key={`stair-op-rail-r-${seg.id}-${div}`}
                                x1={eX1}
                                y1={eY1}
                                x2={eX2}
                                y2={eY2}
                                stroke={cRun.style === 'glass' ? '#3b82f6' : '#000000'} // Blue if glass, solid bold black if pickets/unset
                                strokeWidth={3 * scale}
                                strokeLinecap="butt"
                                className="transition-all cursor-grab active:cursor-grabbing"
                                data-handle-type="middle"
                                data-run-id={cRun.id}
                              />
                            </g>
                          );
                        }
                      }

                      // Dimension labels for side railings
                      const stairDiagInches = numRisers * Math.sqrt(193);
                      const stairDiagText = formatLength(stairDiagInches, isFeet);

                      const ux = Math.cos(seg.angle);
                      const uy = Math.sin(seg.angle);
                      const labelOffsetPx = 18 * scale;

                      const midX1 = (spX + endSpX) / 2;
                      const midY1 = (spY + endSpY) / 2;
                      const labelX1 = midX1 - ux * labelOffsetPx;
                      const labelY1 = midY1 - uy * labelOffsetPx;

                      const stairLabels = [
                        <g
                          key={`stair-op-label-l-${seg.id}`}
                          transform={`translate(${labelX1}, ${labelY1})`}
                          className="select-none pointer-events-none"
                        >
                          <rect
                            x={-41}
                            y={-13}
                            width={82}
                            height={26}
                            rx={6}
                            fill="#ffffff"
                            stroke={isActive ? '#0f766e' : '#cbd5e1'}
                            strokeWidth={isActive ? 1.5 : 1}
                            className="shadow-sm"
                          />
                          <text
                            textAnchor="middle"
                            dominantBaseline="central"
                            fill={isActive ? '#0f766e' : '#1e293b'}
                            fontSize={13}
                            fontWeight={isActive ? 'bold' : 'normal'}
                            fontFamily="sans-serif"
                          >
                            {stairDiagText}
                          </text>
                        </g>
                      ];

                      if (stairOpening.sides === '2') {
                        const midX2 = (epX + endEpX) / 2;
                        const midY2 = (epY + endEpY) / 2;
                        const labelX2 = midX2 + ux * labelOffsetPx;
                        const labelY2 = midY2 + uy * labelOffsetPx;

                        stairLabels.push(
                          <g
                            key={`stair-op-label-r-${seg.id}`}
                            transform={`translate(${labelX2}, ${labelY2})`}
                            className="select-none pointer-events-none"
                          >
                            <rect
                              x={-41}
                              y={-13}
                              width={82}
                              height={26}
                              rx={6}
                              fill="#ffffff"
                              stroke={isActive ? '#0f766e' : '#cbd5e1'}
                              strokeWidth={isActive ? 1.5 : 1}
                              className="shadow-sm"
                            />
                            <text
                              textAnchor="middle"
                              dominantBaseline="central"
                              fill={isActive ? '#0f766e' : '#1e293b'}
                              fontSize={13}
                              fontWeight={isActive ? 'bold' : 'normal'}
                              fontFamily="sans-serif"
                            >
                              {stairDiagText}
                            </text>
                          </g>
                        );
                      }

                      return (
                        <g key={`stair-opening-group-${seg.id}`}>
                          {stringers}
                          {treads}
                          {railings}
                          {stairLabels}
                        </g>
                      );
                    }

                    // Otherwise, it's a regular segment: draw the black handrail line!
                    return (
                      <g key={`seg-visual-${seg.id}`}>
                        {isActive && (
                          <line
                            x1={spX}
                            y1={spY}
                            x2={epX}
                            y2={epY}
                            stroke="#ccfbf1" // light teal highlight glow
                            strokeWidth={7 * scale}
                            strokeLinecap="round"
                          />
                        )}
                        <line
                          x1={spX}
                          y1={spY}
                          x2={epX}
                          y2={epY}
                          stroke={cRun.style === 'glass' ? '#3b82f6' : '#000000'} // Blue if glass, solid bold black if pickets/unset
                          strokeWidth={3 * scale}
                          strokeLinecap="butt"
                          className="transition-all cursor-grab active:cursor-grabbing"
                          data-handle-type="middle"
                          data-run-id={cRun.id}
                        />
                      </g>
                    );
                  })}

                  {/* Stairway treads overlay & architectural UP arrow */}
                  {cRun.isStair && (() => {
                    const numSteps = cRun.stairStepsCount ?? 6;
                    const treads = [];
                    const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
                    const perpAngle = angle + Math.PI / 2;
                    const cosPerp = Math.cos(perpAngle);
                    const sinPerp = Math.sin(perpAngle);

                    // 1. Draw Step Treads
                    for (let k = 1; k < numSteps; k++) {
                      const ratio = k / numSteps;
                      const sx = p1.x + (p2.x - p1.x) * ratio;
                      const sy = p1.y + (p2.y - p1.y) * ratio;
                      const treadW = 10 * scale;

                      treads.push(
                        <line
                          key={`tread-${k}`}
                          x1={(sx * scale) + treadW * cosPerp}
                          y1={(sy * scale) + treadW * sinPerp}
                          x2={(sx * scale) - treadW * cosPerp}
                          y2={(sy * scale) - treadW * sinPerp}
                          stroke={isActive ? '#0f766e' : '#64748b'}
                          strokeWidth={2 * scale}
                          opacity={0.8}
                        />
                      );
                    }

                    // 2. Draw "UP" direction arrow
                    const bottomIsStart = cRun.stairBottomIsStart ?? true;
                    const arrowStart = bottomIsStart ? p1 : p2;
                    const arrowEnd = bottomIsStart ? p2 : p1;

                    const arrowAngle = Math.atan2(arrowEnd.y - arrowStart.y, arrowEnd.x - arrowStart.x);
                    let arrowAngleDeg = (arrowAngle * 180) / Math.PI;
                    if (arrowAngleDeg > 90) {
                      arrowAngleDeg -= 180;
                    } else if (arrowAngleDeg < -90) {
                      arrowAngleDeg += 180;
                    }
                    const labelOffsetVal = 14 * scale;

                    // Arrow line offset parallel to the main line
                    const pOffset = 18 * scale;
                    const asX = arrowStart.x * scale + pOffset * cosPerp;
                    const asY = arrowStart.y * scale + pOffset * sinPerp;
                    const aeX = arrowEnd.x * scale + pOffset * cosPerp;
                    const aeY = arrowEnd.y * scale + pOffset * sinPerp;

                    // Arrowhead coords
                    const ah1X = aeX - 6 * scale * Math.cos(arrowAngle - Math.PI / 6);
                    const ah1Y = aeY - 6 * scale * Math.sin(arrowAngle - Math.PI / 6);
                    const ah2X = aeX - 6 * scale * Math.cos(arrowAngle + Math.PI / 6);
                    const ah2Y = aeY - 6 * scale * Math.sin(arrowAngle + Math.PI / 6);

                    return (
                      <g key={`stair-overlay-${cRun.id}`}>
                        {treads}
                        {/* Dotted Arrow Line */}
                        <line
                          x1={asX}
                          y1={asY}
                          x2={aeX}
                          y2={aeY}
                          stroke="#0f766e"
                          strokeWidth={1.5 * scale}
                          strokeDasharray="4,4"
                        />
                        {/* Arrowhead */}
                        <polygon
                          points={`${aeX},${aeY} ${ah1X},${ah1Y} ${ah2X},${ah2Y}`}
                          fill="#0f766e"
                        />
                        {/* Label UP */}
                        <text
                          x={(asX + aeX) / 2}
                          y={(asY + aeY) / 2 - 4 * scale}
                          fill="#0f766e"
                          fontSize={9 * scale}
                          fontWeight="bold"
                          textAnchor="middle"
                          transform={`rotate(${arrowAngleDeg}, ${(asX + aeX) / 2}, ${(asY + aeY) / 2 - 4 * scale})`}
                        >
                          UP
                        </text>
                      </g>
                    );
                  })()}

                  {/* 4. Elegant architectural dimension markers & label */}
                  {!cRun.isHouseWall && cRun.segments?.map((seg) => {
                    if (seg.isStairOpening) {
                      return null;
                    }
                    if (!seg.posts || seg.posts.length < 2) {
                      return null;
                    }

                    const sp = seg.posts[0];
                    const ep = seg.posts[seg.posts.length - 1];
                    const segmentLength = seg.length;

                    // Compute label position with side selection by clearance
                    const dxLogical = ep.x - sp.x;
                    const dyLogical = ep.y - sp.y;
                    const segmentAngle = Math.atan2(dyLogical, dxLogical);

                    const labelT = 0.5;

                    const labelBaseX = sp.x + labelT * dxLogical;
                    const labelBaseY = sp.y + labelT * dyLogical;

                    const perpX = Math.cos(segmentAngle + Math.PI / 2);
                    const perpY = Math.sin(segmentAngle + Math.PI / 2);

                    // Compute half-extent in logical units
                    // halfExtentPixels = |perpX| * pillWidth/2 + |perpY| * pillHeight/2
                    const halfExtentPixels = Math.abs(perpX) * 41 + Math.abs(perpY) * 13;
                    const minOffsetPixels = halfExtentPixels + 8;
                    const minOffsetInches = minOffsetPixels / scale;

                    const opt = computeOptimalLabelOffset(labelBaseX, labelBaseY, perpX, perpY, minOffsetInches, cRun.id);
                    const lx = opt.x * scale;
                    const ly = opt.y * scale;

                    let dimAngleDeg = (segmentAngle * 180) / Math.PI;
                    if (dimAngleDeg > 90) {
                      dimAngleDeg -= 180;
                    } else if (dimAngleDeg < -90) {
                      dimAngleDeg += 180;
                    }

                    return (
                      <g
                        key={`dim-label-group-${seg.id}`}
                        transform={`translate(${lx}, ${ly})`}
                        className="cursor-grab active:cursor-grabbing select-none"
                        data-handle-type="middle"
                        data-run-id={cRun.id}
                      >
                        {/* Clean white backdrop block */}
                        <rect
                          x={-41}
                          y={-13}
                          width={82}
                          height={26}
                          rx={6}
                          fill="#ffffff"
                          stroke={isActive ? '#0f766e' : '#cbd5e1'}
                          strokeWidth={isActive ? 1.5 : 1}
                          className="shadow-sm"
                          data-handle-type="middle"
                          data-run-id={cRun.id}
                        />
                        <text
                          x={0}
                          y={0}
                          textAnchor="middle"
                          dominantBaseline="central"
                          fill={isActive ? '#0f766e' : '#1e293b'}
                          fontSize={13}
                          fontWeight={isActive ? 'bold' : 'normal'}
                          fontFamily="sans-serif"
                          data-handle-type="middle"
                          data-run-id={cRun.id}
                        >
                          {formatLength(segmentLength, isFeet)}
                        </text>
                      </g>
                    );
                  })}

                  {/* 5. Start Post invisible interactive drag handle */}
                  {isActive && toolMode === 'select' && (
                    <g transform={`translate(${p1.x * scale}, ${p1.y * scale})`}>
                      {/* Highly visible, premium CAD resize handle */}
                      <circle
                        cx={0}
                        cy={0}
                        r={14}
                        fill="#ffffff"
                        stroke="#0f766e"
                        strokeWidth={3}
                        className="pointer-events-none"
                        style={{ filter: 'drop-shadow(0px 2px 6px rgba(15, 23, 42, 0.25))' }}
                      />
                      <circle
                        cx={0}
                        cy={0}
                        r={5.5}
                        fill="#0f766e"
                        className="pointer-events-none"
                      />
                      {/* Glowing outer dashed ring */}
                      <circle
                        cx={0}
                        cy={0}
                        r={Math.max(20, 20 * scale)}
                        fill="none"
                        stroke="#0d9488"
                        strokeWidth={2}
                        strokeDasharray="4 3"
                        className="pointer-events-none opacity-90 animate-pulse"
                      />
                      {/* Extra large invisible interactive grab area for effortless touch/mouse click target */}
                      <circle
                        cx={0}
                        cy={0}
                        r={endpointHitRadius}
                        fill="transparent"
                        className="cursor-pointer"
                        data-handle-type="start"
                        data-run-id={cRun.id}
                        style={{ pointerEvents: 'all' }}
                      >
                        <title>Drag START endpoint to adjust, rotate, extend or attach</title>
                      </circle>
                    </g>
                  )}

                  {/* 6. End Post invisible interactive drag handle */}
                  {isActive && toolMode === 'select' && (
                    <g transform={`translate(${p2.x * scale}, ${p2.y * scale})`}>
                      {/* Highly visible, premium CAD resize handle */}
                      <circle
                        cx={0}
                        cy={0}
                        r={14}
                        fill="#ffffff"
                        stroke="#0f766e"
                        strokeWidth={3}
                        className="pointer-events-none"
                        style={{ filter: 'drop-shadow(0px 2px 6px rgba(15, 23, 42, 0.25))' }}
                      />
                      <circle
                        cx={0}
                        cy={0}
                        r={5.5}
                        fill="#0f766e"
                        className="pointer-events-none"
                      />
                      {/* Glowing outer dashed ring */}
                      <circle
                        cx={0}
                        cy={0}
                        r={Math.max(20, 20 * scale)}
                        fill="none"
                        stroke="#0d9488"
                        strokeWidth={2}
                        strokeDasharray="4 3"
                        className="pointer-events-none opacity-90 animate-pulse"
                      />
                      {/* Extra large invisible interactive grab area for effortless touch/mouse click target */}
                      <circle
                        cx={0}
                        cy={0}
                        r={endpointHitRadius}
                        fill="transparent"
                        className="cursor-pointer"
                        data-handle-type="end"
                        data-run-id={cRun.id}
                        style={{ pointerEvents: 'all' }}
                      >
                        <title>Drag END endpoint to adjust, rotate, extend or attach</title>
                      </circle>
                    </g>
                  )}
                </g>
              );
            });
          })()}

            {/* Pass 3 — draw every run's post markers */}
            {calculatedRuns.map((cRun) => {
              if (cRun.isHouseWall) return null;
              const isActive = cRun.id === activeRunId;
              return (
                <g key={`${cRun.id}-posts`} className="pointer-events-none">
                  {cRun.posts.filter(p => !p.isDuplicate).map((post, postIdx) => {
                    const postSize = POST_MARKER_PX;
                    const isContinuousBracket = post.id.includes('midpoint');

                    if (isContinuousBracket) {
                      return (
                        <g key={post.id} transform={`translate(${post.x * scale}, ${post.y * scale})`}>
                          <rect
                            x={-postSize / 2}
                            y={-postSize / 2}
                            width={postSize}
                            height={postSize}
                            fill="#ec4899" // pink square (mid-stair post)
                            stroke="#22c55e" // green outline = continuous bracket
                            strokeWidth={isActive ? 2.5 : 2}
                            rx={2}
                            className="transition-all"
                          />
                        </g>
                      );
                    }

                    const isStartColumnBracket = postIdx === 0 && cRun.startIsColumn;
                    const isEndColumnBracket = postIdx === cRun.posts.length - 1 && cRun.endIsColumn;
                    const isColumnBracket = isStartColumnBracket || isEndColumnBracket || post.isColumn;

                    let fillColor = '#000000'; // Default is end/start (black)
                    let strokeColor = isActive ? '#0f766e' : '#ffffff';
                    let renderX = post.x;
                    let renderY = post.y;

                    if (isColumnBracket) {
                      fillColor = '#ea580c'; // Vibrant orange bracket square (same shape & dimension as end/line post)
                      strokeColor = isActive ? '#9a3412' : '#c2410c';
                    } else if (post.type === 'corner') {
                      fillColor = '#2563eb'; // blue
                      strokeColor = '#3b82f6';
                    } else if (post.type === 'angle') {
                      fillColor = '#f97316'; // orange
                      strokeColor = isActive ? '#c2410c' : '#ea580c';
                    } else if (post.type === 'line') {
                      fillColor = '#22c55e'; // green
                    } else if (post.type === 'stair') {
                      fillColor = '#ec4899'; // pink
                      strokeColor = isActive ? '#db2777' : '#ffffff';
                    } else if (post.type === 'start' || post.type === 'end') {
                      fillColor = '#000000'; // black
                    }

                    return (
                      <g key={post.id} transform={`translate(${renderX * scale}, ${renderY * scale})`}>
                        <rect
                          x={-postSize / 2}
                          y={-postSize / 2}
                          width={postSize}
                          height={postSize}
                          fill={fillColor}
                          stroke={strokeColor}
                          strokeWidth={isActive ? 2 : 1.5}
                          rx={2}
                          className="transition-all"
                        />
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </g>
        </svg>

        {/* Clean floating informational HUD badge */}
        {!readOnly && (
          <div className="absolute top-4 right-4 bg-white/95 border border-slate-200 rounded-xl px-4 py-3 shadow-md flex items-center gap-4 z-10 backdrop-blur-sm">
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Total Railing Length</span>
              <span className="text-base font-bold tracking-tight text-slate-900 mt-0.5">
                {formatLength(totalInchesAll, isFeet)}
              </span>
            </div>
            <div className="w-[1px] h-8 bg-slate-250"></div>
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Total Posts Count</span>
              <span className="text-base font-bold tracking-tight text-slate-900 mt-0.5 flex items-center gap-1">
                {totalPostsAll} <span className="text-xs font-normal text-slate-500">pcs</span>
              </span>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
