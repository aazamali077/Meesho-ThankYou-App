import { useEffect, useMemo, useRef, useState } from 'react';
import { PDFDocument } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const DEFAULT_FONT_SIZE = 16;
const DEFAULT_GAP = 12;
const NOTE_WIDTH_RATIO = 0.84;
const NOTE_RENDER_SCALE = 3;

const NOTE_TEMPLATES = [
  'Thank you for your order! ⭐⭐⭐⭐⭐',
  'Please rate us 5 stars on Meesho! ❤️',
  'For any exchange/support: +91 98765 43210',
  'Packed with care. Hope you love it! 🎁',
];

function findContentBottom(canvas) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;

  const { width, height } = canvas;
  const pixels = context.getImageData(0, 0, width, height).data;
  const horizontalStep = Math.max(1, Math.floor(width / 700));

  for (let y = height - 1; y >= 0; y -= 1) {
    let visiblePixels = 0;
    for (let x = 0; x < width; x += horizontalStep) {
      const offset = (y * width + x) * 4;
      const [red, green, blue, alpha] = pixels.subarray(offset, offset + 4);
      if (alpha > 20 && (red < 238 || green < 238 || blue < 238)) {
        visiblePixels += 1;
        if (visiblePixels >= 2) return (y + 1) / height;
      }
    }
  }

  return null;
}

function wrapText(context, text, maxWidth) {
  const lines = [];
  for (const paragraph of text.split(/\r?\n/)) {
    if (!paragraph.trim()) {
      lines.push('');
      continue;
    }

    let line = '';
    for (const word of paragraph.trim().split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (context.measureText(candidate).width <= maxWidth) {
        line = candidate;
        continue;
      }

      if (line) lines.push(line);
      line = '';
      for (const character of Array.from(word)) {
        const next = line + character;
        if (line && context.measureText(next).width > maxWidth) {
          lines.push(line);
          line = character;
        } else {
          line = next;
        }
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function measureNote(text, pageWidth, fontSize = DEFAULT_FONT_SIZE, isBold = false, textAlign = 'center') {
  const scale = NOTE_RENDER_SCALE;
  const imageWidth = Math.floor(pageWidth * NOTE_WIDTH_RATIO * scale);
  const scaledFontSize = fontSize * scale;
  const lineHeight = fontSize * 1.35 * scale;
  const context = document.createElement('canvas').getContext('2d');
  if (!context) throw new Error('Text rendering is unavailable in this browser.');

  const fontWeight = isBold ? 'bold' : 'normal';
  context.font = `${fontWeight} ${scaledFontSize}px Arial, "Segoe UI", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
  const lines = wrapText(context, text, imageWidth);
  return {
    lines,
    imageWidth,
    lineHeight,
    imageHeight: Math.ceil(lines.length * lineHeight),
    scale,
    fontSize,
    isBold,
    textAlign,
  };
}

function createNoteImage(layout) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, layout.imageWidth);
  canvas.height = Math.max(1, layout.imageHeight);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Text rendering is unavailable in this browser.');

  const fontWeight = layout.isBold ? 'bold' : 'normal';
  context.font = `${fontWeight} ${layout.fontSize * layout.scale}px Arial, "Segoe UI", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
  context.fillStyle = '#1e2421';
  context.textAlign = layout.textAlign || 'center';
  context.textBaseline = 'top';

  let xPos = layout.imageWidth / 2;
  if (layout.textAlign === 'left') {
    xPos = 0;
  } else if (layout.textAlign === 'right') {
    xPos = layout.imageWidth;
  }

  layout.lines.forEach((line, index) => {
    context.fillText(line, xPos, index * layout.lineHeight, layout.imageWidth);
  });

  const base64 = canvas.toDataURL('image/png').split(',')[1];
  const binary = atob(base64);
  const imageBytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return {
    imageBytes,
    width: layout.imageWidth / layout.scale,
    height: canvas.height / layout.scale,
  };
}

function PageSlideCanvas({ pageCanvas }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !pageCanvas) return;
    canvas.width = pageCanvas.width;
    canvas.height = pageCanvas.height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(pageCanvas, 0, 0);
    }
  }, [pageCanvas]);

  return <canvas ref={canvasRef} className="slide-canvas" />;
}

