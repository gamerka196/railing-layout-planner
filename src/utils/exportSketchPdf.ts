/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import jsPDF from 'jspdf';
import html2canvas from 'html2canvas-pro';
import { RailingOptions, RailingRun, CanvasShape } from '../types';
import { formatLength } from './railingCalc';
import tdrLogoImg from '../assets/tdr-logo.png';

interface ExportSketchPdfOptions {
  runs: RailingRun[];
  calculatedRuns: any[];
  shapes: CanvasShape[];
  options: RailingOptions;
  customerName?: string;
  totalLengthInches: number;
  totalPosts: number;
  totalCost?: number;
  svgElement?: SVGSVGElement | HTMLElement | null;
  canvasContainerElement?: HTMLElement | null;
}

/**
 * Converts logo image file to a PNG Data URL
 */
async function getLogoDataUrl(src: string = tdrLogoImg): Promise<{ dataUrl: string; width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const w = img.width || 600;
      const h = img.height || 200;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0);
        resolve({
          dataUrl: canvas.toDataURL('image/png'),
          width: w,
          height: h,
        });
      } else {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Converts an SVG element to a high-resolution PNG Data URL and returns dimensions
 */
async function svgToPngDataUrl(svg: SVGSVGElement): Promise<{ dataUrl: string; width: number; height: number }> {
  const serializer = new XMLSerializer();
  const svgClone = svg.cloneNode(true) as SVGSVGElement;

  svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  // Remove UI toolbars or floating controls if present
  const hideElements = svgClone.querySelectorAll('#zoom-control-toolbar, #scale-status-indicators');
  hideElements.forEach((el) => el.remove());

  const viewBoxAttr = svg.getAttribute('viewBox');
  let viewBoxWidth = 1200;
  let viewBoxHeight = 800;

  if (viewBoxAttr) {
    const parts = viewBoxAttr.split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      viewBoxWidth = parts[2];
      viewBoxHeight = parts[3];
    }
  } else if (svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width > 0) {
    viewBoxWidth = svg.viewBox.baseVal.width;
    viewBoxHeight = svg.viewBox.baseVal.height;
  }

  svgClone.setAttribute('width', viewBoxWidth.toString());
  svgClone.setAttribute('height', viewBoxHeight.toString());

  const svgString = serializer.serializeToString(svgClone);
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const scale = 1.5; // 1.5x resolution
      const canvas = document.createElement('canvas');
      canvas.width = viewBoxWidth * scale;
      canvas.height = viewBoxHeight * scale;

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0, viewBoxWidth, viewBoxHeight);
      }
      URL.revokeObjectURL(url);
      resolve({
        dataUrl: canvas.toDataURL('image/jpeg', 0.85),
        width: viewBoxWidth,
        height: viewBoxHeight,
      });
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

