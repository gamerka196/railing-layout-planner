/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas-pro';
import { BOMItem, RailingOptions } from '../types';
import { generateBOM } from '../utils/railingCalc';
import { copyBOMForQuickBooks } from '../utils/exportQuickBooks';
import { FileText, Check, LayoutGrid, Edit3, X, RotateCcw, ClipboardCopy } from 'lucide-react';
import tdrLogoImg from '../assets/tdr-logo.png';

interface BOMEstimatorProps {
  calculatedPosts: any[];
  calculatedSegments: any[];
  totalLengthInches: number;
  options: RailingOptions;
  runs?: any[];
  onSwitchToDrawing?: () => void;
  customerName: string;
  setCustomerName: (name: string) => void;
  priceOverrides: Record<string, number>;
  setPriceOverrides: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  isActive?: boolean;
}

export default function BOMEstimator({
  calculatedPosts,
  calculatedSegments,
  totalLengthInches,
  options,
  runs = [],
  onSwitchToDrawing,
  customerName,
  setCustomerName,
  priceOverrides,
  setPriceOverrides,
  isActive = true,
}: BOMEstimatorProps) {
  // Local state for invoice fields
  const [estimateDate, setEstimateDate] = useState<string>(
    new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  );
  const [logoFailed, setLogoFailed] = useState(false);
  const taxRate = 0.13; // 13% HST Ontario fixed
  const taxLabel = 'HST (ON) @ 13%';

  // Transient "Copied!" confirmation state for the QuickBooks clipboard export
  const [qbCopyState, setQbCopyState] = useState<'idle' | 'copied' | 'error'>('idle');

  // Edit Mode state
  const [isEditMode, setIsEditMode] = useState<boolean>(false);
  // Snapshot for mid-edit Cancel escape
  const snapshotRef = useRef<Record<string, number>>({});
  // Local input drafts while typing
  const [inputDrafts, setInputDrafts] = useState<Record<string, string>>({});

  const estimateRef = useRef<HTMLDivElement>(null);

  // Leaving/returning to the tab resets it to read-only
  useEffect(() => {
    if (!isActive) {
      setIsEditMode(false);
    }
  }, [isActive]);

  // 1. Generate fresh automatic BOM from drawing
  const rawBOM = useMemo(() => {
    return generateBOM(calculatedPosts, calculatedSegments, totalLengthInches, options, runs);
  }, [calculatedPosts, calculatedSegments, totalLengthInches, options, runs]);

  // 2. Apply persistent price overrides keyed by stable item ID
  const activeBOM = useMemo(() => {
    return rawBOM.map((item) => {
      const defaultPrice = item.unitPrice ?? 0;
      const isOverridden = typeof priceOverrides[item.id] === 'number';
      const effectiveUnitPrice = isOverridden ? priceOverrides[item.id] : defaultPrice;
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
  }, [rawBOM, priceOverrides]);

  const overrideCount = Object.keys(priceOverrides).length;

  // Edit Mode controls
  const handleStartEdit = () => {
    snapshotRef.current = { ...priceOverrides };
    const drafts: Record<string, string> = {};
    activeBOM.forEach((item) => {
      drafts[item.id] = (item.unitPrice ?? 0).toFixed(2);
    });
    setInputDrafts(drafts);
    setIsEditMode(true);
  };

  const handleCancelEdit = () => {
    // Revert only changes made during this editing session
    setPriceOverrides(snapshotRef.current);
    setInputDrafts({});
    setIsEditMode(false);
  };

  const handleDoneEdit = () => {
    // Commit all pending input drafts
    activeBOM.forEach((item) => {
      if (inputDrafts[item.id] !== undefined) {
        handleInputBlur(item.id, item.defaultUnitPrice ?? 0);
      }
    });
    setInputDrafts({});
    setIsEditMode(false);
  };

  const handleResetLinePrice = (id: string) => {
    setPriceOverrides((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setInputDrafts((prev) => {
      const next = { ...prev };
      const raw = rawBOM.find((i) => i.id === id);
      if (raw) {
        next[id] = (raw.unitPrice ?? 0).toFixed(2);
      } else {
        delete next[id];
      }
      return next;
    });
  };

  const handleResetAllToAuto = () => {
    const confirmed = window.confirm(
      'Are you sure you want to reset all price overrides to automatic calculated values?'
    );
    if (!confirmed) return;
    setPriceOverrides({});
    setInputDrafts({});
  };

  const handleInputChange = (id: string, value: string, defaultPrice: number) => {
    setInputDrafts((prev) => ({ ...prev, [id]: value }));

    if (value.trim() === '') {
      // Blank: allow empty draft while typing; will revert to default on blur
      return;
    }

    const parsed = parseFloat(value);
    if (!isNaN(parsed) && parsed >= 0) {
      const rounded = Math.round((parsed + Number.EPSILON) * 100) / 100;
      if (Math.abs(rounded - defaultPrice) < 0.001) {
        // Reverted to default value
        setPriceOverrides((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      } else {
        setPriceOverrides((prev) => ({
          ...prev,
          [id]: rounded,
        }));
      }
    }
  };

  const handleInputBlur = (id: string, defaultPrice: number) => {
    const currentDraft = inputDrafts[id];
    if (currentDraft === undefined) return;

    const trimmed = currentDraft.trim();
    if (trimmed === '') {
      // Blank reverts to default rather than zero
      setPriceOverrides((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setInputDrafts((prev) => ({ ...prev, [id]: defaultPrice.toFixed(2) }));
      return;
    }

    const parsed = parseFloat(trimmed);
    if (isNaN(parsed) || parsed < 0) {
      // Reject negatives and non-numeric (revert on invalid)
      const existing = priceOverrides[id];
      const restoreVal = existing !== undefined ? existing : defaultPrice;
      setInputDrafts((prev) => ({ ...prev, [id]: restoreVal.toFixed(2) }));
    } else {
      const rounded = Math.round((parsed + Number.EPSILON) * 100) / 100;
      if (Math.abs(rounded - defaultPrice) < 0.001) {
        setPriceOverrides((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setInputDrafts((prev) => ({ ...prev, [id]: defaultPrice.toFixed(2) }));
      } else {
        setPriceOverrides((prev) => ({
          ...prev,
          [id]: rounded,
        }));
        setInputDrafts((prev) => ({ ...prev, [id]: rounded.toFixed(2) }));
      }
    }
  };

  // Group items by estimate categories (Installation, Posts, Railings, Glass, Hardware)
  const groupedCategories = [
    {
      id: 'installation',
      title: 'INSTALLATION',
      icon: '🔧',
      items: activeBOM.filter((item) => item.category === 'labor'),
    },
    {
      id: 'posts',
      title: 'POSTS',
      icon: '🔲',
      items: activeBOM.filter((item) => item.category === 'posts'),
    },
    {
      id: 'railings',
      title: 'RAILINGS',
      icon: '☰',
      items: activeBOM.filter(
        (item) => item.category === 'rails' || item.category === 'infill' || item.category === 'railings'
      ),
    },
    {
      id: 'glass',
      title: 'GLASS',
      icon: '🪟',
      items: activeBOM.filter((item) => item.category === 'glass'),
    },
    {
      id: 'hardware',
      title: 'HARDWARE AND ACCESSORIES',
      icon: '⚙️',
      items: activeBOM.filter((item) => item.category === 'hardware'),
    },
    {
      id: 'other',
      title: 'OTHER ITEMS',
      icon: '📦',
      items: activeBOM.filter(
        (item) =>
          !item.category ||
          !['labor', 'posts', 'rails', 'infill', 'railings', 'glass', 'hardware'].includes(item.category)
      ),
    },
  ].filter((group) => group.items.length > 0);

  // Financial Calculations
  const subtotal = activeBOM.reduce((sum, item) => sum + (item.amount ?? 0), 0);
  const materialsSubtotal = activeBOM
    .filter((item) => item.category !== 'labor')
    .reduce((sum, item) => sum + (item.amount ?? 0), 0);
  const discountPercent = options.contractorDiscountPercent || 0;
  const discountAmount = materialsSubtotal * (discountPercent / 100);
  const taxableBase = Math.max(0, subtotal - discountAmount);
  const taxAmount = taxableBase * taxRate;
  const grandTotal = taxableBase + taxAmount;

  const handleCopyForQuickBooks = async () => {
    try {
      const succeeded = await copyBOMForQuickBooks(activeBOM);
      setQbCopyState(succeeded ? 'copied' : 'error');
    } catch (err) {
      console.error('Failed to copy estimate for QuickBooks:', err);
      setQbCopyState('error');
    } finally {
      setTimeout(() => setQbCopyState('idle'), 2000);
    }
  };

  const handleDownloadPDF = async () => {
    if (!estimateRef.current) return;

    try {
      if (document.fonts?.ready) {
        await document.fonts.ready;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));

      const canvas = await html2canvas(estimateRef.current, {
        scale: 1.5,
        backgroundColor: '#ffffff',
        useCORS: true,
        onclone: (clonedDoc) => {
          const originalRoot = estimateRef.current;
          const clonedRoot = clonedDoc.querySelector('[data-pdf-capture-target="true"]');
          if (!originalRoot || !clonedRoot) return;

          // Remove elements marked to ignore in PDF
          clonedRoot.querySelectorAll('[data-pdf-ignore="true"]').forEach((el) => el.remove());

          // Fix category headers colSpan to 4 in PDF
          clonedRoot.querySelectorAll('td[data-category-header="true"]').forEach((td) => {
            td.setAttribute('colspan', '4');
          });

          // Replace input fields with styled span text
          const originalInputs = Array.from(originalRoot.querySelectorAll('input'));
          const clonedInputs = Array.from(clonedRoot.querySelectorAll('input'));

          originalInputs.forEach((origInput, idx) => {
            const clonedInput = clonedInputs[idx];
            if (!clonedInput) return;

            const inputEl = origInput as HTMLInputElement;
            const span = clonedDoc.createElement('span');
            span.className = clonedInput.className;
            span.style.cssText = clonedInput.style.cssText;
            span.style.display = 'inline-block';

            const val = inputEl.value;
            span.textContent = val || '\u00A0';

            clonedInput.parentNode?.replaceChild(span, clonedInput);
          });
        },
      });

      const imgData = canvas.toDataURL('image/jpeg', 0.85);
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'pt',
        format: 'a4',
        compress: true,
      });

      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();

      const pdfImageWidth = pageWidth;
      const pdfImageHeight = (canvas.height * pageWidth) / canvas.width;

      if (pdfImageHeight <= pageHeight) {
        doc.addImage(imgData, 'JPEG', 0, 0, pdfImageWidth, pdfImageHeight);
      } else {
        let heightLeft = pdfImageHeight;
        let position = 0;

        doc.addImage(imgData, 'JPEG', 0, position, pdfImageWidth, pdfImageHeight);
        heightLeft -= pageHeight;

        while (heightLeft > 0) {
          position -= pageHeight;
          doc.addPage();
          doc.addImage(imgData, 'JPEG', 0, position, pdfImageWidth, pdfImageHeight);
          heightLeft -= pageHeight;
        }
      }

      // Filename: Railing_Estimate_<CustomerName or Color>_<date>.pdf
      const nameOrColor = customerName && customerName.trim()
        ? customerName.trim().replace(/[^a-zA-Z0-9_-]/g, '_')
        : options.systemColor.replace(/[^a-zA-Z0-9_-]/g, '_');
      const cleanDate = estimateDate.replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `Railing_Estimate_${nameOrColor}_${cleanDate}.pdf`;

      doc.save(filename);
    } catch (err) {
      console.error('Failed to generate PDF estimate:', err);
      alert('Failed to generate PDF estimate. Please check the browser console.');
    }
  };

  const isEmpty = runs.length === 0 && activeBOM.length === 0;

  if (isEmpty) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[420px] w-full max-w-2xl mx-auto p-8 bg-white border border-slate-200/90 rounded-2xl shadow-sm text-center">
        <div className="p-4 bg-teal-50 text-teal-600 rounded-2xl mb-4 border border-teal-100">
          <FileText size={36} className="stroke-[1.75]" />
        </div>
        <h2 className="text-xl font-bold text-slate-900 mb-1">No estimate yet</h2>
        <p className="text-slate-500 text-sm max-w-md mb-6 leading-relaxed">
          Draw a railing run on the 2D Layout Plan to generate an estimate.
        </p>
        {onSwitchToDrawing && (
          <button
            onClick={onSwitchToDrawing}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-bold text-xs shadow-sm transition-all cursor-pointer"
          >
            <LayoutGrid size={15} />
            <span>Go to 2D Layout Plan</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-4xl mx-auto">
      {/* Top Toolbar Action Bar (Hidden during Print) */}
      <div className="bg-slate-900 text-white rounded-xl p-4 flex flex-wrap items-center justify-between gap-4 border border-slate-800 shadow-sm print:hidden">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-teal-500/20 text-teal-300 rounded-lg border border-teal-500/30">
            <FileText size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-100">Official Project Estimate</h2>
              {isEditMode && (
                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-teal-500/20 text-teal-300 border border-teal-500/30">
                  Editing Prices
                </span>
              )}
            </div>
            <p className="text-slate-400 text-xs">
              {isEditMode
                ? 'Unit prices are editable. Quantities and totals recalculate automatically.'
                : 'Generated dynamically based on 2D layout drawing'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Reset All to Auto button (available in edit mode or when overrides exist) */}
          {isEditMode && (
            <button
              onClick={handleResetAllToAuto}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors border border-slate-700 cursor-pointer"
              title="Reset all price overrides to automatic calculated values"
            >
              <RotateCcw size={13} />
              <span>Reset All to Auto</span>
            </button>
          )}

          {/* Edit Mode Buttons */}
          {isEditMode ? (
            <>
              <button
                onClick={handleCancelEdit}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors border border-slate-700 cursor-pointer"
                title="Discard changes made during this edit session"
              >
                <X size={13} />
                <span>Cancel</span>
              </button>

              <button
                onClick={handleDoneEdit}
                className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-lg bg-teal-600 text-white hover:bg-teal-500 transition-colors border border-teal-500 shadow-sm cursor-pointer"
                title="Done editing unit prices"
              >
                <Check size={13} />
                <span>Done Editing</span>
              </button>
            </>
          ) : (
            <button
              onClick={handleStartEdit}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-lg bg-slate-800 text-slate-200 hover:text-white hover:bg-slate-700 transition-colors border border-slate-700 cursor-pointer"
              title="Edit Unit Prices"
            >
              <Edit3 size={13} />
              <span>Edit Estimate</span>
            </button>
          )}

          {/* Copy for QuickBooks */}
          <button
            onClick={handleCopyForQuickBooks}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors border border-slate-700 cursor-pointer disabled:opacity-60"
            title="Copy line items to paste into a QuickBooks Online Estimate"
            disabled={qbCopyState !== 'idle'}
          >
            {qbCopyState === 'copied' ? (
              <>
                <Check size={13} />
                <span>Copied!</span>
              </>
            ) : qbCopyState === 'error' ? (
              <>
                <X size={13} />
                <span>Copy failed</span>
              </>
            ) : (
              <>
                <ClipboardCopy size={13} />
                <span>Copy for QuickBooks</span>
              </>
            )}
          </button>

          {/* Download PDF */}
          <button
            onClick={handleDownloadPDF}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors border border-slate-700 cursor-pointer"
            title="Download PDF Estimate"
          >
            <FileText size={13} />
            <span>Download PDF</span>
          </button>
        </div>
      </div>

      {/* Printable Estimate Document Card */}
      <div
        ref={estimateRef}
        data-pdf-capture-target="true"
        className="bg-white text-slate-800 rounded-2xl border border-slate-200/90 p-8 md:p-10 shadow-lg font-sans relative print:shadow-none print:border-none print:p-0 print:m-0"
      >
        {/* Document Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start gap-6 border-b border-slate-100 pb-8">
          {/* Company Branding & Contact */}
          <div className="space-y-3">
            <div className="shrink-0">
              {!logoFailed ? (
                <img
                  src={tdrLogoImg}
                  alt="Toronto Deck and Rail"
                  className="h-36 w-auto object-contain"
                  onError={() => setLogoFailed(true)}
                />
              ) : (
                <span className="font-bold text-slate-900 text-base uppercase tracking-wider">
                  TORONTO DECK AND RAIL
                </span>
              )}
            </div>

            <div className="text-xs text-slate-600 font-medium space-y-0.5 pt-1">
              <p className="font-semibold text-slate-800">1611 Finfar Ct, Mississauga, ON L5J 4K1</p>
              <p className="pt-1 font-mono text-slate-700">437-690-01-00</p>
              <p className="text-slate-700">info@torontodeckandrail.com</p>
              <p className="text-teal-700 font-semibold">www.torontodeckandrail.com</p>
            </div>
          </div>

          {/* Right Header: ESTIMATE Heading & Summary Card */}
          <div className="flex flex-col items-start sm:items-end space-y-4">
            <h2 className="text-3xl font-serif tracking-widest text-slate-900 uppercase font-light">
              ESTIMATE
            </h2>

            {/* Date & Total Box */}
            <div className="bg-[#FAF8F5] border border-stone-200/90 rounded-xl p-3.5 w-56 space-y-2 font-mono text-xs shadow-2xs">
              <div className="flex justify-between items-center text-stone-500 font-sans font-bold text-[11px] uppercase tracking-wider">
                <span>DATE</span>
                <input
                  type="text"
                  value={estimateDate}
                  onChange={(e) => setEstimateDate(e.target.value)}
                  className="bg-transparent font-sans font-bold text-slate-900 text-right focus:outline-none w-28 hover:bg-stone-200/50 rounded px-1"
                />
              </div>
              <div className="border-t border-stone-200/80 pt-1.5 flex justify-between items-baseline">
                <span className="text-stone-500 font-sans font-bold text-[11px] uppercase tracking-wider">
                  TOTAL
                </span>
                <span className="text-lg font-black text-slate-900">
                  ${grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Prepared For Section */}
        <div className="py-6 border-b border-slate-100 space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-widest text-stone-400 font-sans">
            PREPARED FOR
          </label>
          <div>
            <input
              type="text"
              placeholder="Client / Contractor Name..."
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              className="w-full text-base font-semibold text-slate-900 placeholder:text-slate-300 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-teal-500 focus:outline-none py-1 transition-colors"
            />
          </div>
        </div>

        {/* Supply Only Order Banner when not installed */}
        {!options.installed && (
          <div className="mt-4 p-3.5 bg-amber-50 border-2 border-amber-400 rounded-xl text-amber-950 text-center font-extrabold text-sm uppercase tracking-wide shadow-2xs">
            Supply Only Order — Material Not Installed
          </div>
        )}

        {/* Estimate Items Table */}
        <div className="mt-6">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b-2 border-slate-800 text-[11px] font-bold text-slate-900 uppercase tracking-wider font-sans">
                <th className="py-3 pr-4">DESCRIPTION</th>
                <th className="py-3 px-3 text-center w-28">QTY</th>
                <th className="py-3 px-3 text-right w-36">UNIT PRICE</th>
                <th className="py-3 pl-3 text-right w-28">AMOUNT</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {groupedCategories.map((group) => (
                <React.Fragment key={group.id}>
                  {/* Category Header Bar */}
                  <tr className="bg-[#FAF8F5] border-t border-stone-200">
                    <td
                      data-category-header="true"
                      colSpan={4}
                      className="py-2.5 px-3"
                    >
                      <div className="flex items-center gap-2 font-bold text-stone-700 text-[11px] uppercase tracking-wider">
                        <span>{group.icon}</span>
                        <span>{group.title}</span>
                      </div>
                    </td>
                  </tr>

                  {/* Group Items */}
                  {group.items.map((item) => {
                    const formattedQty =
                      typeof item.quantity === 'number' && !isNaN(item.quantity)
                        ? Number.isInteger(item.quantity)
                          ? item.quantity.toString()
                          : item.quantity.toFixed(1)
                        : '—';

                    return (
                      <tr key={item.id} className="hover:bg-slate-50/80 transition-colors group">
                        {/* Item Name (Read-Only) */}
                        <td className="py-3 pr-4 text-slate-800 font-medium">
                          <span className="font-semibold text-slate-900">{item.name}</span>
                        </td>

                        {/* Quantity (Read-Only, Automatic) */}
                        <td className="py-3 px-3 text-center font-mono text-slate-700 font-medium">
                          <span>
                            {formattedQty} {item.unit || ''}
                          </span>
                        </td>

                        {/* Unit Price (Editable ONLY in Edit Mode) */}
                        <td className="py-3 px-3 text-right font-mono text-slate-700">
                          {isEditMode ? (
                            <div className="flex items-center justify-end gap-1.5">
                              <div className="relative flex items-center">
                                <span className="absolute left-2 text-xs text-slate-400 font-mono pointer-events-none">
                                  $
                                </span>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={
                                    inputDrafts[item.id] !== undefined
                                      ? inputDrafts[item.id]
                                      : (item.unitPrice ?? 0).toFixed(2)
                                  }
                                  onChange={(e) =>
                                    handleInputChange(item.id, e.target.value, item.defaultUnitPrice ?? 0)
                                  }
                                  onBlur={() => handleInputBlur(item.id, item.defaultUnitPrice ?? 0)}
                                  className="w-24 pl-5 pr-2 py-1 text-right font-mono text-xs font-bold rounded focus:outline-none transition-colors bg-slate-50 border border-slate-200 text-slate-800 focus:border-teal-500 focus:bg-white"
                                />
                              </div>
                              <button
                                type="button"
                                data-pdf-ignore="true"
                                onClick={() => handleResetLinePrice(item.id)}
                                className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors cursor-pointer shrink-0 print:hidden"
                                title={`Reset to auto calculated price ($${(item.defaultUnitPrice ?? 0).toFixed(2)})`}
                              >
                                <RotateCcw size={13} />
                              </button>
                            </div>
                          ) : (
                            <span className="font-mono text-slate-700">
                              ${(item.unitPrice ?? 0).toFixed(2)}
                            </span>
                          )}
                        </td>

                        {/* Amount (Calculated: Qty * Unit Price) */}
                        <td className="py-3 pl-3 text-right font-mono font-bold text-slate-900">
                          ${(item.amount ?? 0).toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>

        {/* Bottom Totals Summary Section */}
        <div className="mt-8 pt-6 border-t border-slate-200 flex flex-col items-end space-y-2 text-xs font-mono">
          {/* Subtotal */}
          <div className="flex justify-between items-center w-72 text-slate-600">
            <span className="font-sans font-medium text-slate-500">Subtotal</span>
            <span className="font-bold text-slate-900">
              ${subtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>

          {/* Contractor Discount (if applied) */}
          {discountPercent > 0 && (
            <div className="flex justify-between items-center w-72 text-slate-500 italic font-sans pt-1">
              <span className="text-[11px] font-medium text-slate-500">
                Discount ({discountPercent}% on Materials)
              </span>
              <span className="font-mono font-bold text-slate-600">
                -${discountAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          )}

          {/* Tax Line */}
          <div className="flex justify-between items-center w-72 text-slate-600 pt-1">
            <span className="font-sans text-[11px] font-medium text-slate-500 bg-stone-100 px-2 py-0.5 rounded border border-stone-200">
              {taxLabel} on{' '}
              {taxableBase.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="font-bold text-slate-800">
              ${taxAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>

          {/* Divider */}
          <div className="w-72 border-b border-slate-200 my-1"></div>

          {/* Total */}
          <div className="flex justify-between items-baseline w-72 text-slate-950 pt-1">
            <span className="font-sans font-extrabold text-sm uppercase tracking-wider text-slate-900">
              Total
            </span>
            <span className="font-black text-xl text-slate-950">
              ${grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>

        {/* Footer Note */}
        <div className="mt-12 pt-6 border-t border-slate-100 text-[10px] text-slate-400">
          <p>
            Prices in Canadian dollars. HST applicable at 13%. GST Reg. No.: 713063089RT0001. Valid for 30
            days. Material quantities are automatically calculated based on entered linear footage; final
            required materials may vary slightly on-site due to custom cuts or job requirements.
          </p>
        </div>
      </div>
    </div>
  );
}
