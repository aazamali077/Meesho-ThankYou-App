import { useEffect, useRef, useState } from 'react';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const NOTE_FONT_SIZE = 12;
const NOTE_GAP = 10;
const NOTE_WIDTH_RATIO = 0.84;

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

function wrapText(text, font, fontSize, maxWidth) {
  const lines = [];
  for (const paragraph of text.split(/\r?\n/)) {
    if (!paragraph.trim()) {
      lines.push('');
      continue;
    }

    let line = '';
    for (const word of paragraph.trim().split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
        line = candidate;
        continue;
      }

      if (line) lines.push(line);
      line = '';
      for (const character of word) {
        const next = line + character;
        if (line && font.widthOfTextAtSize(next, fontSize) > maxWidth) {
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

function App() {
  const fileInputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [pages, setPages] = useState([]);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!file) return undefined;
    let cancelled = false;
    let loadingTask;

    async function loadPdf() {
      setLoading(true);
      setError('');
      setPages([]);
      setNote('');
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

        if (!cancelled) setPages(renderedPages);
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

  async function downloadPdf() {
    if (!file || !note.trim()) return;
    setExporting(true);
    setError('');
    try {
      const pdf = await PDFDocument.load(await file.arrayBuffer());
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      const pdfPages = pdf.getPages();
      const lineHeight = NOTE_FONT_SIZE * 1.35;

      for (const pageInfo of pages) {
        if (pageInfo.contentBottom === null) {
          throw new Error(`Could not detect the order slip content on page ${pageInfo.number}.`);
        }

        const page = pdfPages[pageInfo.number - 1];
        const { width, height } = page.getSize();
        const lines = wrapText(note.trim(), font, NOTE_FONT_SIZE, width * NOTE_WIDTH_RATIO);
        const blockHeight = lines.length * lineHeight;
        const contentBottom = pageInfo.contentBottom * height;
        if (contentBottom + NOTE_GAP + blockHeight > height - 12) {
          throw new Error(`There is not enough blank space below the slip on page ${pageInfo.number}. Shorten the text to fit.`);
        }

        lines.forEach((line, index) => {
          const textWidth = font.widthOfTextAtSize(line, NOTE_FONT_SIZE);
          page.drawText(line, {
            x: (width - textWidth) / 2,
            y: height - contentBottom - NOTE_GAP - NOTE_FONT_SIZE - index * lineHeight,
            size: NOTE_FONT_SIZE,
            font,
            color: rgb(0.13, 0.14, 0.13),
          });
        });
      }

      const bytes = await pdf.save();
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${file.name.replace(/\.pdf$/i, '')}-with-note.pdf`;
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
        <div className="privacy-badge"><span /> Private &amp; local</div>
      </header>

      {!file ? (
        <main className="welcome">
          <div className="welcome-copy">
            <div className="eyebrow"><span className="sparkle">✳</span> MADE FOR MEESHO SELLERS</div>
            <h1>Your order slip.<br /><span>Your message.</span></h1>
            <p>Add a note beneath your Meesho order slips in seconds. Type once, see it placed below each slip, and download your updated PDF.</p>
            <button className="primary-button upload-button" onClick={() => fileInputRef.current?.click()}>
              <UploadIcon /> Choose order PDF <span className="button-arrow">→</span>
            </button>
            <p className="file-hint">Your orders stay on this device. Nothing is uploaded.</p>
            {error && <p className="error-message" role="alert">{error}</p>}
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="art-glow" />
            <div className="art-back-page"><span className="line long" /><span className="line" /><span className="line short" /></div>
            <div className="art-page">
              <span className="art-page-label">MEESHO ORDER SLIP</span>
              <span className="art-heading">Order packed<br />with care</span>
              <span className="line long" /><span className="line" /><span className="line short" />
              <span className="art-note">Thank you for shopping with us!</span>
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
                <div className="eyebrow">MEESHO ORDER PDF</div>
                <h1>Add a note below your slips.</h1>
                <p>Enter your message once. We’ll place it in the blank space on each page.</p>
              </div>
              <button className="text-button" onClick={() => fileInputRef.current?.click()}>Choose another PDF</button>
              <input ref={fileInputRef} className="visually-hidden" type="file" accept="application/pdf,.pdf" onChange={chooseFile} />
            </section>
            <div className="editor-layout">
              <aside className="tools-panel">
                <div className="panel-title">YOUR MESSAGE</div>
                <label className="field-label" htmlFor="order-note">Text to add</label>
                <textarea
                  id="order-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows="5"
                  maxLength="500"
                  placeholder="e.g. Thank you for your order! We hope you love it."
                />
                <div className="note-guidance">Your message will be centered beneath the slip on every page.</div>
                <div className="panel-divider" />
                <div className="privacy-note"><LockIcon /><span>Everything is processed in your browser. Your order PDF is never uploaded or saved.</span></div>
                {error && <p className="error-message editor-error" role="alert">{error}</p>}
              </aside>
              <section className="document-area" aria-label="Order PDF preview">
                <div className="document-toolbar">
                  <div className="file-name"><PdfIcon /> <span title={file.name}>{file.name}</span></div>
                  <span className="page-count">{pages.length ? `${pages.length} ${pages.length === 1 ? 'page' : 'pages'}` : 'Loading...'}</span>
                </div>
                {loading ? (
                  <div className="loading-state"><span className="spinner" /> Opening your order PDF...</div>
                ) : error && !pages.length ? (
                  <div className="loading-state error-message" role="alert">{error}</div>
                ) : (
                  <div className="pages-list">
                    {pages.map((page) => (
                      <div className="pdf-page" key={page.number}>
                        <div
                          className="page-canvas-wrap"
                          style={{ width: `min(100%, ${page.width}px)`, aspectRatio: `${page.width} / ${page.height}` }}
                        >
                          <canvas
                            ref={(element) => {
                              if (element && element.dataset.page !== String(page.number)) {
                                element.width = page.canvas.width;
                                element.height = page.canvas.height;
                                element.dataset.page = String(page.number);
                                element.getContext('2d')?.drawImage(page.canvas, 0, 0);
                              }
                            }}
                          />
                          {note.trim() && page.contentBottom !== null && (
                            <div
                              className="pdf-note-preview"
                              style={{
                                top: `calc(${page.contentBottom * 100}% + ${NOTE_GAP / page.pdfHeight * 100}%)`,
                                fontSize: `clamp(8px, ${NOTE_FONT_SIZE / page.pdfWidth * 100}cqw, ${NOTE_FONT_SIZE * 2}px)`,
                              }}
                            >{note.trim()}</div>
                          )}
                        </div>
                        <span className="page-number">ORDER SLIP {page.number}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </main>
          <footer className="download-bar">
            <div><LockIcon /><span>Local only · Note added automatically on each page</span></div>
            <button className="primary-button download-button" onClick={downloadPdf} disabled={loading || exporting || !note.trim()}>
              {exporting ? 'Preparing PDF…' : <><DownloadIcon /> Download updated orders</>}
            </button>
          </footer>
        </>
      )}
      {!file && <footer className="landing-footer"><span>Made for your orders, not our servers.</span><span>100% local · Always private</span></footer>}
    </div>
  );
}

function UploadIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0L7 9m5-5 5 5M5 15v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4" /></svg>;
}

function DownloadIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v12m0 0 5-5m-5 5-5-5M5 18v2h14v-2" /></svg>;
}

function PdfIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h8l5 5v15H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" /><path d="M14 2v6h6M7 16h10M7 12h5" /></svg>;
}

function LockIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" /></svg>;
}

export default App;