function App() {
  const fileInputRef = useRef(null);
  const previewTrackRef = useRef(null);

  const [file, setFile] = useState(null);
  const [pages, setPages] = useState([]);
  const [note, setNote] = useState('');
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
  const [isBold, setIsBold] = useState(false);
  const [textAlign, setTextAlign] = useState('center');
  const [gap, setGap] = useState(DEFAULT_GAP);
  const [previewFormat, setPreviewFormat] = useState('full'); // 'full' | '4x6'
  const [activePageIndex, setActivePageIndex] = useState(0);

  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  // Load PDF when file is selected
  useEffect(() => {
    if (!file) return undefined;
    let cancelled = false;
    let loadingTask;

    async function loadPdf() {
      setLoading(true);
      setError('');
      setPages([]);
      setActivePageIndex(0);

      try {
        const bytes = await file.arrayBuffer();
        loadingTask = pdfjsLib.getDocument({ data: bytes.slice(0) });
        const pdfDocument = await loadingTask.promise;
        const renderedPages = [];

        for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
          if (cancelled) return;
          const page = await pdfDocument.getPage(pageNumber);
          const viewport = page.getViewport({ scale: 1.35 });
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d', { willReadFrequently: true });
          const outputScale = window.devicePixelRatio || 1;
          canvas.width = Math.floor(viewport.width * outputScale);
          canvas.height = Math.floor(viewport.height * outputScale);
          await page.render({
            canvasContext: context,
            viewport,
            transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null,
          }).promise;

          renderedPages.push({
            number: pageNumber,
            width: viewport.width,
            height: viewport.height,
            pdfWidth: page.view[2] - page.view[0],
            pdfHeight: page.view[3] - page.view[1],
            contentBottom: findContentBottom(canvas),
            canvas,
          });
        }

        if (!cancelled) {
          setPages(renderedPages);
          setActivePageIndex(0);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError?.message || 'This PDF could not be opened.');
          setPages([]);
          setFile(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadPdf();
    return () => {
      cancelled = true;
      loadingTask?.destroy();
    };
  }, [file]);

  // Keyboard navigation for horizontal slides
  useEffect(() => {
    function handleKeyDown(event) {
      if (['TEXTAREA', 'INPUT'].includes(document.activeElement?.tagName)) return;
      if (!pages.length) return;

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        goToPage(Math.max(0, activePageIndex - 1));
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        goToPage(Math.min(pages.length - 1, activePageIndex + 1));
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pages.length, activePageIndex]);

  function goToPage(index) {
    if (index < 0 || index >= pages.length) return;
    setActivePageIndex(index);
    const track = previewTrackRef.current;
    if (!track) return;
    const targetSlide = track.querySelector(`#page-slide-${index}`);
    if (targetSlide) {
      targetSlide.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }

  function handleTrackScroll() {
    const track = previewTrackRef.current;
    if (!track || pages.length <= 1) return;
    const scrollLeft = track.scrollLeft;
    const slideWidth = track.clientWidth;
    if (slideWidth > 0) {
      const pageIndex = Math.round(scrollLeft / slideWidth);
      if (pageIndex >= 0 && pageIndex < pages.length && pageIndex !== activePageIndex) {
        setActivePageIndex(pageIndex);
      }
    }
  }

  function chooseFile(event) {
    const nextFile = event.target.files?.[0];
    event.target.value = '';
    if (!nextFile) return;
    if (nextFile.type !== 'application/pdf' && !nextFile.name.toLowerCase().endsWith('.pdf')) {
      setError('Choose a PDF file to get started.');
      return;
    }
    setError('');
    setFile(nextFile);
  }

  // Check if note fits on all pages
  const fitAnalysis = useMemo(() => {
    if (!pages.length || !note.trim()) return { fits: true, overflowingPages: [] };
    const overflowingPages = [];

    for (const page of pages) {
      if (page.contentBottom === null) {
        overflowingPages.push(page.number);
        continue;
      }

      if (previewFormat === '4x6') {
        const TARGET_WIDTH = 288;
        const TARGET_HEIGHT = 432;
        const scale = TARGET_WIDTH / page.pdfWidth;
        const layout = measureNote(note.trim(), TARGET_WIDTH, fontSize, isBold, textAlign);
        const blockHeight = layout.imageHeight / layout.scale;
        const contentBottomPt = page.contentBottom * page.pdfHeight * scale;
        const noteY = TARGET_HEIGHT - contentBottomPt - gap - blockHeight;
        if (noteY < 8) overflowingPages.push(page.number);
      } else {
        const layout = measureNote(note.trim(), page.pdfWidth, fontSize, isBold, textAlign);
        const blockHeight = layout.imageHeight / layout.scale;
        const contentBottomPt = page.contentBottom * page.pdfHeight;
        if (contentBottomPt + gap + blockHeight > page.pdfHeight - 12) {
          overflowingPages.push(page.number);
        }
      }
    }

    return {
      fits: overflowingPages.length === 0,
      overflowingPages,
    };
  }, [pages, note, fontSize, isBold, textAlign, gap, previewFormat]);

  async function downloadPdf(targetFormat = previewFormat) {
    if (!file || !note.trim()) return;
    setExporting(true);
    setError('');

    const is4x6 = targetFormat === '4x6';

    try {
      const fileBytes = await file.arrayBuffer();
      const sourcePdf = await PDFDocument.load(fileBytes);
      const sourcePages = sourcePdf.getPages();

      let outputPdf;

      if (is4x6) {
        // 4 x 6 inches = 288 x 432 points
        const TARGET_WIDTH = 288;
        const TARGET_HEIGHT = 432;
        outputPdf = await PDFDocument.create();

        for (let i = 0; i < pages.length; i += 1) {
          const pageInfo = pages[i];
          if (pageInfo.contentBottom === null) {
            throw new Error(`Could not detect the order slip content on page ${pageInfo.number}.`);
          }

          const sourcePage = sourcePages[i];
          const { width: srcWidth, height: srcHeight } = sourcePage.getSize();
          const [embeddedPage] = await outputPdf.embedPdf(sourcePdf, [i]);
          const newPage = outputPdf.addPage([TARGET_WIDTH, TARGET_HEIGHT]);

          const scale = TARGET_WIDTH / srcWidth;
          const scaledHeight = srcHeight * scale;
          const pageY = TARGET_HEIGHT - scaledHeight;

          newPage.drawPage(embeddedPage, {
            x: 0,
            y: pageY,
            width: TARGET_WIDTH,
            height: scaledHeight,
          });

          const layout = measureNote(note.trim(), TARGET_WIDTH, fontSize, isBold, textAlign);
          const blockHeight = layout.imageHeight / layout.scale;
          const contentBottomInPoints = pageInfo.contentBottom * srcHeight * scale;
          const noteY = TARGET_HEIGHT - contentBottomInPoints - gap - blockHeight;

          if (noteY < 6) {
            throw new Error(`Note overflows the 4x6 label on slip ${pageInfo.number}. Decrease font size or shorten message.`);
          }

          const noteImage = createNoteImage(layout);
          const embeddedImage = await outputPdf.embedPng(noteImage.imageBytes);
          newPage.drawImage(embeddedImage, {
            x: (TARGET_WIDTH - noteImage.width) / 2,
            y: noteY,
            width: noteImage.width,
            height: blockHeight,
          });
        }
      } else {
        outputPdf = await PDFDocument.load(fileBytes);
        const pdfPages = outputPdf.getPages();

        for (const pageInfo of pages) {
          if (pageInfo.contentBottom === null) {
            throw new Error(`Could not detect the order slip content on page ${pageInfo.number}.`);
          }

          const page = pdfPages[pageInfo.number - 1];
          const { width, height } = page.getSize();
          const layout = measureNote(note.trim(), width, fontSize, isBold, textAlign);
          const blockHeight = layout.imageHeight / layout.scale;
          const contentBottom = pageInfo.contentBottom * height;

          if (contentBottom + gap + blockHeight > height - 12) {
            throw new Error(`There is not enough blank space below the slip on page ${pageInfo.number}. Decrease font size or shorten message.`);
          }

          const noteImage = createNoteImage(layout);
          const embeddedImage = await outputPdf.embedPng(noteImage.imageBytes);
          page.drawImage(embeddedImage, {
            x: (width - noteImage.width) / 2,
            y: height - contentBottom - gap - blockHeight,
            width: noteImage.width,
            height: blockHeight,
          });
        }
      }

      const bytes = await outputPdf.save();
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      const formatTag = is4x6 ? '-4x6-thermal' : '-with-note';
      link.download = `${file.name.replace(/\.pdf$/i, '')}${formatTag}.pdf`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (exportError) {
      setError(exportError?.message || 'The edited PDF could not be downloaded.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="./" aria-label="Slipnote home">
          <span className="brand-mark" aria-hidden="true">S</span>
          <span>slipnote</span>
        </a>
        <div className="privacy-badge"><span /> 100% Private &amp; Local</div>
      </header>

      {!file ? (
        <main className="welcome">
          <div className="welcome-copy">
            <div className="eyebrow"><span className="sparkle">✳</span> MADE FOR MEESHO SELLERS</div>
            <h1>Your order slip.<br /><span>Your custom note.</span></h1>
            <p>
              Add clear, readable notes beneath your Meesho order slips in seconds. Adjust text size, make it bold, preview in full page or 4×6″ thermal label format, and download ready-to-print PDFs.
            </p>
            <button className="primary-button upload-button" onClick={() => fileInputRef.current?.click()}>
              <UploadIcon /> Choose order PDF <span className="button-arrow">→</span>
            </button>
            <p className="file-hint">Your orders stay on this device. Nothing is ever uploaded or stored.</p>
            {error && <p className="error-message" role="alert">{error}</p>}
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="art-glow" />
            <div className="art-back-page"><span className="line long" /><span className="line" /><span className="line short" /></div>
            <div className="art-page">
              <span className="art-page-label">MEESHO ORDER SLIP</span>
              <span className="art-heading">Order packed<br />with care</span>
              <span className="line long" /><span className="line" /><span className="line short" />
              <span className="art-note">Thank you for shopping with us! ⭐</span>
            </div>
            <div className="art-pencil">✎</div>
            <div className="local-stamp"><LockIcon /><span>ONLY ON<br />YOUR DEVICE</span></div>
            <span className="art-star star-one">✳</span><span className="art-star star-two">✦</span>
          </div>
          <input ref={fileInputRef} className="visually-hidden" type="file" accept="application/pdf,.pdf" onChange={chooseFile} />
        </main>
      ) : (
        <>
          <main className="editor">
            <section className="editor-heading">
              <div>
                <div className="eyebrow">MEESHO ORDER EDITOR</div>
                <h1>Customize note &amp; preview slips</h1>
                <p>Format your message below. We’ll position it precisely in the blank space on every page.</p>
              </div>
              <button className="text-button" onClick={() => fileInputRef.current?.click()}>Choose another PDF</button>
              <input ref={fileInputRef} className="visually-hidden" type="file" accept="application/pdf,.pdf" onChange={chooseFile} />
            </section>

            <div className="editor-layout">
              {/* Left Column: Comprehensive Text Tools */}
              <aside className="tools-panel">
                <div className="panel-title">TEXT &amp; STYLING TOOLS</div>

                {/* Message Input */}
                <div className="field-group">
                  <div className="field-header">
                    <label className="field-label" htmlFor="order-note">Message text</label>
                    <span className="char-count">{note.length}/500</span>
                  </div>
                  <textarea
                    id="order-note"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    rows="4"
                    maxLength="500"
                    placeholder="e.g. Thank you for your order! Please rate us 5 stars on Meesho."
                  />
                </div>

                {/* Quick Templates */}
                <div className="field-group templates-group">
                  <span className="subfield-label">Quick templates</span>
                  <div className="template-chips">
                    {NOTE_TEMPLATES.map((tmpl) => (
                      <button
                        key={tmpl}
                        type="button"
                        className="template-chip"
                        onClick={() => setNote(tmpl)}
                        title="Click to use this template"
                      >
                        {tmpl}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="panel-divider" />

                {/* Text Size Control */}
                <div className="field-group">
                  <div className="field-header">
                    <span className="subfield-label">Text Size</span>
                    <span className="value-pill">{fontSize} pt</span>
                  </div>
                  <div className="control-row">
                    <button
                      type="button"
                      className="stepper-btn"
                      onClick={() => setFontSize((s) => Math.max(10, s - 2))}
                      disabled={fontSize <= 10}
                      title="Decrease text size"
                    >
                      －
                    </button>
                    <div className="size-presets">
                      {[12, 16, 20, 24, 28].map((size) => (
                        <button
                          key={size}
                          type="button"
                          className={`preset-btn ${fontSize === size ? 'active' : ''}`}
                          onClick={() => setFontSize(size)}
                        >
                          {size}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="stepper-btn"
                      onClick={() => setFontSize((s) => Math.min(36, s + 2))}
                      disabled={fontSize >= 36}
                      title="Increase text size"
                    >
                      ＋
                    </button>
                  </div>
                </div>

                {/* Text Weight: Bold / Standard */}
                <div className="field-group">
                  <span className="subfield-label">Font Weight</span>
                  <div className="toggle-group">
                    <button
                      type="button"
                      className={`toggle-option ${!isBold ? 'active' : ''}`}
                      onClick={() => setIsBold(false)}
                    >
                      Standard
                    </button>
                    <button
                      type="button"
                      className={`toggle-option bold-option ${isBold ? 'active' : ''}`}
                      onClick={() => setIsBold(true)}
                    >
                      <strong>𝗕 Bold</strong>
                    </button>
                  </div>
                </div>

                {/* Alignment */}
                <div className="field-group">
                  <span className="subfield-label">Alignment</span>
                  <div className="toggle-group align-group">
                    <button
                      type="button"
                      className={`toggle-option ${textAlign === 'left' ? 'active' : ''}`}
                      onClick={() => setTextAlign('left')}
                      title="Align Left"
                    >
                      Left
                    </button>
                    <button
                      type="button"
                      className={`toggle-option ${textAlign === 'center' ? 'active' : ''}`}
                      onClick={() => setTextAlign('center')}
                      title="Align Center"
                    >
                      Center
                    </button>
                    <button
                      type="button"
                      className={`toggle-option ${textAlign === 'right' ? 'active' : ''}`}
                      onClick={() => setTextAlign('right')}
                      title="Align Right"
                    >
                      Right
                    </button>
                  </div>
                </div>

                {/* Vertical Gap from Slip */}
                <div className="field-group">
                  <div className="field-header">
                    <span className="subfield-label">Distance below slip</span>
                    <span className="value-pill">{gap} pt</span>
                  </div>
                  <div className="control-row">
                    <button
                      type="button"
                      className="stepper-btn"
                      onClick={() => setGap((g) => Math.max(4, g - 2))}
                      disabled={gap <= 4}
                      title="Decrease distance"
                    >
                      －
                    </button>
                    <input
                      type="range"
                      min="4"
                      max="32"
                      step="2"
                      value={gap}
                      onChange={(e) => setGap(Number(e.target.value))}
                      className="slider-input"
                    />
                    <button
                      type="button"
                      className="stepper-btn"
                      onClick={() => setGap((g) => Math.min(32, g + 2))}
                      disabled={gap >= 32}
                      title="Increase distance"
                    >
                      ＋
                    </button>
                  </div>
                </div>

                {/* Real-time Fit Status */}
                {note.trim() && (
                  <div className={`fit-status-banner ${fitAnalysis.fits ? 'fits-ok' : 'fits-warn'}`}>
                    {fitAnalysis.fits ? (
                      <>
                        <CheckIcon />
                        <span>Fits comfortably on all {pages.length} slips</span>
                      </>
                    ) : (
                      <>
                        <WarningIcon />
                        <span>Tight fit on slip {fitAnalysis.overflowingPages.join(', ')}. Decrease font size if needed.</span>
                      </>
                    )}
                  </div>
                )}

                <div className="panel-divider" />
                <div className="privacy-note">
                  <LockIcon />
                  <span>Processing is 100% in your browser memory. Your customer details and PDFs are never sent anywhere.</span>
                </div>
                {error && <p className="error-message editor-error" role="alert">{error}</p>}
              </aside>

              {/* Right Column: Horizontal Full-Page PDF Preview */}
              <section className="document-area" aria-label="Order PDF preview">
                {/* Document Toolbar */}
                <div className="document-toolbar">
                  <div className="file-info-cluster">
                    <PdfIcon />
                    <span className="file-name-label" title={file.name}>{file.name}</span>
                    <span className="page-count-badge">
                      {pages.length ? `${pages.length} ${pages.length === 1 ? 'slip' : 'slips'}` : 'Loading...'}
                    </span>
                  </div>

                  {/* Horizontal Page Navigation (when multiple pages) */}
                  {pages.length > 1 && (
                    <div className="page-navigator">
                      <button
                        type="button"
                        className="nav-arrow-btn"
                        onClick={() => goToPage(activePageIndex - 1)}
                        disabled={activePageIndex === 0}
                        title="Previous slip (Left Arrow)"
                      >
                        ‹
                      </button>
                      <span className="page-nav-status">
                        Slip {activePageIndex + 1} of {pages.length}
                      </span>
                      <button
                        type="button"
                        className="nav-arrow-btn"
                        onClick={() => goToPage(activePageIndex + 1)}
                        disabled={activePageIndex === pages.length - 1}
                        title="Next slip (Right Arrow)"
                      >
                        ›
                      </button>
                    </div>
                  )}

                  {/* Format Selector: Full Page vs 4x6 Inches */}
                  <div className="format-switcher">
                    <button
                      type="button"
                      className={`format-btn ${previewFormat === 'full' ? 'active' : ''}`}
                      onClick={() => setPreviewFormat('full')}
                      title="Show original full page format"
                    >
                      <PageIcon /> Full Page
                    </button>
                    <button
                      type="button"
                      className={`format-btn ${previewFormat === '4x6' ? 'active' : ''}`}
                      onClick={() => setPreviewFormat('4x6')}
                      title="Show 4x6 inches thermal label format"
                    >
                      <ThermalIcon /> 4×6″ Thermal
                    </button>
                  </div>
                </div>

                {/* Horizontal Full Page Preview Viewport */}
                {loading ? (
                  <div className="loading-state">
                    <span className="spinner" /> Rendering order slips...
                  </div>
                ) : error && !pages.length ? (
                  <div className="loading-state error-message" role="alert">{error}</div>
                ) : (
                  <div className="horizontal-preview-container">
                    <div
                      className="horizontal-pages-track"
                      ref={previewTrackRef}
                      onScroll={handleTrackScroll}
                    >
                      {pages.map((page, index) => {
                        const is4x6 = previewFormat === '4x6';
                        // For 4x6 preview, height ratio of page canvas relative to 4x6 (ratio 4/6 = 0.667)
                        const pageCanvasHeightRatio = is4x6
                          ? Math.min(100, ((page.pdfHeight / page.pdfWidth) / 1.5) * 100)
                          : 100;

                        return (
                          <div
                            key={page.number}
                            className={`preview-page-slide ${index === activePageIndex ? 'is-active' : ''}`}
                            id={`page-slide-${index}`}
                          >
                            <div className="preview-card-frame">
                              {/* 4x6 Thermal Header Pill */}
                              {is4x6 && (
                                <div className="thermal-badge">
                                  <ThermalIcon /> 4 × 6 INCH · THERMAL LABEL (100 × 150 mm)
                                </div>
                              )}

                              {/* Canvas Wrap: Constrained by max-height so full page is visible */}
                              <div
                                className={`page-canvas-wrap ${is4x6 ? 'thermal-frame' : 'full-frame'}`}
                                style={{
                                  aspectRatio: is4x6 ? '4 / 6' : `${page.width} / ${page.height}`,
                                }}
                              >
                                <div
                                  className="page-sheet-container"
                                  style={{
                                    width: '100%',
                                    height: `${pageCanvasHeightRatio}%`,
                                    position: 'relative',
                                  }}
                                >
                                  <PageSlideCanvas pageCanvas={page.canvas} />

                                  {/* Note Preview Overlay */}
                                  {note.trim() && page.contentBottom !== null && (
                                    <div
                                      className="pdf-note-preview"
                                      style={{
                                        top: `calc(${page.contentBottom * 100}% + ${(gap / page.pdfHeight) * 100}%)`,
                                        fontSize: is4x6
                                          ? `calc(${(fontSize / 288) * 100}cqw)`
                                          : `calc(${(fontSize / page.pdfWidth) * 100}cqw)`,
                                        fontWeight: isBold ? '700' : '400',
                                        textAlign: textAlign,
                                      }}
                                    >
                                      {note.trim()}
                                    </div>
                                  )}
                                </div>
                              </div>

                              <div className="slide-footer">
                                <span className="slip-pill">Slip {page.number}</span>
                                {is4x6 && <span className="thermal-subtext">Thermal roll ready</span>}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Quick Page Jump Pills (when > 1 page) */}
                    {pages.length > 1 && (
                      <div className="page-thumbnails-bar">
                        {pages.map((p, idx) => (
                          <button
                            key={p.number}
                            type="button"
                            className={`thumb-pill ${idx === activePageIndex ? 'active' : ''}`}
                            onClick={() => goToPage(idx)}
                          >
                            Slip {p.number}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </section>
            </div>
          </main>

          {/* Bottom Action / Download Bar */}
          <footer className="download-bar">
            <div className="download-info">
              <LockIcon />
              <span>
                Local only · {pages.length} {pages.length === 1 ? 'slip' : 'slips'} ready
                {previewFormat === '4x6' ? ' in 4×6″ format' : ''}
              </span>
            </div>

            <div className="download-actions">
              <button
                className="secondary-download-btn"
                onClick={() => downloadPdf(previewFormat === '4x6' ? 'full' : '4x6')}
                disabled={loading || exporting || !note.trim()}
                title={previewFormat === '4x6' ? 'Download as original full page size' : 'Download formatted for 4x6 thermal paper'}
              >
                {previewFormat === '4x6' ? 'Download Original (Full)' : 'Download 4×6″ Thermal'}
              </button>

              <button
                className="primary-button download-button"
                onClick={() => downloadPdf(previewFormat)}
                disabled={loading || exporting || !note.trim()}
              >
                {exporting ? (
                  'Generating PDF…'
                ) : (
                  <>
                    <DownloadIcon />
                    <span>Download updated orders ({previewFormat === '4x6' ? '4×6″ Thermal' : 'Full Page'})</span>
                  </>
                )}
              </button>
            </div>
          </footer>
        </>
      )}

      {!file && (
        <footer className="landing-footer">
          <span>Made for your Meesho orders, not our servers.</span>
          <span>100% client-side · Works completely offline</span>
        </footer>
      )}
    </div>
  );
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 16V4m0 0L7 9m5-5 5 5M5 15v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4v12m0 0 5-5m-5 5-5-5M5 18v2h14v-2" />
    </svg>
  );
}

function PdfIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 2h8l5 5v15H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" />
      <path d="M14 2v6h6M7 16h10M7 12h5" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function PageIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <line x1="9" y1="7" x2="15" y2="7" />
      <line x1="9" y1="11" x2="15" y2="11" />
    </svg>
  );
}

function ThermalIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="2" width="12" height="18" rx="2" />
      <line x1="9" y1="6" x2="15" y2="6" />
      <line x1="9" y1="10" x2="15" y2="10" />
      <circle cx="12" cy="15" r="1" />
    </svg>
  );
}

export default App;
