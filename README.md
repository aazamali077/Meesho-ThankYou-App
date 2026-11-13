# Slipnote — Meesho Order PDF Notes

Choose a Meesho order PDF, type a message, preview its automatic placement beneath the slip on every page, and download the updated PDF. The message is centered and uses a readable 12 pt size.

The editor detects the last visible printed content on each page and positions the message beneath it. If the PDF page has no detectable printed content or insufficient room, the editor reports an error instead of placing text over the slip.

## Privacy

PDF files are read and edited in your browser using PDF.js and pdf-lib. This app has no API, Express server, MongoDB database, account system, or upload flow. It also uses system fonts and makes no external font requests. The source PDF and edits are held only in browser memory; downloading explicitly writes the edited copy to the location chosen by your browser.

## Run locally

```sh
npm install
npm run dev
```

Create a production build with `npm run build`. The generated `dist/` folder can be deployed to GitHub Pages or another static host.

## GitHub Pages

Vite is configured with a relative base path, so the built files work when hosted from a project repository subpath. Configure GitHub Pages to deploy the `dist/` folder (for example, with a GitHub Actions Pages workflow).
