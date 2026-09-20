/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Point, RailingOptions, GeneratedPost, RailSegment, BOMItem, PostType, SystemColor, HandrailStyle, StairOpening, StairDirection, RailingRun, RailingStyle } from '../types';

// Helper to calculate distance between two points
export function getDistance(p1: { x: number; y: number }, p2: { x: number; y: number }): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculates the exact exit point on the boundary/edge of a column shape
 * in the direction of `otherPt` (i.e. where the approaching run meets the column edge).
 */
export function getColumnEdgePoint(
  column: { x: number; y: number; width: number; height: number; type: string },
  otherPt: { x: number; y: number }
): { x: number; y: number } {
  const dx = otherPt.x - column.x;
  const dy = otherPt.y - column.y;
  const len = Math.hypot(dx, dy);

  if (len < 0.0001) {
    const half = (column.width || 24) / 2;
    return { x: column.x + half, y: column.y };
  }

  if (column.type === 'circular_column') {
    const radius = (column.width || 24) / 2;
    return {
      x: column.x + (dx / len) * radius,
      y: column.y + (dy / len) * radius,
    };
  } else {
    // Square or rectangular column
    const halfWidth = (column.width || 24) / 2;
    const halfHeight = (column.height || 24) / 2;
    const maxRatio = Math.max(Math.abs(dx) / halfWidth, Math.abs(dy) / halfHeight);
    if (maxRatio < 0.0001) {
      return { x: column.x + halfWidth, y: column.y };
    }
    const factor = 1 / maxRatio;
    return {
      x: column.x + dx * factor,
      y: column.y + dy * factor,
    };
  }
}

// Helper to project a point onto a line segment
export function projectPointOnSegment(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number } {
  const abX = b.x - a.x;
  const abY = b.y - a.y;
  const abLenSq = abX * abX + abY * abY;
  if (abLenSq === 0) return { ...a };
  
  let t = ((p.x - a.x) * abX + (p.y - a.y) * abY) / abLenSq;
  t = Math.max(0, Math.min(1, t));
  
  return {
    x: a.x + t * abX,
    y: a.y + t * abY,
  };
}

// Format length nicely based on preference
export function formatLength(inches: number, useFeet: boolean): string {
  if (useFeet) {
    const totalInches = Math.round(inches);
    const ft = Math.floor(totalInches / 12);
    const inch = totalInches % 12;
    if (ft === 0) return `${inch}"`;
    if (inch === 0) return `${ft}'`;
    return `${ft}' ${inch}"`;
  }
  return `${Math.round(inches * 10) / 10}"`;
}

