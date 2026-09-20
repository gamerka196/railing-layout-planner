/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Point {
  id: string;
  x: number; // in inches
  y: number; // in inches
}

export enum StairDirection {
  UP = 'up',
  DOWN = 'down',
  LEFT = 'left',
  RIGHT = 'right',
}

export interface StairOpening {
  enabled: boolean;
  leftOffset: number; // in feet
  openingWidth: number; // in feet
  risers: number;
  sides: '1' | '2';
  direction: StairDirection;
}

export interface RailingRun {
  id: string;
  points: Point[]; // [start, end]
  orientation: 'horizontal' | 'vertical' | 'angled';
  isStair?: boolean;
  stairStepsCount?: number; // range 6 to 60, default 6
  stairBottomIsStart?: boolean; // default true
  stairOpening?: StairOpening; // Optional stair opening on a straight run
  isHouseWall?: boolean;
  startIsColumn?: boolean; // Attached to column using top & bottom bracket
  endIsColumn?: boolean;   // Attached to column using top & bottom bracket
  startColumnId?: string;
  endColumnId?: string;
  style?: 'pickets' | 'glass';
}

export type RailingStyle = 'pickets' | 'cables' | 'glass' | 'mesh';
export type HandrailStyle = 'square' | 'round' | 'wood';
export type MountingType = 'deck' | 'fascia';
export type SystemColor = 'Bronze' | 'Matte Black' | 'Gloss Black' | 'White';

export interface RailingOptions {
  style: RailingStyle;
  height: 36 | 42; // in inches
  maxPostSpacing: number; // in inches (e.g. 48, 60, 72, 96)
  handrailStyle: HandrailStyle;
  mountingType: MountingType;
  systemColor: SystemColor;
  installed: boolean;
  removalCost: number;
  contractorDiscountPercent: number;
  surfaceType: 'Concrete' | 'Wood';
  picketInstallRate?: number; // per linear foot
  glassInstallRate?: number; // per linear foot
  glassLandingPanelRate?: number; // per linear foot for level landing glass panels
  picketWidth: number; // in inches
  postWidth: number; // in inches
  gridSnapping: boolean;
  gridSize: number; // in inches (e.g. 1, 12)
  unitMode: 'feet' | 'inches';
  elevationCategory: 'high' | 'low'; // 'high' = 4 ft and higher, 'low' = 4 ft and lower
}

export type PostType = 'start' | 'end' | 'corner' | 'line' | 'stair' | 'angle' | 'column';

export interface GeneratedPost {
  id: string;
  x: number; // in inches
  y: number; // in inches
  z: number; // ground level height (typically 0, or negative for fascia mount)
  type: PostType;
  segmentIndex: number;
  isDuplicate?: boolean;
  isColumn?: boolean;
  isExcluded?: boolean;
}

export interface RailSegment {
  id: string;
  startIndex: number; // index in posts array
  endIndex: number; // index in posts array
  length: number; // in inches
  angle: number; // in radians
  posts: GeneratedPost[]; // posts belonging to this segment (including start and end)
  isStair?: boolean;
  stairStepsCount?: number;
  stairBottomIsStart?: boolean;
  isStairOpening?: boolean;
  stairOpening?: StairOpening;
  parentRunStyle?: 'pickets' | 'glass';
}

export type CanvasShapeType =
  | 'square_column'
  | 'circular_column'
  | 'pool_rect'
  | 'pool_circle'
  | 'grass_lawn'
  | 'bbq_counter';

export interface CanvasShape {
  id: string;
  type: CanvasShapeType;
  x: number; // in inches (center X)
  y: number; // in inches (center Y)
  width: number; // in inches
  height: number; // in inches
  rotation?: number; // degrees
  label?: string;
}

export interface BOMItem {
  id: string;
  name: string;
  category: 'posts' | 'rails' | 'infill' | 'glass' | 'hardware' | 'labor' | string | null;
  quantity?: number;
  unit?: 'pcs' | 'lf' | 'kits' | 'panels' | 'packs' | 'sets' | 'flat' | 'job' | 'ea' | string;
  unitPrice?: number;
  amount?: number;
  description?: string;
  defaultUnitPrice?: number;
  isOverridden?: boolean;
}
