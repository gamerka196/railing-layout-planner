/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BOMItem, SystemColor } from '../types';

// A single cell must not contain a tab or newline, since those are the
// row/column delimiters QuickBooks Online's line-item "paste" expects.
function sanitizeCell(value: string): string {
  return value.replace(/[\t\r\n]+/g, ' ').trim();
}

function formatQuantity(value?: number): string {
  if (value === undefined || value === null) return '';
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  return rounded % 1 === 0 ? String(rounded) : rounded.toFixed(2);
}

function formatCurrency(value?: number): string {
  if (value === undefined || value === null) return '';
  return (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2);
}

// QuickBooks product/service codes are colour-prefixed (confirmed against the
// real Products & Services catalog). "Gloss Black" is catalogued simply as
// "Black" but keys off the same 02 prefix.
const QBO_COLOR_CODE_PREFIX: Record<SystemColor, string> = {
  White: '01',
  'Gloss Black': '02',
  Bronze: '07',
  'Matte Black': '08',
};

// BOM item ids (stable across colour/quantity changes) mapped to the QBO
// product code SUFFIX for colour-variant items. Combined with the colour
// prefix above, e.g. bom-post-end + Matte Black -> "08EP".
const QBO_COLOR_CODE_SUFFIX: Record<string, string> = {
  'bom-post-end': 'EP',
  'bom-post-line': 'LP',
  'bom-post-corner': 'CP',
  'bom-post-stair': 'BP',
  'bom-rail-top-bottom-set': 'TB',
  'bom-picket-pack': 'RP',
  'bom-flat-spacers': 'FS',
  'bom-stair-spacers': 'SS',
  'bom-base-plate-covers': 'BPC',
  'bom-top-bottom-brackets': 'BR',
};

// BOM item ids mapped to a fixed QBO product/service code, independent of
// system colour.
const QBO_FIXED_PRODUCT_CODE: Record<string, string> = {
  'bom-fasteners': 'Fasteners / Screws',
  'bom-anchor-bolts': 'Anchor Bolts',
  'bom-installation-labor-pickets': 'PRI',
  'bom-installation-labor-glass': 'GRI',
  'bom-glass-blocks': 'GB',
  'bom-glass-channel': 'GC',
};

// Every line item on Toronto Deck and Rail estimates is HST-taxable.
const QBO_TAX_CODE = 'HST';

/**
 * Resolves the QuickBooks "Product/service" column value for a BOM line
 * item. Falls back to the item's own generated name (free text) when no
 * confirmed QBO product code exists for it yet.
 */
function resolveProductServiceCode(item: BOMItem, systemColor: SystemColor): string {
  const fixedCode = QBO_FIXED_PRODUCT_CODE[item.id];
  if (fixedCode) return fixedCode;

  const suffix = QBO_COLOR_CODE_SUFFIX[item.id];
  if (suffix) {
    const prefix = QBO_COLOR_CODE_PREFIX[systemColor];
    if (prefix) return `${prefix}${suffix}`;
  }

  return item.name ?? '';
}

/**
 * Builds tab-separated line-item text matching the column order of a
 * QuickBooks Online Estimate/Invoice line-item grid with the "Service Date"
 * column disabled: Product/service | Description | Qty | Rate | Amount | Sales tax.
 *
 * This is meant to be pasted directly into QBO's own "Paste line items"
 * control, not imported as a file (QBO does not support file-based
 * import of Estimate line items).
 */
export function buildQuickBooksClipboardText(items: BOMItem[], systemColor: SystemColor): string {
  return items
    .map((item) => {
      const productService = sanitizeCell(resolveProductServiceCode(item, systemColor));
      const description = sanitizeCell(item.description ?? '');
      const qty = formatQuantity(item.quantity);
      const rate = formatCurrency(item.unitPrice);
      const amount = formatCurrency(item.amount);
      return [productService, description, qty, rate, amount, QBO_TAX_CODE].join('\t');
    })
    .join('\n');
}

/**
 * Copies the given BOM line items to the clipboard, formatted for QBO's
 * line-item paste. Returns true on success.
 */
export async function copyBOMForQuickBooks(items: BOMItem[], systemColor: SystemColor): Promise<boolean> {
  const text = buildQuickBooksClipboardText(items, systemColor);
  if (!text) return false;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  // Fallback for browsers/contexts without the async Clipboard API
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const succeeded = document.execCommand('copy');
  document.body.removeChild(textarea);
  return succeeded;
}