// Generate the posts and segments along the path
export function calculateRailing(
  points: Point[],
  options: RailingOptions,
  isStair?: boolean,
  stairStepsCount: number = 6,
  stairBottomIsStart: boolean = true,
  stairOpening?: StairOpening,
  allRuns: RailingRun[] = [],
  isHouseWall?: boolean
): {
  posts: GeneratedPost[];
  segments: RailSegment[];
  totalLength: number; // in inches
} {
  if (points.length < 2) {
    return { posts: [], segments: [], totalLength: 0 };
  }

  if (isHouseWall) {
    const totalLength = getDistance(points[0], points[1]);
    return { posts: [], segments: [], totalLength };
  }

  const parentRun = allRuns.find((r) =>
    r.points.length === points.length &&
    r.points.every((p, idx) => Math.abs(p.x - points[idx].x) < 0.1 && Math.abs(p.y - points[idx].y) < 0.1)
  );

  // Collect all top of stairs coordinates in the layout to ensure they are strictly classified as end posts
  const topOfStairsPoints: { x: number; y: number }[] = [];
  allRuns.forEach((r) => {
    if (r.stairOpening && r.stairOpening.enabled) {
      const pStart = r.points[0];
      const pEnd = r.points[1];
      const angle = Math.atan2(pEnd.y - pStart.y, pEnd.x - pStart.x);
      const ux = Math.cos(angle);
      const uy = Math.sin(angle);
      const leftOffsetInches = r.stairOpening.leftOffset * 12;
      const openingWidthInches = r.stairOpening.openingWidth * 12;

      topOfStairsPoints.push({
        x: pStart.x + ux * leftOffsetInches,
        y: pStart.y + uy * leftOffsetInches,
      });
      topOfStairsPoints.push({
        x: pStart.x + ux * (leftOffsetInches + openingWidthInches),
        y: pStart.y + uy * (leftOffsetInches + openingWidthInches),
      });
    }
  });

  // We will build a list of "segments" (either normal ones or the split ones from stair opening)
  const segments: RailSegment[] = [];
  let totalLength = 0;

  // Let's first split the path into actual physical sub-segments
  // Normally, a path has segments between points[i] and points[i+1]
  // But if points.length === 2 and we have an enabled stairOpening, we split it into 2 or 3 sub-segments!
  interface PhysicalSegment {
    pStart: Point;
    pEnd: Point;
    isStair: boolean;
    isStairOpening: boolean;
    stairOpening?: StairOpening;
  }

  const physicalSegments: PhysicalSegment[] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const pStart = points[i];
    const pEnd = points[i + 1];

    // Check if this particular straight run has a stair opening
    const hasStairOpening = stairOpening && stairOpening.enabled && points.length === 2 && i === 0;

    if (hasStairOpening) {
      const segLength = getDistance(pStart, pEnd);
      const angle = Math.atan2(pEnd.y - pStart.y, pEnd.x - pStart.x);
      const ux = Math.cos(angle);
      const uy = Math.sin(angle);

      const leftOffsetInches = stairOpening.leftOffset * 12;
      const openingWidthInches = stairOpening.openingWidth * 12;

      // 1. Before opening segment
      if (leftOffsetInches > 0.01) {
        const pOpStart = {
          id: `opening-start-vertex`,
          x: pStart.x + ux * leftOffsetInches,
          y: pStart.y + uy * leftOffsetInches,
        };
        physicalSegments.push({
          pStart,
          pEnd: pOpStart,
          isStair: false,
          isStairOpening: false,
        });
      }

      // 2. Opening segment
      const oStart = physicalSegments.length > 0 ? physicalSegments[physicalSegments.length - 1].pEnd : pStart;
      const pOpEnd = {
        id: `opening-end-vertex`,
        x: pStart.x + ux * (leftOffsetInches + openingWidthInches),
        y: pStart.y + uy * (leftOffsetInches + openingWidthInches),
      };
      physicalSegments.push({
        pStart: oStart,
        pEnd: pOpEnd,
        isStair: false,
        isStairOpening: true,
        stairOpening,
      });

      // 3. After opening segment
      const remainingInches = segLength - (leftOffsetInches + openingWidthInches);
      if (remainingInches > 0.01) {
        physicalSegments.push({
          pStart: pOpEnd,
          pEnd,
          isStair: false,
          isStairOpening: false,
        });
      }
    } else {
      // Regular segment
      physicalSegments.push({
        pStart,
        pEnd,
        isStair: !!isStair,
        isStairOpening: false,
      });
    }
  }

  // Now, we can process each physical segment exactly like before, but with its own start, end and type!
  // Let's generate posts at all the transition vertices first:
  const vertexPoints: Point[] = [];
  if (physicalSegments.length > 0) {
    vertexPoints.push(physicalSegments[0].pStart);
    for (const ps of physicalSegments) {
      vertexPoints.push(ps.pEnd);
    }
  }

  const totalRise = isStair ? (stairStepsCount + 1) * 7 : 0;

  const hasCurrentStairOpening = !!(stairOpening && stairOpening.enabled && points.length === 2);
  const pRunStart = points[0];
  const pRunEnd = points[points.length - 1];
  const runLength = getDistance(pRunStart, pRunEnd);
  const runAngle = Math.atan2(pRunEnd.y - pRunStart.y, pRunEnd.x - pRunStart.x);
  const runUx = Math.cos(runAngle);
  const runUy = Math.sin(runAngle);

  const leftOffsetInches = hasCurrentStairOpening ? stairOpening.leftOffset * 12 : 0;
  const openingWidthInches = hasCurrentStairOpening ? stairOpening.openingWidth * 12 : 0;
  const remainingInches = hasCurrentStairOpening ? runLength - (leftOffsetInches + openingWidthInches) : 0;

  const startBorderPt = hasCurrentStairOpening ? {
    x: pRunStart.x + runUx * leftOffsetInches,
    y: pRunStart.y + runUy * leftOffsetInches,
  } : null;

  const endBorderPt = hasCurrentStairOpening ? {
    x: pRunStart.x + runUx * (leftOffsetInches + openingWidthInches),
    y: pRunStart.y + runUy * (leftOffsetInches + openingWidthInches),
  } : null;

  const isAnotherRunEndpoint = (pt: { x: number; y: number }): boolean => {
    return allRuns.some((r) => {
      const isSameRun =
        r.points.length === points.length &&
        r.points.every((p, idx) => Math.abs(p.x - points[idx].x) < 0.1 && Math.abs(p.y - points[idx].y) < 0.1);
      if (isSameRun) return false;

      return r.points.some((p) => Math.hypot(p.x - pt.x, p.y - pt.y) < 1.0);
    });
  };

  const vertexPosts: GeneratedPost[] = vertexPoints.map((pt, index) => {
    let type: PostType = 'line';
    let isExcluded = false;

    const isStartBorder = hasCurrentStairOpening && startBorderPt && Math.hypot(pt.x - startBorderPt.x, pt.y - startBorderPt.y) < 0.1;
    const isEndBorder = hasCurrentStairOpening && endBorderPt && Math.hypot(pt.x - endBorderPt.x, pt.y - endBorderPt.y) < 0.1;

    if (isStartBorder) {
      if (leftOffsetInches >= 0.5 || isAnotherRunEndpoint(pt)) {
        type = 'end';
      } else {
        type = 'stair';
      }
    } else if (isEndBorder) {
      if (remainingInches >= 0.5 || isAnotherRunEndpoint(pt)) {
        type = 'end';
      } else if (stairOpening!.sides === '2') {
        type = 'stair';
      } else {
        type = 'end';
        isExcluded = true;
      }
    } else {
      if (index === 0) {
        type = isStair ? (stairBottomIsStart ? 'stair' : 'end') : 'start';
      } else if (index === vertexPoints.length - 1) {
        type = isStair ? (stairBottomIsStart ? 'end' : 'stair') : 'end';
      } else {
        type = 'corner';
      }

      // Force post to End Post if it coincides with the top of stairs coordinates of any run
      const isTopOfStairs = topOfStairsPoints.some(
        (tsPt) => Math.abs(tsPt.x - pt.x) < 0.1 && Math.abs(tsPt.y - pt.y) < 0.1
      );
      if (isTopOfStairs) {
        type = 'end';
      }
    }

    let z = 0;
    if (isStair) {
      if (index === 0) {
        z = stairBottomIsStart ? 0 : totalRise;
      } else if (index === vertexPoints.length - 1) {
        z = stairBottomIsStart ? totalRise : 0;
      }
    }

    return {
      id: `post-vertex-${index}-${pt.id}`,
      x: pt.x,
      y: pt.y,
      z,
      type,
      segmentIndex: index === 0 ? 0 : index - 1,
      isExcluded,
    };
  });

  // Process each physical segment
  for (let i = 0; i < physicalSegments.length; i++) {
    const ps = physicalSegments[i];
    const segLength = getDistance(ps.pStart, ps.pEnd);
    totalLength += segLength;

    const angle = Math.atan2(ps.pEnd.y - ps.pStart.y, ps.pEnd.x - ps.pStart.x);
    const dx = ps.pEnd.x - ps.pStart.x;
    const dy = ps.pEnd.y - ps.pStart.y;

    const startPost = vertexPosts[i];
    const endPost = vertexPosts[i + 1];

    const segPosts: GeneratedPost[] = [startPost];

    // Spacing for intermediate posts on this segment
    // If it is a stair opening itself, we do NOT want any intermediate line posts! It is completely open!
    if (!ps.isStairOpening) {
      const effectiveRunStyle = parentRun?.style || options.style || 'pickets';
      const spacingCapForThisRun = (effectiveRunStyle === 'glass') ? 60 : options.maxPostSpacing;
      const effectiveSegLength = ps.isStair ? ((stairStepsCount ?? 6) * Math.sqrt(193)) : segLength;
      const numSpans = Math.ceil(effectiveSegLength / spacingCapForThisRun);

      if (numSpans > 1) {
        for (let k = 1; k < numSpans; k++) {
          const ratio = k / numSpans;
          const ix = ps.pStart.x + dx * ratio;
          const iy = ps.pStart.y + dy * ratio;

          let iz = 0;
          if (ps.isStair) {
            iz = stairBottomIsStart ? ratio * totalRise : (1 - ratio) * totalRise;
          }

          segPosts.push({
            id: `post-line-${i}-${k}`,
            x: ix,
            y: iy,
            z: iz,
            type: 'line',
            segmentIndex: i,
          });
        }
      }
    }

    segPosts.push(endPost);

    segments.push({
      id: `segment-${i}`,
      startIndex: i, // index of start post in vertexPosts
      endIndex: i + 1, // index of end post in vertexPosts
      length: segLength,
      angle,
      posts: segPosts,
      isStair: ps.isStair,
      stairStepsCount: ps.isStair ? stairStepsCount : undefined,
      stairBottomIsStart: ps.isStair ? stairBottomIsStart : undefined,
      isStairOpening: ps.isStairOpening,
      stairOpening: ps.stairOpening,
      parentRunStyle: (parentRun?.style || (options.style === 'glass' ? 'glass' : 'pickets')) as 'pickets' | 'glass',
    });
  }

  // Flatten all posts in layout order without duplicates
  const allPosts: GeneratedPost[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    for (let j = 0; j < seg.posts.length - 1; j++) {
      if (!seg.posts[j].isExcluded) {
        allPosts.push(seg.posts[j]);
      }
    }
    if (i === segments.length - 1) {
      const lastPost = seg.posts[seg.posts.length - 1];
      if (!lastPost.isExcluded) {
        allPosts.push(lastPost);
      }
    }
  }

  // Append stair opening bottom posts to the flat list of all posts
  segments.forEach((seg, i) => {
    if (seg.isStairOpening && seg.stairOpening) {
      const stairOpening = seg.stairOpening;
      const numRisers = stairOpening.risers;
      const stairRunInches = numRisers * 12;
      const totalRise = (numRisers + 1) * 7;

      const ux = Math.cos(seg.angle);
      const uy = Math.sin(seg.angle);
      const dir = stairOpening.direction;
      const projVec = (dir === StairDirection.UP || dir === StairDirection.LEFT)
        ? { x: uy, y: -ux }
        : { x: -uy, y: ux };

      const p1 = seg.posts[0];
      const p2 = seg.posts[seg.posts.length - 1];

      // Always render side 1; render side 2 if sides is '2'
      const sidesToRender = stairOpening.sides === '2' ? [1, 2] : [1];

      sidesToRender.forEach((side) => {
        const basePt = side === 1 ? p1 : p2;
        const postX = basePt.x + projVec.x * stairRunInches;
        const postY = basePt.y + projVec.y * stairRunInches;
        const postZ = -totalRise;

        allPosts.push({
          id: `post-stair-bottom-${seg.id}-${side}`,
          x: postX,
          y: postY,
          z: postZ,
          type: 'stair',
          segmentIndex: i,
        });

        // Insert intermediate mid-stair posts (continuous brackets): a new
        // post every time the flight exceeds another 5 risers, evenly
        // spaced, so no section has more than 5 risers
        const stairRailInches = numRisers * Math.sqrt(193);
        const numStairSpans = seg.parentRunStyle === 'glass'
          ? Math.max(1, Math.ceil(stairRailInches / 60))
          : Math.max(1, Math.ceil(numRisers / 5));
        const numMidPosts = numStairSpans - 1;
        for (let m = 1; m <= numMidPosts; m++) {
          const ratio = m / (numMidPosts + 1);
          const midX = basePt.x + projVec.x * (stairRunInches * ratio);
          const midY = basePt.y + projVec.y * (stairRunInches * ratio);
          const midZ = -totalRise * ratio;

          allPosts.push({
            id: `post-stair-midpoint-${seg.id}-${side}-${m}`,
            x: midX,
            y: midY,
            z: midZ,
            type: 'stair',
            segmentIndex: i,
          });
        }
      });
    }
  });

  return {
    posts: allPosts,
    segments,
    totalLength,
  };
}