export async function exportSketchPdf({
  runs,
  calculatedRuns,
  shapes,
  options,
  customerName,
  totalLengthInches,
  totalPosts,
  totalCost,
  svgElement,
  canvasContainerElement,
}: ExportSketchPdfOptions): Promise<void> {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'pt',
    format: 'a4',
    compress: true,
  });

  const pageWidth = doc.internal.pageSize.getWidth(); // 841.89 pt
  const pageHeight = doc.internal.pageSize.getHeight(); // 595.28 pt
  const margin = 36; // 0.5 inch margins
  const contentWidth = pageWidth - margin * 2; // 769.89 pt

  // ==========================================
  // 1. MINIMAL HEADER WITH LOGO, TITLE, SUBTITLE & CLIENT CHIP
  // ==========================================
  const logoInfo = await getLogoDataUrl(tdrLogoImg);
  if (logoInfo) {
    const logoAspect = logoInfo.width / logoInfo.height;
    const logoH = 50;
    const logoW = Math.min(200, logoH * logoAspect);
    doc.addImage(logoInfo.dataUrl, 'PNG', margin, 14, logoW, logoH);
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(15, 23, 42);
    doc.text('TORONTO DECK AND RAIL', margin, 46);
  }

  // Single Client Chip
  const currentY = 66;
  const clientText = customerName && customerName.trim() ? customerName.trim() : 'Valued Customer';
  const formattedDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  doc.setFillColor(241, 245, 249); // slate-100
  doc.setDrawColor(226, 232, 240); // slate-200
  doc.setLineWidth(1);
  doc.roundedRect(margin, currentY, contentWidth, 22, 4, 4, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text('CLIENT:', margin + 10, currentY + 14);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text(clientText, margin + 50, currentY + 14);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(`DATE: ${formattedDate}`, pageWidth - margin - 10, currentY + 14, { align: 'right' });

  // ==========================================
  // 2. TWO-COLUMN LAYOUT: DRAWING (~70%) + DETAILS & LEGEND (~30%)
  // ==========================================
  const mainY = currentY + 30; // 96 pt
  const mainH = 390; // height of main content section
  const leftW = Math.floor(contentWidth * 0.69); // ~530 pt (~70%)
  const rightW = contentWidth - leftW - 14; // ~225 pt (~30%)
  const leftX = margin;
  const rightX = margin + leftW + 14;

  // Render Left Column: Auto-fit Edge-to-Edge Drawing Box
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(203, 213, 225); // slate-300
  doc.setLineWidth(1);
  doc.roundedRect(leftX, mainY, leftW, mainH, 6, 6, 'FD');

  const captureTarget = canvasContainerElement || svgElement;
  if (captureTarget) {
    try {
      if (document.fonts?.ready) {
        await document.fonts.ready;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));

      const canvas = await html2canvas(captureTarget as HTMLElement, {
        scale: 1.5,
        backgroundColor: '#ffffff',
        useCORS: true,
      });
      const imgData = canvas.toDataURL('image/jpeg', 0.85);

      const pad = 6;
      const boxW = leftW - pad * 2;
      const boxH = mainH - pad * 2;
      const drawAspect = canvas.width / canvas.height;
      const boxAspect = boxW / boxH;

      let fitW = boxW;
      let fitH = boxH;
      if (drawAspect > boxAspect) {
        fitW = boxW;
        fitH = boxW / drawAspect;
      } else {
        fitH = boxH;
        fitW = boxH * drawAspect;
      }

      const fitX = leftX + pad + (boxW - fitW) / 2;
      const fitY = mainY + pad + (boxH - fitH) / 2;

      doc.addImage(imgData, 'JPEG', fitX, fitY, fitW, fitH);
    } catch (err) {
      console.error('Failed to capture canvas with html2canvas:', err);
      if (svgElement && svgElement instanceof SVGSVGElement) {
        try {
          const svgInfo = await svgToPngDataUrl(svgElement);
          const pad = 6;
          const boxW = leftW - pad * 2;
          const boxH = mainH - pad * 2;
          const drawAspect = svgInfo.width / svgInfo.height;
          const boxAspect = boxW / boxH;

          let fitW = boxW;
          let fitH = boxH;
          if (drawAspect > boxAspect) {
            fitW = boxW;
            fitH = boxW / drawAspect;
          } else {
            fitH = boxH;
            fitW = boxH * drawAspect;
          }

          const fitX = leftX + pad + (boxW - fitW) / 2;
          const fitY = mainY + pad + (boxH - fitH) / 2;

          doc.addImage(svgInfo.dataUrl, 'JPEG', fitX, fitY, fitW, fitH);
        } catch (svgErr) {
          console.error('Fallback SVG conversion failed:', svgErr);
        }
      }
    }
  } else {
    doc.setFillColor(248, 250, 252);
    doc.rect(leftX, mainY, leftW, mainH, 'F');
    doc.setTextColor(100, 116, 139);
    doc.setFontSize(10);
    doc.text('Sketch Diagram', leftX + leftW / 2, mainY + mainH / 2, { align: 'center' });
  }

  // Calculate billable quantities for Project Details block
  const isFeet = options.unitMode === 'feet';
  const totalFlatPicketsInches = calculatedRuns.reduce((sum: number, run: any) => {
    if (run.isHouseWall) return sum;
    return (
      sum +
      (run.segments || [])
        .filter((seg: any) => !seg.isStairOpening)
        .reduce((s: number, seg: any) => s + seg.length, 0)
    );
  }, 0);

  const totalStairPicketsInches = calculatedRuns.reduce((sum: number, run: any) => {
    if (run.isHouseWall) return sum;
    if (run.stairOpening?.enabled) {
      const steps = run.stairOpening.risers;
      const sides = run.stairOpening.sides === '2' ? 2 : 1;
      const stairRailLF = (steps * Math.sqrt(193)) / 12;
      const stairBillableLF = stairRailLF * sides;
      return sum + stairBillableLF * 12;
    }
    return sum;
  }, 0);

  const hasPicketRun = calculatedRuns.some(
    (cr: any) => !cr.isHouseWall && cr.style === 'pickets' && cr.segments?.some((s: any) => !s.isStairOpening)
  );
  const hasGlassRun = calculatedRuns.some(
    (cr: any) => !cr.isHouseWall && cr.style === 'glass' && cr.segments?.some((s: any) => !s.isStairOpening)
  );

  const styleText =
    hasPicketRun && hasGlassRun
      ? 'Pickets & Glass'
      : hasGlassRun
      ? 'Glass'
      : 'Pickets';

  // Render Right Column - Stacked Panel 1: PROJECT DETAILS
  const panel1H = 190;
  doc.setFillColor(248, 250, 252); // slate-50
  doc.setDrawColor(226, 232, 240); // slate-200
  doc.roundedRect(rightX, mainY, rightW, panel1H, 6, 6, 'FD');

  // Title Bar
  doc.setFillColor(15, 23, 42); // slate-900
  doc.roundedRect(rightX, mainY, rightW, 24, 6, 6, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(255, 255, 255);
  doc.text('PROJECT DETAILS', rightX + 10, mainY + 16);

  const detailsRows = [
    ['HEIGHT', `${options.height}"`],
    ['COLOUR', options.systemColor || 'Matte Black'],
    ['LANDING RAILING', formatLength(totalFlatPicketsInches, isFeet)],
    ['STAIR RAILING', totalStairPicketsInches > 0 ? formatLength(totalStairPicketsInches, isFeet) : '0"'],
    ['STYLE', styleText],
    ['SURFACE', options.surfaceType || 'Wood'],
  ];

  let detailRowY = mainY + 42;
  detailsRows.forEach(([label, value]) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(label, rightX + 10, detailRowY);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text(value, rightX + rightW - 10, detailRowY, { align: 'right' });

    doc.setDrawColor(241, 245, 249);
    doc.line(rightX + 8, detailRowY + 5, rightX + rightW - 8, detailRowY + 5);

    detailRowY += 24;
  });

  // Render Right Column - Stacked Panel 2: DRAWING LEGEND
  const panel2Y = mainY + 200;
  const panel2H = mainH - 200; // 190 pt
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(rightX, panel2Y, rightW, panel2H, 6, 6, 'FD');

  // Title Bar
  doc.setFillColor(15, 23, 42);
  doc.roundedRect(rightX, panel2Y, rightW, 24, 6, 6, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(255, 255, 255);
  doc.text('DRAWING LEGEND', rightX + 10, panel2Y + 16);

  // Determine presence of elements in drawing
  const allPostsCombined = calculatedRuns.flatMap((cr: any) => cr.posts || []);
  const hasPicketsRailing = hasPicketRun;
  const hasGlassRailing = hasGlassRun;
  const hasStairRailing = calculatedRuns.some(
    (cr: any) => !cr.isHouseWall && (cr.stairOpening?.enabled || cr.isStair)
  );
  const hasEndPost = allPostsCombined.some(
    (p: any) => p.type === 'end' && !p.isDuplicate
  );
  const hasLinePost = allPostsCombined.some(
    (p: any) => p.type === 'line' && !p.isDuplicate
  );
  const hasCornerPost = allPostsCombined.some(
    (p: any) => p.type === 'corner' && !p.isDuplicate
  );
  const hasStairPost = allPostsCombined.some(
    (p: any) => p.type === 'stair' && !p.isDuplicate
  );
  const hasColumnBracket =
    calculatedRuns.some((cr: any) => cr.startIsColumn || cr.endIsColumn) ||
    allPostsCombined.some((p: any) => p.isColumn);
  const hasSquareColumn = shapes.some(
    (s: any) => s.type === 'square_column' || s.type === 'circular_column'
  );
  const hasHouseWall = runs.some((r: any) => r.isHouseWall);

  const legendItems: { label: string; draw: (x: number, y: number) => void }[] = [];

  if (hasPicketsRailing) {
    legendItems.push({
      label: 'Picket Railing',
      draw: (x, y) => {
        doc.setFillColor(13, 148, 136); // teal-600
        doc.rect(x, y - 4, 14, 3, 'F');
      },
    });
  }

  if (hasGlassRailing) {
    legendItems.push({
      label: 'Glass Railing',
      draw: (x, y) => {
        doc.setFillColor(59, 130, 246); // #3b82f6
        doc.rect(x, y - 4, 14, 3, 'F');
      },
    });
  }

  if (hasStairRailing) {
    legendItems.push({
      label: 'Stair Railing',
      draw: (x, y) => {
        doc.setFillColor(148, 163, 184); // slate-400
        doc.rect(x, y - 4, 14, 3, 'F');
      },
    });
  }

  if (hasEndPost) {
    legendItems.push({
      label: 'End Post',
      draw: (x, y) => {
        doc.setFillColor(0, 0, 0);
        doc.rect(x + 2, y - 6, 8, 8, 'F');
      },
    });
  }

  if (hasLinePost) {
    legendItems.push({
      label: 'Line Post',
      draw: (x, y) => {
        doc.setFillColor(34, 197, 94);
        doc.rect(x + 2, y - 6, 8, 8, 'F');
      },
    });
  }

  if (hasCornerPost) {
    legendItems.push({
      label: 'Corner Post',
      draw: (x, y) => {
        doc.setFillColor(37, 99, 235);
        doc.rect(x + 2, y - 6, 8, 8, 'F');
      },
    });
  }

  if (hasStairPost) {
    legendItems.push({
      label: 'Stair Post',
      draw: (x, y) => {
        doc.setFillColor(236, 72, 153);
        doc.rect(x + 2, y - 6, 8, 8, 'F');
      },
    });
  }

  if (hasColumnBracket) {
    legendItems.push({
      label: 'Column Bracket',
      draw: (x, y) => {
        doc.setFillColor(234, 88, 12);
        doc.circle(x + 6, y - 2, 4, 'F');
      },
    });
  }

  if (hasSquareColumn) {
    legendItems.push({
      label: 'Square Column',
      draw: (x, y) => {
        doc.setDrawColor(51, 65, 85);
        doc.setFillColor(248, 250, 252);
        doc.rect(x + 1, y - 7, 10, 10, 'FD');
      },
    });
  }

  if (hasHouseWall) {
    legendItems.push({
      label: 'House Wall',
      draw: (x, y) => {
        doc.setFillColor(100, 116, 139);
        doc.rect(x, y - 5, 14, 5, 'F');
      },
    });
  }

  let legendY = panel2Y + 42;
  legendItems.forEach((item) => {
    if (legendY < panel2Y + panel2H - 10) {
      item.draw(rightX + 10, legendY);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(15, 23, 42);
      doc.text(item.label, rightX + 30, legendY);
      legendY += 18;
    }
  });

  // Save the generated PDF
  const filenameClient = customerName && customerName.trim() ? customerName.trim().replace(/[^a-z0-9]/gi, '_') : 'Project';
  doc.save(`Toronto_Deck_and_Rail_Sketch_${filenameClient}.pdf`);
}
