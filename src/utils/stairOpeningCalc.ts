/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { RailingRun, StairOpening, StairDirection } from '../types';

// Fixed constant tread depth per step in inches
export const TREAD_DEPTH_INCHES = 12;

/**
 * Calculates the total run length of the stair flight itself in inches.
 * Typically (risers * tread_depth) or ((risers - 1) * tread_depth).
 * We will calculate risers * TREAD_DEPTH_INCHES as a default.
 */
export function calculateStairRunLengthInches(risers: number): number {
  return risers * TREAD_DEPTH_INCHES;
}

/**
 * Splits the host run into three zone lengths (in feet) based on the stair opening:
 * 1. Before opening: leftOffset
 * 2. Opening width: openingWidth
 * 3. After opening: runLengthFt - leftOffset - openingWidth
 */
export function calculateStairOpeningZones(runLengthInches: number, stairOpening?: StairOpening) {
  const runLengthFt = runLengthInches / 12;
  
  if (!stairOpening || !stairOpening.enabled) {
    return {
      before: runLengthFt,
      opening: 0,
      after: 0,
    };
  }

  const before = stairOpening.leftOffset;
  const opening = stairOpening.openingWidth;
  const after = Math.max(0, runLengthFt - before - opening);

  return {
    before,
    opening,
    after,
  };
}

/**
 * Enforces leftOffset >= 0, openingWidth > 0, and leftOffset + openingWidth <= runLengthFt.
 * Clamps values immediately if any constraint is violated, returning a valid StairOpening object.
 */
export function clampStairOpeningValues(
  runLengthInches: number,
  stairOpening: Partial<StairOpening>
): StairOpening {
  const runLengthFt = runLengthInches / 12;
  const enabled = stairOpening.enabled ?? false;
  const risers = Math.max(1, Math.min(30, stairOpening.risers ?? 4));
  const sides = stairOpening.sides ?? '1';
  const direction = stairOpening.direction ?? StairDirection.DOWN;

  let leftOffset = Math.max(0, stairOpening.leftOffset ?? 0);
  let openingWidth = Math.max(1, stairOpening.openingWidth ?? 3); // Default 3ft

  // Enforce leftOffset + openingWidth <= runLengthFt
  if (leftOffset + openingWidth > runLengthFt) {
    if (openingWidth > runLengthFt) {
      openingWidth = runLengthFt;
      leftOffset = 0;
    } else {
      leftOffset = runLengthFt - openingWidth;
    }
  }

  return {
    enabled,
    leftOffset: Math.round(leftOffset * 100) / 100,
    openingWidth: Math.round(openingWidth * 100) / 100,
    risers,
    sides,
    direction,
  };
}

/**
 * Cycles through valid stair directions based on host run orientation.
 */
export function getNextStairDirection(
  current: StairDirection,
  orientation: 'horizontal' | 'vertical' | 'angled'
): StairDirection {
  if (orientation === 'vertical') {
    return current === StairDirection.LEFT ? StairDirection.RIGHT : StairDirection.LEFT;
  } else {
    return current === StairDirection.UP ? StairDirection.DOWN : StairDirection.UP;
  }
}

/**
 * Returns default direction for host run orientation.
 */
export function getDefaultStairDirection(orientation: 'horizontal' | 'vertical' | 'angled'): StairDirection {
  return orientation === 'vertical' ? StairDirection.LEFT : StairDirection.DOWN;
}
