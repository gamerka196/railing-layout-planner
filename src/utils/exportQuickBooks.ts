/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BOMItem } from '../types';

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

/**
 * Builds tab-separated line-item text matching the column order of a
 * QuickBooks Online Estimate/Invoice line-item grid with the "Service Date"
 * column disabled: Product/service | Description | Qty | Rate | Amount.
 *
 * This is meant to be pasted directly into QBO's own "Paste line items"
 * control, not imported as a file (QBO does not support file-based
 * import of Estimate line items).
 */
export function buildQuickBooksClipboardText(items: BOMItem[]): string {
  return items
    .map((item) => {
      const productService = sanitizeCell(item.name ?? '');
      const description = sanitizeCell(item.description ?? '');
      const qty = formatQuantity(item.quantity);
      const rate = formatCurrency(item.unitPrice);
      const amount = formatCurrency(item.amount);
      return [productService, description, qty, rate, amount].join('\t');
    })
    .join('\n');
}

/**
 * Copies the given BOM line items to the clipboard, formatted for QBO's
 * line-item paste. Returns true on success.
 */
export async function copyBOMForQuickBooks(items: BOMItem[]): Promise<boolean> {
  const text = buildQuickBooksClipboardText(items);
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
