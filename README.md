# Slipnote — Meesho Order PDF Notes

Slipnote is a specialized browser-based tool for Meesho e-commerce sellers. Select a Meesho order PDF, type a customer message, customize typography, preview its placement beneath each slip in full page or 4×6″ thermal format, and download ready-to-print PDFs.

---

## ✨ Features

- **Text & Typography Controls**:
  - **Font Size**: Adjustable from 10 pt to 36 pt with steppers and quick presets (`12 pt`, `16 pt`, `20 pt`, `24 pt`, `28 pt`). Default increased to 16 pt for clear readability.
  - **Font Weight**: One-click toggle between **Standard** and **Bold**.
  - **Alignment**: Align text **Left**, **Center**, or **Right**.
  - **Spacing**: Fine-tune vertical distance below the order slip.
  - **Quick Templates**: One-click starter messages for ratings, customer care, and thank-you notes.
  - **Real-Time Fit Guard**: Visual status indicator alerts you if your note is too long for the available blank space on any slip.

- **Horizontal Full-Page Preview**:
  - Pages are arranged horizontally rather than in a long vertical scroll list.
  - Full-page viewport constraint ensures each slip (from header to note) is 100% visible on screen without vertical cut-off.
  - Smooth page navigation with **‹ Previous** and **Next ›** buttons, page indicator pills, and keyboard arrow keys (`←` / `→`).

- **4×6 Inches Thermal Format**:
  - **Thermal Preview Mode**: Switch between **Full Page (Original)** and **4×6″ Thermal Label** (100 × 150 mm) format with true 4:6 aspect ratio.
  - **Direct Thermal Export**: Download directly as a native 4×6″ thermal PDF (`288 × 432 pt`), perfect for TSC, TVS, Rollo, and other thermal sticker printers.

- **Crisp Unicode & Emoji Support**:
  - Notes are rasterized at $3\times$ high-resolution scale, ensuring full support for emojis (⭐, 📦, ❤️) and regional Indian scripts without font substitution issues.

---

## 🔒 Privacy & Local Processing

PDF files are read and edited 100% locally in your browser using [PDF.js](https://mozilla.github.io/pdf.js/) and [pdf-lib](https://pdf-lib.js.org/).
- No server, database, or API uploads.
- Your customer details and invoices never leave your device.
- Works completely offline after initial page load.

---

## 🚀 Run Locally

```sh
npm install
npm run dev
```

Build for production:
```sh
npm run build
```

The output in `dist/` is ready to be hosted on GitHub Pages or any static web host.