// Generate the Bill of Materials (BOM) based on calculation results
export function generateBOM(
  posts: GeneratedPost[],
  segments: RailSegment[],
  totalLengthInches: number,
  options: RailingOptions,
  runs: RailingRun[] = []
): BOMItem[] {
  if (runs.length === 0 && posts.length === 0 && segments.length === 0) {
    return [];
  }

  const items: BOMItem[] = [];
  const displayColor = options.systemColor;

  if (options.style === 'pickets' || options.style === 'glass' || segments.some((s) => s.parentRunStyle === 'glass')) {
    // Helper to check if a post is at a run endpoint that is attached to a column
    const isRunEndpointColumn = (post: GeneratedPost) => {
      return runs.some((r) => {
        if (r.isHouseWall) return false;
        if (r.startIsColumn) {
          const startPt = r.points[0];
          if (startPt && Math.abs(post.x - startPt.x) < 1.0 && Math.abs(post.y - startPt.y) < 1.0) {
            return true;
          }
        }
        if (r.endIsColumn) {
          const endPt = r.points[r.points.length - 1];
          if (endPt && Math.abs(post.x - endPt.x) < 1.0 && Math.abs(post.y - endPt.y) < 1.0) {
            return true;
          }
        }
        return false;
      });
    };

    // 1. Count posts by type and track column bracket conversions
    let endPosts = 0;
    let linePosts = 0;
    let cornerPosts = 0;
    let stairPosts = 0;
    let totalColumnBracketSets = 0;

    posts.forEach((post) => {
      const isConverted = !!post.isColumn || isRunEndpointColumn(post);
      if (post.isDuplicate && !isConverted) return;
      if (isConverted) {
        totalColumnBracketSets++;
      } else if (post.type === 'start' || post.type === 'end') {
        endPosts++;
      } else if (post.type === 'stair') {
        stairPosts++;
      } else if (post.type === 'corner' || post.type === 'angle') {
        cornerPosts++;
      } else {
        linePosts++;
      }
    });

    const totalPosts = posts.length > 0 ? (endPosts + linePosts + cornerPosts + stairPosts) : 0;

    // Add Posts
    if (endPosts > 0) {
      items.push({
        id: 'bom-post-end',
        name: `End Post - ${displayColor}`,
        category: 'posts',
        quantity: endPosts,
        unit: 'pcs',
        unitPrice: 51.81,
        description: `Heavy duty terminal end post (${options.height}" height) for start/end points.`,
      });
    }

    if (linePosts > 0) {
      items.push({
        id: 'bom-post-line',
        name: `Line Post - ${displayColor}`,
        category: 'posts',
        quantity: linePosts,
        unit: 'pcs',
        unitPrice: 51.81,
        description: `Intermediate support post (${options.height}" height) spaced along straight runs.`,
      });
    }

    if (cornerPosts > 0) {
      items.push({
        id: 'bom-post-corner',
        name: `Corner Post - ${displayColor}`,
        category: 'posts',
        quantity: cornerPosts,
        unit: 'pcs',
        unitPrice: 51.81,
        description: `Corner or angle post (${options.height}" height) for directional run transitions.`,
      });
    }

    if (stairPosts > 0) {
      items.push({
        id: 'bom-post-stair',
        name: `Stair Post - ${displayColor}`,
        category: 'posts',
        quantity: stairPosts,
        unit: 'pcs',
        unitPrice: 51.81,
        description: 'Heavy duty stair post for stair railing installations.',
      });
    }

    // Compute billable length in inches excluding stair opening spans and stair runs for flat runs
    const levelBillableLengthInches = segments
      .filter(seg => !seg.isStairOpening && !seg.isStair)
      .reduce((sum, seg) => sum + seg.length, 0);

    const picketLevelBillableLengthInches = segments
      .filter(seg => !seg.isStairOpening && !seg.isStair && seg.parentRunStyle !== 'glass')
      .reduce((sum, seg) => sum + seg.length, 0);

    const glassLevelInches = segments
      .filter(seg => !seg.isStairOpening && !seg.isStair && seg.parentRunStyle === 'glass')
      .reduce((sum, seg) => sum + seg.length, 0);

    // Calculate stair billable length (diagonal railing length per side)
    let totalStairLengthInches = 0;
    let picketStairLengthInches = 0;
    let glassStairInches = 0;

    segments.forEach((seg) => {
      const isGlass = seg.parentRunStyle === 'glass';
      if (seg.isStairOpening && seg.stairOpening) {
        const steps = seg.stairOpening.risers;
        const numSides = seg.stairOpening.sides === '2' ? 2 : 1;
        const stairRailLF = (steps * Math.sqrt(193)) / 12;
        const segStairInches = stairRailLF * numSides * 12;
        totalStairLengthInches += segStairInches;
        if (isGlass) {
          glassStairInches += segStairInches;
        } else {
          picketStairLengthInches += segStairInches;
        }
      } else if (seg.isStair) {
        const steps = seg.stairStepsCount ?? 6;
        const stairRailLF = (steps * Math.sqrt(193)) / 12;
        const segStairInches = stairRailLF * 12;
        totalStairLengthInches += segStairInches;
        if (isGlass) {
          glassStairInches += segStairInches;
        } else {
          picketStairLengthInches += segStairInches;
        }
      }
    });

    let glassSpanCount = 0;
    segments.forEach((seg) => {
      if (seg.parentRunStyle === 'glass') {
        if (seg.isStairOpening && seg.stairOpening) {
          const steps = seg.stairOpening.risers;
          const numSides = seg.stairOpening.sides === '2' ? 2 : 1;
          const stairRailInches = steps * Math.sqrt(193);
          const stairSpansPerSide = Math.max(1, Math.ceil(stairRailInches / 60));
          glassSpanCount += stairSpansPerSide * numSides;
        } else if (seg.isStair) {
          const steps = seg.stairStepsCount ?? 6;
          const stairRailInches = steps * Math.sqrt(193);
          const stairSpansPerSide = Math.max(1, Math.ceil(stairRailInches / 60));
          glassSpanCount += stairSpansPerSide;
        } else {
          glassSpanCount += Math.max(0, seg.posts.length - 1);
        }
      }
    });

    const billableLengthInches = levelBillableLengthInches + totalStairLengthInches;
    const picketBillableLengthInches = picketLevelBillableLengthInches + picketStairLengthInches;

    const glassLevelFootage = Number((glassLevelInches / 12).toFixed(2));
    const glassStairFootage = Number((glassStairInches / 12).toFixed(2));

    let glassChannelBundles = 0;
    segments.forEach((seg) => {
      if (seg.parentRunStyle === 'glass') {
        let spanCount = 0;
        let spanLength = 0;

        if (seg.isStairOpening && seg.stairOpening) {
          const steps = seg.stairOpening.risers;
          const numSides = seg.stairOpening.sides === '2' ? 2 : 1;
          const stairRailInches = steps * Math.sqrt(193);
          const stairSpansPerSide = Math.max(1, Math.ceil(stairRailInches / 60));
          spanCount = stairSpansPerSide * numSides;
          spanLength = stairRailInches / stairSpansPerSide;
        } else if (seg.isStair) {
          const steps = seg.stairStepsCount ?? 6;
          const stairRailInches = steps * Math.sqrt(193);
          const stairSpansPerSide = Math.max(1, Math.ceil(stairRailInches / 60));
          spanCount = stairSpansPerSide;
          spanLength = stairRailInches / stairSpansPerSide;
        } else {
          spanCount = Math.max(0, seg.posts.length - 1);
          if (spanCount > 0) {
            spanLength = seg.length / spanCount;
          }
        }

        if (spanCount === 0 || spanLength === 0) return;

        const maxSpansPerStick = Math.max(1, Math.floor(144 / spanLength));
        const fullSticks = Math.floor(spanCount / maxSpansPerStick);
        const remainderSpans = spanCount % maxSpansPerStick;
        let segmentBundles = fullSticks;
        if (remainderSpans > 0) {
          const remainderLength = remainderSpans * spanLength;
          segmentBundles += remainderLength <= 72 ? 0.5 : 1.0;
        }
        glassChannelBundles += segmentBundles;
      }
    });

    // 2. Rail Packages (Top and Bottom Rail 12' Set)
    const picketPortionBundles = picketBillableLengthInches > 0
      ? Math.max(0.5, Math.ceil((picketBillableLengthInches / 144) * 2) / 2)
      : 0;
    const glassPortionBundles = glassChannelBundles;
    const railPackages = picketPortionBundles + glassPortionBundles;

    if (railPackages > 0) {
      items.push({
        id: 'bom-rail-top-bottom-set',
        name: `Top and Bottom Rail x 12' - ${displayColor}`,
        category: 'rails',
        quantity: railPackages,
        unit: 'sets',
        unitPrice: 141.74,
        description: '12-foot top and bottom rail set including mounting channels.',
      });
    }

    // 3. Picket Packages & Spacers
    const picketPackages = picketBillableLengthInches > 0
      ? Math.max(0.5, Math.ceil((picketBillableLengthInches / 120) * 2) / 2)
      : 0;

    if (picketPackages > 0) {
      items.push({
        id: 'bom-picket-pack',
        name: `5/8" Picket Pack - 10' - ${displayColor}`,
        category: 'infill',
        quantity: picketPackages,
        unit: 'packs',
        unitPrice: 141.74,
        description: '10-foot coverage picket pack including vertical pickets.',
      });
    }

    const flatSpacerPacks = picketLevelBillableLengthInches > 0
      ? Math.max(0.5, Math.ceil((picketLevelBillableLengthInches / 120) * 2) / 2)
      : 0;

    if (flatSpacerPacks > 0) {
      items.push({
        id: 'bom-flat-spacers',
        name: `Flat Spacers 10' - ${displayColor}`,
        category: 'infill',
        quantity: flatSpacerPacks,
        unit: 'kits',
        unitPrice: 0.00,
        description: 'Included in picket pack for uniform picket alignment.',
      });
    }

    // Calculate Stair Spacers based on stair length
    if (picketStairLengthInches > 0 || (stairPosts > 0 && picketStairLengthInches > 0)) {
      const stairLengthFeet = picketStairLengthInches > 0 ? picketStairLengthInches / 12 : (stairPosts * 3.5);
      const stairSpacerPacks = Math.ceil((stairLengthFeet / 10) * 2) / 2;
      
      items.push({
        id: 'bom-stair-spacers',
        name: `Stair Spacers 10' - ${displayColor}`,
        category: 'infill',
        quantity: Math.max(0.5, stairSpacerPacks),
        unit: 'kits',
        unitPrice: 0.00,
        description: 'Angled stair spacers included for stair picket alignment.',
      });
    }

    // 4. Base Plate Covers & Fasteners (Post caps removed per instructions)
    if (totalPosts > 0) {
      items.push({
        id: 'bom-base-plate-covers',
        name: `Base plate cover - ${displayColor}`,
        category: 'hardware',
        quantity: totalPosts,
        unit: 'pcs',
        unitPrice: 18.00,
        description: 'Decorative trim cover for post mounting base plates.',
      });

      // 5. Anchor Bolts - ONLY included if surface is Concrete (word 'set' removed)
      if (options.surfaceType === 'Concrete') {
        items.push({
          id: 'bom-anchor-bolts',
          name: `Anchor Bolts (Concrete)`,
          category: 'hardware',
          quantity: totalPosts,
          unit: 'pcs',
          unitPrice: 13.80,
          description: 'Heavy duty structural anchor bolts for concrete mounting (1 per post).',
        });
      }

      // Fasteners / Screws
      items.push({
        id: 'bom-fasteners',
        name: `Fasteners / Screws`,
        category: 'hardware',
        quantity: totalPosts,
        unit: 'pcs',
        unitPrice: 15.30,
        description: 'Complete assembly fasteners and mounting screws (1 per post).',
      });
    }

    // 5. Top and Bottom Bracket Set for Column attachments ($24.44 per set)
    if (totalColumnBracketSets > 0) {
      items.push({
        id: 'bom-top-bottom-brackets',
        name: `Top and Bottom Bracket Set - ${displayColor}`,
        category: 'hardware',
        quantity: totalColumnBracketSets,
        unit: 'sets',
        unitPrice: 24.44,
        description: 'Heavy duty top and bottom rail bracket set for attaching railing to porch/deck column.',
      });
    }

    // 6. Installation & Service Labor (INSTALLATION group)
    if (options.installed) {
      const picketBillableLF = picketBillableLengthInches / 12;
      const glassBillableLF = glassLevelFootage + glassStairFootage;

      const PICKET_RATE = options.picketInstallRate ?? 25.30;
      const GLASS_RATE = options.glassInstallRate ?? 30.00;
      const PICKET_MINIMUM = 400.00;
      const GLASS_MINIMUM = 600.00;

      const hasPicket = picketBillableLF > 0;
      const hasGlass = glassBillableLF > 0;

      const picketNormal = picketBillableLF * PICKET_RATE;
      const glassNormal = glassBillableLF * GLASS_RATE;
      const combinedNormal = picketNormal + glassNormal;

      const presentMinimums: number[] = [];
      if (hasPicket) presentMinimums.push(PICKET_MINIMUM);
      if (hasGlass) presentMinimums.push(GLASS_MINIMUM);
      const jobMinimum = presentMinimums.length > 0 ? Math.max(...presentMinimums) : 0;

      if (combinedNormal > 0 && combinedNormal < jobMinimum) {
        let minimumLabel: string;
        if (hasPicket && hasGlass) {
          minimumLabel = 'Railing Installation';
        } else if (hasGlass) {
          minimumLabel = 'Glass Railing Installation';
        } else {
          minimumLabel = 'Picket Railing Installation';
        }

        items.push({
          id: 'bom-installation-labor-minimum',
          name: minimumLabel,
          category: 'labor',
          quantity: 1,
          unit: 'flat',
          unitPrice: jobMinimum,
          description: 'Professional field installation labor (minimum job charge).',
        });
      } else {
        if (hasPicket) {
          items.push({
            id: 'bom-installation-labor-pickets',
            name: 'Picket Railing Installation',
            category: 'labor',
            quantity: picketBillableLF,
            unit: 'lf',
            unitPrice: PICKET_RATE,
            description: `Professional field installation labor per linear foot ($${(options.picketInstallRate ?? 25.30).toFixed(2)}/LF).`,
          });
        }

        if (hasGlass) {
          items.push({
            id: 'bom-installation-labor-glass',
            name: 'Glass Railing Installation',
            category: 'labor',
            quantity: glassBillableLF,
            unit: 'lf',
            unitPrice: GLASS_RATE,
            description: `Professional field installation labor per linear foot ($${(options.glassInstallRate ?? 30.00).toFixed(2)}/LF).`,
          });
        }
      }
    }

    if (options.removalCost > 0) {
      items.push({
        id: 'bom-removal-disposal',
        name: 'Existing Railing Removal and Disposal',
        category: 'labor',
        quantity: 1,
        unit: 'flat',
        unitPrice: options.removalCost,
        description: 'Tear-out and disposal of existing railing (manually quoted).',
      });
    }

    if (totalPosts > 0 && Number(options.height) === 36) {
      items.push({
        id: 'bom-post-custom-cutting',
        name: 'Post Custom Cutting 36"',
        category: 'labor',
        quantity: totalPosts,
        unit: 'pcs',
        unitPrice: 17.25,
        description: 'Shop cutting of standard posts down to 36" height ($17.25 per post).',
      });
    }

    // 7. Glass Infill Items (only if glass-styled runs exist)
    if (glassLevelFootage + glassStairFootage + glassSpanCount > 0) {
      if (glassLevelFootage > 0) {
        items.push({
          id: 'bom-glass-panels-landing',
          name: '6mm Tempered Glass Panels (Landing)',
          category: 'glass',
          quantity: glassLevelFootage,
          unit: 'lf',
          unitPrice: options.glassLandingPanelRate ?? 30.00,
          description: '6mm clear tempered safety glass panels for level landing runs.',
        });
      }

      if (glassStairFootage > 0) {
        items.push({
          id: 'bom-glass-panels-stair',
          name: '6mm Tempered Glass Panels (Stair)',
          category: 'glass',
          quantity: glassStairFootage,
          unit: 'lf',
          unitPrice: 60.00,
          description: '6mm clear tempered safety glass panels for stair runs.',
        });
      }

      if (glassChannelBundles > 0) {
        items.push({
          id: 'bom-glass-channel',
          name: "Glass Channel (12')",
          category: 'glass',
          quantity: 2 * glassChannelBundles,
          unit: 'sets',
          unitPrice: 28.00,
          description: '12-foot glass mounting channel set (top and bottom) for glass panel installation.',
        });
      }

      if (glassSpanCount > 0) {
        items.push({
          id: 'bom-glass-blocks',
          name: 'Glass Blocks',
          category: 'glass',
          quantity: 2 * glassSpanCount,
          unit: 'pcs',
          unitPrice: 0.80,
          description: 'Setting blocks for positioning glass panels securely in mounting channels.',
        });
      }
    }

    return items;
  }

  // Fallback for other infill styles (cables, glass, mesh)
  let startEndCount = 0;
  let stairCount = 0;
  let cornerCount = 0;
  let angleCount = 0;
  let lineCount = 0;

  posts.forEach((post) => {
    if (post.type === 'stair') {
      stairCount++;
    } else if (post.type === 'start' || post.type === 'end') {
      startEndCount++;
    } else if (post.type === 'corner') {
      cornerCount++;
    } else if (post.type === 'angle') {
      angleCount++;
    } else {
      lineCount++;
    }
  });

  const postPriceFactor = 1.0;

  if (stairCount > 0) {
    items.push({
      id: 'bom-post-stair',
      name: `Bottom Stair Posts (${options.height}" H - ${displayColor})`,
      category: 'posts',
      quantity: stairCount,
      unit: 'pcs',
      unitPrice: Math.round(115 * postPriceFactor),
      description: 'Heavy duty stair terminal post installed at the bottom of the steps.',
    });
  }

  if (startEndCount > 0) {
    items.push({
      id: 'bom-post-terminal',
      name: `Terminal End Posts (${options.height}" H - ${displayColor})`,
      category: 'posts',
      quantity: startEndCount,
      unit: 'pcs',
      unitPrice: Math.round(95 * postPriceFactor),
      description: 'Heavier duty posts used at start and end points of flat runs or top of stairs.',
    });
  }

  if (cornerCount > 0) {
    items.push({
      id: 'bom-post-corner',
      name: `Corner Posts (${options.height}" H - ${displayColor})`,
      category: 'posts',
      quantity: cornerCount,
      unit: 'pcs',
      unitPrice: Math.round(110 * postPriceFactor),
      description: 'Posts configured with pre-drilled holes or bracket mounts at 90/135 degree angles.',
    });
  }

  if (angleCount > 0) {
    items.push({
      id: 'bom-post-angle',
      name: `45° Angle Posts (${options.height}" H - ${displayColor})`,
      category: 'posts',
      quantity: angleCount,
      unit: 'pcs',
      unitPrice: Math.round(110 * postPriceFactor),
      description: 'Posts configured for angled run joints (typically 45 or 135 degrees).',
    });
  }

  if (lineCount > 0) {
    items.push({
      id: 'bom-post-line',
      name: `Line Posts (${options.height}" H - ${displayColor})`,
      category: 'posts',
      quantity: lineCount,
      unit: 'pcs',
      unitPrice: Math.round(85 * postPriceFactor),
      description: 'Intermediate support posts spaced evenly along straight runs.',
    });
  }

  // Hardware
  const hardwarePrice = options.mountingType === 'fascia' ? 24 : 12;
  items.push({
    id: 'bom-hardware-mount',
    name: `${options.mountingType === 'fascia' ? 'Fascia Side-Mount Brackets' : 'Base Plate Surface Mounts'}`,
    category: 'hardware',
    quantity: posts.length,
    unit: 'kits',
    unitPrice: hardwarePrice,
    description: `Heavy-duty mounting hardware kits for anchoring posts to ${options.surfaceType?.toLowerCase() || 'wood'}.`,
  });

  // Handrail
  let handrailPrice = 12;
  if (options.handrailStyle === 'wood') handrailPrice = 22;
  else if (options.handrailStyle === 'round') handrailPrice = 14;

  const activeRailLengthLF = segments
    .filter(seg => !seg.isStairOpening)
    .reduce((sum, seg) => sum + seg.length, 0) / 12;

  const topRailQty = Math.ceil(activeRailLengthLF);
  items.push({
    id: 'bom-rail-top',
    name: `Top Handrail (${getHandrailLabel(options.handrailStyle)})`,
    category: 'rails',
    quantity: topRailQty,
    unit: 'lf',
    unitPrice: handrailPrice,
    description: `Continuous top railing, provided in linear feet. Needs cutting on site.`,
  });

  if (options.style !== 'cables') {
    const bottomRailQty = Math.ceil(activeRailLengthLF);
    items.push({
      id: 'bom-rail-bottom',
      name: 'Bottom Rail Support',
      category: 'rails',
      quantity: bottomRailQty,
      unit: 'lf',
      unitPrice: 9,
      description: 'Stabilizing bottom rail to support the infill material.',
    });
  }

  if (options.style === 'cables') {
    const numRuns = options.height === 36 ? 10 : 12;
    let totalCableLF = 0;
    let tensionerKits = 0;

    segments.forEach((seg) => {
      if (seg.isStairOpening) return;
      const segLF = seg.length / 12;
      totalCableLF += segLF * numRuns;
      tensionerKits += numRuns;
    });

    items.push({
      id: 'bom-infill-cable-spool',
      name: `1/8" Marine Grade SS316 Cable`,
      category: 'infill',
      quantity: Math.ceil(totalCableLF),
      unit: 'lf',
      unitPrice: 1.1,
      description: `Continuous high-tensile stainless steel horizontal cabling.`,
    });

    items.push({
      id: 'bom-hardware-tensioners',
      name: `Cable Tensioner & Terminal Fittings`,
      category: 'hardware',
      quantity: tensionerKits,
      unit: 'kits',
      unitPrice: 15,
      description: `Level-tensioner kits for anchoring cables into terminal and corner posts.`,
    });
  } else if ((options.style as RailingStyle) === 'glass') {
    let panelCount = 0;
    const glassHeight = options.height === 36 ? 28 : 34;

    segments.forEach((seg) => {
      if (seg.isStairOpening) return;
      for (let j = 0; j < seg.posts.length - 1; j++) {
        const p1 = seg.posts[j];
        const p2 = seg.posts[j + 1];
        const d = getDistance(p1, p2);
        const clearWidth = d - options.postWidth;
        const glassWidth = clearWidth - 6;

        if (glassWidth > 8) {
          panelCount++;
        }
      }
    });

    items.push({
      id: 'bom-infill-glass',
      name: `1/4" Tempered Glass Custom Panels`,
      category: 'infill',
      quantity: panelCount,
      unit: 'panels',
      unitPrice: Math.round((glassHeight === 28 ? 120 : 150)),
      description: `Heavy-duty clear tempered safety glass panels, custom sized to fit spans.`,
    });

    items.push({
      id: 'bom-hardware-glass-clamps',
      name: `Stainless Steel Glass Grip Clamps`,
      category: 'hardware',
      quantity: panelCount * 4,
      unit: 'pcs',
      unitPrice: 7.5,
      description: `Rubber-padded locking glass clamps for secure mounting to posts.`,
    });
  } else if (options.style === 'mesh') {
    let panelCount = 0;
    segments.forEach((seg) => {
      if (seg.isStairOpening) return;
      panelCount += (seg.posts.length - 1);
    });

    items.push({
      id: 'bom-infill-mesh',
      name: `Powder Coated Grid Mesh Panels`,
      category: 'infill',
      quantity: panelCount,
      unit: 'panels',
      unitPrice: 95,
      description: `Steel woven wire mesh panels with mounting framing tabs.`,
    });
  }

  // Continuous Brackets for mid-stair posts if risers > 5
  let continuousBracketCount = 0;
  segments.forEach((seg) => {
    if (seg.isStairOpening && seg.stairOpening) {
      const numMidPosts = Math.ceil(seg.stairOpening.risers / 5) - 1;
      if (numMidPosts > 0) {
        const sides = seg.stairOpening.sides === '2' ? 2 : 1;
        continuousBracketCount += numMidPosts * sides;
      }
    }
  });

  if (continuousBracketCount > 0) {
    let contBracketPrice = 18.00;
    if (options.systemColor === 'White' || options.systemColor === 'Gloss Black') {
      contBracketPrice = 15.64;
    } else if (options.systemColor === 'Bronze') {
      contBracketPrice = 14.66;
    } else if (options.systemColor === 'Matte Black') {
      contBracketPrice = 18.00;
    }

    items.push({
      id: 'bom-hardware-continuous-bracket',
      name: `Continuous Handrail Brackets (Angled Stair Mount)`,
      category: 'hardware',
      quantity: continuousBracketCount,
      unit: 'pcs',
      unitPrice: contBracketPrice,
      description: 'Heavy duty continuous handrail mounting brackets to support continuous handrail at mid-stair posts.',
    });
  }

  return items;
}

function getHandrailLabel(style: HandrailStyle): string {
  switch (style) {
    case 'square': return 'Square Clean-Line';
    case 'round': return 'Round Architectural Handrail';
    case 'wood': return 'Comfort-Grip Finished Hardwood';
  }
}
