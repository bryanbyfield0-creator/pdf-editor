/* Weeshee PDF Editor. Files never leave this device. */
(() => {
  "use strict";

  const { PDFDocument, rgb, degrees, StandardFonts, LineCapStyle, LineJoinStyle, PDFName, PDFRawStream } = PDFLib;

  pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";

  const HANDLE_DIRS = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  const LETTER = [612, 792];
  const A4 = [595.28, 841.89];

  const els = {
    openBtn: document.getElementById("open-btn"),
    mergeBtn: document.getElementById("merge-btn"),
    downloadBtn: document.getElementById("download-btn"),
    compressChk: document.getElementById("compress-chk"),
    undoBtn: document.getElementById("undo-btn"),
    deleteAnnotBtn: document.getElementById("delete-annot-btn"),
    rotateBtn: document.getElementById("rotate-btn"),
    deletePageBtn: document.getElementById("delete-page-btn"),
    pageSize: document.getElementById("page-size"),
    pagePercent: document.getElementById("page-percent"),
    pagePercentWrap: document.getElementById("page-percent-wrap"),
    pageLandscape: document.getElementById("page-landscape"),
    pageSizeAll: document.getElementById("page-size-all"),
    fileInput: document.getElementById("file-input"),
    mergeInput: document.getElementById("merge-input"),
    imageInput: document.getElementById("image-input"),
    fontSize: document.getElementById("font-size"),
    inkColor: document.getElementById("ink-color"),
    highlightColor: document.getElementById("highlight-color"),
    strokeWidth: document.getElementById("stroke-width"),
    viewer: document.getElementById("viewer"),
    thumbs: document.getElementById("thumbs"),
    dropHint: document.getElementById("drop-hint"),
    fileLabel: document.getElementById("file-label"),
    zoomLabel: document.getElementById("zoom-label"),
    zoomIn: document.getElementById("zoom-in"),
    zoomOut: document.getElementById("zoom-out"),
    tip: document.getElementById("tip"),
    tipClose: document.getElementById("tip-close"),
    status: document.getElementById("status"),
  };

  const sources = new Map();
  const state = {
    fileName: "document.pdf",
    pages: [],
    formValues: {},
    tool: "select",
    color: "#111827",
    highlightColor: "#ffe566",
    fontSize: 16,
    strokeWidth: 2.5,
    selected: null,
    currentPageId: null,
    zoom: 1,
    undoStack: [],
    pendingImage: null,
    rendering: false,
    compress: false,
  };

  let statusTimer = 0;
  let syncingPaperUi = false;

  function uid(prefix = "id") {
    return prefix + "-" + Math.random().toString(36).slice(2, 10);
  }

  function hexToRgb(hex) {
    const n = hex.replace("#", "");
    const v = n.length === 3
      ? n.split("").map((c) => parseInt(c + c, 16))
      : [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
    return rgb(v[0] / 255, v[1] / 255, v[2] / 255);
  }

  function showStatus(msg, isError = false) {
    els.status.textContent = msg;
    els.status.hidden = false;
    els.status.classList.toggle("error", isError);
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { els.status.hidden = true; }, 3200);
  }

  function defaultPaper() {
    return { type: "original", value: 100, landscape: false };
  }

  function cloneState() {
    return JSON.parse(JSON.stringify({
      pages: state.pages.map((p) => ({
        id: p.id,
        sourceId: p.sourceId,
        srcIndex: p.srcIndex,
        rotation: p.rotation,
        visualWidth: p.visualWidth,
        visualHeight: p.visualHeight,
        annotations: p.annotations,
        paper: p.paper || defaultPaper(),
      })),
      formValues: state.formValues,
      fileName: state.fileName,
      currentPageId: state.currentPageId,
    }));
  }

  function pushUndo() {
    state.undoStack.push(cloneState());
    if (state.undoStack.length > 40) state.undoStack.shift();
    els.undoBtn.disabled = false;
  }

  function pageById(id) {
    return state.pages.find((p) => p.id === id);
  }

  function annotById(page, id) {
    return page && page.annotations.find((a) => a.id === id);
  }

  function pageLayout(pageState) {
    const visW = pageState.visualWidth || 612;
    const visH = pageState.visualHeight || 792;
    const paper = pageState.paper || defaultPaper();
    let paperW = visW;
    let paperH = visH;
    let scale = 1;
    let ox = 0;
    let oy = 0;
    if (paper.type === "percent") {
      scale = Math.max(0.25, Math.min(4, (Number(paper.value) || 100) / 100));
      paperW = visW * scale;
      paperH = visH * scale;
    } else if (paper.type === "letter" || paper.type === "a4") {
      let [w, h] = paper.type === "a4" ? A4 : LETTER;
      if (paper.landscape) [w, h] = [h, w];
      scale = Math.min(w / visW, h / visH);
      paperW = w;
      paperH = h;
      ox = (w - visW * scale) / 2;
      oy = (h - visH * scale) / 2;
    }
    return { paperW, paperH, scale, ox, oy, visW, visH };
  }

  function setTool(tool) {
    state.tool = tool;
    document.querySelectorAll(".tool[data-tool]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tool === tool);
    });
    els.viewer.style.cursor = tool === "select" ? "default" : "crosshair";
  }

  function setSelected(pageId, annotId) {
    state.selected = annotId ? { pageId, annotId } : null;
    els.deleteAnnotBtn.disabled = !state.selected;
    document.querySelectorAll(".annot").forEach((node) => {
      const on = state.selected && node.dataset.annotId === annotId && node.dataset.pageId === pageId;
      node.classList.toggle("selected", Boolean(on));
    });
  }

  function updateChrome() {
    const hasPages = state.pages.length > 0;
    els.mergeBtn.disabled = !hasPages;
    els.downloadBtn.disabled = !hasPages;
    els.rotateBtn.disabled = !hasPages;
    els.deletePageBtn.disabled = !hasPages;
    els.pageSize.disabled = !hasPages;
    els.undoBtn.disabled = state.undoStack.length === 0;
    els.deleteAnnotBtn.disabled = !state.selected;
    els.fileLabel.textContent = hasPages
      ? `${state.fileName} · ${state.pages.length} page${state.pages.length === 1 ? "" : "s"}`
      : "No file open";
    els.zoomLabel.textContent = Math.round(state.zoom * 100) + "%";
    els.dropHint.hidden = hasPages;
    syncPaperUi();
  }

  function syncPaperUi() {
    const page = pageById(state.currentPageId) || state.pages[0];
    const paper = (page && page.paper) || defaultPaper();
    syncingPaperUi = true;
    els.pageSize.value = paper.type || "original";
    els.pagePercent.value = paper.value || 100;
    els.pageLandscape.checked = Boolean(paper.landscape);
    els.pagePercentWrap.hidden = paper.type !== "percent";
    const paperShape = paper.type === "letter" || paper.type === "a4";
    els.pageLandscape.disabled = !state.pages.length || !paperShape;
    syncingPaperUi = false;
  }

  function paperTargets() {
    if (els.pageSizeAll.checked) return state.pages.slice();
    const page = pageById(state.currentPageId) || state.pages[0];
    return page ? [page] : [];
  }

  function applyPaperFromUi() {
    if (syncingPaperUi || !state.pages.length) return;
    pushUndo();
    const type = els.pageSize.value;
    const landscape = els.pageLandscape.checked;
    const value = Math.max(25, Math.min(400, Number(els.pagePercent.value) || 100));
    for (const page of paperTargets()) {
      if (type === "original") page.paper = defaultPaper();
      else if (type === "percent") page.paper = { type: "percent", value, landscape: false };
      else page.paper = { type, value: 100, landscape };
    }
    els.pagePercentWrap.hidden = type !== "percent";
    els.pageLandscape.disabled = type !== "letter" && type !== "a4";
    renderAll();
    updateChrome();
  }

  async function bytesOf(file) {
    return new Uint8Array(await file.arrayBuffer());
  }

  async function loadSource(bytes, name) {
    const sourceId = uid("src");
    const pdfJsDoc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    const pdfLibDoc = await PDFDocument.load(bytes.slice(), { ignoreEncryption: true });
    if (pdfLibDoc.isEncrypted) {
      throw new Error("This PDF is password-protected and cannot be opened here.");
    }
    const source = { id: sourceId, name, bytes, pdfJsDoc, pdfLibDoc };
    sources.set(sourceId, source);
    return source;
  }

  async function visualSize(source, srcIndex, extraRot) {
    const page = await source.pdfJsDoc.getPage(srcIndex + 1);
    const rotation = ((page.rotate || 0) + (extraRot || 0) + 360) % 360;
    const vp = page.getViewport({ scale: 1, rotation });
    return { width: vp.width, height: vp.height };
  }

  async function openPdf(file, merge) {
    try {
      showStatus(merge ? "Adding PDF…" : "Opening PDF…");
      const bytes = await bytesOf(file);
      const source = await loadSource(bytes, file.name || "document.pdf");
      if (!merge) {
        state.pages = [];
        state.formValues = {};
        state.undoStack = [];
        state.selected = null;
        state.currentPageId = null;
        state.fileName = source.name.replace(/\.pdf$/i, "") + "-edited.pdf";
        sources.clear();
        sources.set(source.id, source);
      } else {
        pushUndo();
      }
      const count = source.pdfJsDoc.numPages;
      for (let i = 0; i < count; i++) {
        const size = await visualSize(source, i, 0);
        const page = {
          id: uid("page"),
          sourceId: source.id,
          srcIndex: i,
          rotation: 0,
          visualWidth: size.width,
          visualHeight: size.height,
          annotations: [],
          paper: defaultPaper(),
        };
        state.pages.push(page);
        if (!state.currentPageId) state.currentPageId = page.id;
      }
      await readFormDefaults(source);
      fitZoom();
      await renderAll();
      updateChrome();
      showStatus(merge ? `Added ${count} page${count === 1 ? "" : "s"}.` : "PDF opened. Everything stays on this device.");
    } catch (err) {
      console.error(err);
      showStatus(err.message || "Could not open that PDF.", true);
    }
  }

  async function readFormDefaults(source) {
    try {
      const form = source.pdfLibDoc.getForm();
      for (const field of form.getFields()) {
        const name = field.getName();
        const key = source.id + ":" + name;
        if (state.formValues[key] !== undefined) continue;
        const ctor = field.constructor && field.constructor.name;
        try {
          if (ctor === "PDFTextField" || (field.getText && !field.getOptions)) {
            state.formValues[key] = field.getText() || "";
          } else if (ctor === "PDFCheckBox" || field.isChecked) {
            state.formValues[key] = field.isChecked() ? "1" : "0";
          } else if (ctor === "PDFDropdown" || ctor === "PDFOptionList" || field.getSelected) {
            const sel = field.getSelected();
            state.formValues[key] = Array.isArray(sel) ? (sel[0] || "") : (sel || "");
          }
        } catch (_) { /* skip unusual field types */ }
      }
    } catch (_) { /* no form */ }
  }

  function fitZoom() {
    if (!state.pages.length) return;
    const maxW = Math.max(...state.pages.map((p) => pageLayout(p).paperW));
    const wrap = els.viewer.clientWidth - 32;
    if (maxW > 0 && wrap > 0) {
      state.zoom = Math.max(0.4, Math.min(1.6, wrap / maxW));
    }
  }

  async function renderAll() {
    if (state.rendering) {
      state.needsRerender = true;
      return;
    }
    state.rendering = true;
    try {
      els.viewer.querySelectorAll(".page-wrap").forEach((n) => n.remove());
      if (!state.pages.length) {
        els.dropHint.hidden = false;
        els.thumbs.innerHTML = "";
        return;
      }
      els.dropHint.hidden = true;
      for (const page of state.pages) {
        await renderPage(page);
      }
      renderThumbs();
      if (state.selected) setSelected(state.selected.pageId, state.selected.annotId);
    } finally {
      state.rendering = false;
      if (state.needsRerender) {
        state.needsRerender = false;
        await renderAll();
      }
    }
  }

  async function renderPage(pageState) {
    const source = sources.get(pageState.sourceId);
    if (!source) return;
    const size = await visualSize(source, pageState.srcIndex, pageState.rotation);
    pageState.visualWidth = size.width;
    pageState.visualHeight = size.height;
    const layout = pageLayout(pageState);
    const zoom = state.zoom;
    const pdfPage = await source.pdfJsDoc.getPage(pageState.srcIndex + 1);
    const rotation = ((pdfPage.rotate || 0) + pageState.rotation + 360) % 360;

    const wrap = document.createElement("div");
    wrap.className = "page-wrap";
    wrap.dataset.pageId = pageState.id;
    wrap.dataset.testid = "page-" + pageState.id;
    wrap.style.width = layout.paperW * zoom + "px";
    wrap.style.height = layout.paperH * zoom + "px";

    const canvas = document.createElement("canvas");
    canvas.className = "pdf-canvas";
    canvas.width = Math.max(1, Math.floor(layout.paperW * zoom));
    canvas.height = Math.max(1, Math.floor(layout.paperH * zoom));
    wrap.appendChild(canvas);

    const layer = document.createElement("div");
    layer.className = "annot-layer";
    layer.dataset.pageId = pageState.id;
    wrap.appendChild(layer);

    els.viewer.appendChild(wrap);

    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const viewport = pdfPage.getViewport({ scale: zoom * layout.scale, rotation });
    await pdfPage.render({
      canvasContext: ctx,
      viewport,
      transform: [1, 0, 0, 1, layout.ox * zoom, layout.oy * zoom],
    }).promise;

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.classList.add("draw-svg");
    svg.setAttribute("viewBox", `0 0 ${layout.visW} ${layout.visH}`);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.style.left = layout.ox * zoom + "px";
    svg.style.top = layout.oy * zoom + "px";
    svg.style.width = layout.visW * layout.scale * zoom + "px";
    svg.style.height = layout.visH * layout.scale * zoom + "px";
    layer.appendChild(svg);

    for (const annot of pageState.annotations) {
      paintAnnot(layer, svg, pageState, annot, layout, zoom);
    }

    await paintFormFields(layer, pdfPage, rotation, pageState, layout, zoom);
    bindPagePointers(wrap, layer, pageState, layout, zoom);
  }

  function contentStyle(x, y, w, h, layout, zoom) {
    return {
      left: (layout.ox + x * layout.scale) * zoom + "px",
      top: (layout.oy + y * layout.scale) * zoom + "px",
      width: w * layout.scale * zoom + "px",
      height: h * layout.scale * zoom + "px",
    };
  }

  function applyContentStyle(node, x, y, w, h, layout, zoom) {
    const s = contentStyle(x, y, w, h, layout, zoom);
    node.style.left = s.left;
    node.style.top = s.top;
    node.style.width = s.width;
    node.style.height = s.height;
  }

  function drawBBox(annot) {
    const pad = (annot.width || 2) / 2 + 2;
    const xs = annot.points.map((p) => p.x);
    const ys = annot.points.map((p) => p.y);
    const x = Math.min(...xs) - pad;
    const y = Math.min(...ys) - pad;
    return {
      x,
      y,
      w: Math.max(...xs) - x + pad,
      h: Math.max(...ys) - y + pad,
    };
  }

  function addHandles(node, pageState, annot, layout, zoom) {
    for (const dir of HANDLE_DIRS) {
      const handle = document.createElement("div");
      handle.className = "handle handle-" + dir;
      handle.dataset.handle = dir;
      handle.dataset.testid = "resize-" + dir + "-" + annot.id;
      handle.addEventListener("pointerdown", (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        setSelected(pageState.id, annot.id);
        beginResize(ev, pageState, annot, layout, zoom, node, dir);
      });
      node.appendChild(handle);
    }
  }

  function paintAnnot(layer, svg, pageState, annot, layout, zoom) {
    if (annot.type === "draw") {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", pointsToPath(annot.points));
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", annot.color);
      path.setAttribute("stroke-width", String(annot.width));
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      path.style.pointerEvents = "stroke";
      path.style.cursor = "move";
      path.dataset.annotId = annot.id;
      path.dataset.pageId = pageState.id;
      path.addEventListener("pointerdown", (ev) => {
        if (state.tool !== "select") return;
        ev.stopPropagation();
        ev.preventDefault();
        setSelected(pageState.id, annot.id);
        beginMove(ev, pageState, annot, layout, zoom);
      });
      svg.appendChild(path);

      const box = drawBBox(annot);
      const frame = document.createElement("div");
      frame.className = "annot draw-frame";
      frame.dataset.annotId = annot.id;
      frame.dataset.pageId = pageState.id;
      applyContentStyle(frame, box.x, box.y, box.w, box.h, layout, zoom);
      addHandles(frame, pageState, annot, layout, zoom);
      frame.addEventListener("pointerdown", (ev) => {
        if (ev.target.closest(".handle")) return;
        ev.stopPropagation();
        ev.preventDefault();
        setSelected(pageState.id, annot.id);
        beginMove(ev, pageState, annot, layout, zoom, frame);
      });
      layer.appendChild(frame);
      return;
    }

    const node = document.createElement("div");
    node.className = "annot " + annot.type;
    node.dataset.annotId = annot.id;
    node.dataset.pageId = pageState.id;
    applyContentStyle(node, annot.x, annot.y, annot.w, annot.h, layout, zoom);

    if (annot.type === "text") {
      node.contentEditable = "true";
      node.spellcheck = false;
      node.textContent = annot.text;
      node.style.fontSize = annot.size * layout.scale * zoom + "px";
      node.style.color = annot.color;
      node.addEventListener("input", () => { annot.text = node.innerText; });
      node.addEventListener("focus", () => setSelected(pageState.id, annot.id));
      node.addEventListener("blur", () => {
        annot.text = node.innerText;
        const unit = layout.scale * zoom;
        annot.w = Math.max(24, node.offsetWidth / unit);
        annot.h = Math.max(annot.size, node.offsetHeight / unit);
      });
    } else if (annot.type === "image") {
      const img = document.createElement("img");
      img.alt = "Added image";
      img.src = annot.dataUrl;
      node.appendChild(img);
    } else if (annot.type === "highlight") {
      node.classList.add("rect");
      node.style.background = colorWithAlpha(annot.color, 0.42);
    } else if (annot.type === "whiteout") {
      node.classList.add("rect");
      node.style.background = "#ffffff";
      node.style.boxShadow = "inset 0 0 0 1px #e5e5e5";
    }

    addHandles(node, pageState, annot, layout, zoom);
    layer.appendChild(node);

    node.addEventListener("pointerdown", (ev) => {
      if (ev.target.closest(".handle")) return;
      if (state.tool !== "select" && state.tool !== "text") ev.preventDefault();
      if (state.tool !== "select" && !(state.tool === "text" && ev.target === node)) {
        if (ev.target === node && state.tool === "text") {
          ev.stopPropagation();
          setSelected(pageState.id, annot.id);
          return;
        }
      }
      ev.stopPropagation();
      setSelected(pageState.id, annot.id);
      if (annot.type === "text" && ev.detail === 2) return;
      if (state.tool === "select" || ev.target === node) {
        if (annot.type !== "text" || ev.target !== node || ev.shiftKey) {
          beginMove(ev, pageState, annot, layout, zoom, node);
        } else if (annot.type !== "text") {
          beginMove(ev, pageState, annot, layout, zoom, node);
        } else if (document.activeElement !== node) {
          beginMove(ev, pageState, annot, layout, zoom, node);
        }
      }
    });
  }

  function colorWithAlpha(hex, a) {
    const n = hex.replace("#", "");
    const r = parseInt(n.length === 3 ? n[0] + n[0] : n.slice(0, 2), 16);
    const g = parseInt(n.length === 3 ? n[1] + n[1] : n.slice(2, 4), 16);
    const b = parseInt(n.length === 3 ? n[2] + n[2] : n.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }

  function pointsToPath(points) {
    if (!points.length) return "";
    return points.map((p, i) => (i ? "L" : "M") + p.x.toFixed(2) + " " + p.y.toFixed(2)).join(" ");
  }

  async function paintFormFields(layer, pdfPage, rotation, pageState, layout, zoom) {
    let annots = [];
    try { annots = await pdfPage.getAnnotations(); } catch (_) { return; }
    const vp1 = pdfPage.getViewport({ scale: 1, rotation });
    for (const field of annots) {
      if (field.subtype !== "Widget" || field.readOnly) continue;
      const rect = vp1.convertToViewportRectangle(field.rect);
      const cx = Math.min(rect[0], rect[2]);
      const cy = Math.min(rect[1], rect[3]);
      const cw = Math.abs(rect[2] - rect[0]);
      const ch = Math.abs(rect[3] - rect[1]);
      if (cw < 2 || ch < 2) continue;
      const name = field.fieldName || field.id || uid("field");
      const key = pageState.sourceId + ":" + name;
      const type = field.fieldType;
      let input;
      if (field.checkBox || type === "Btn" && field.checkBox) {
        input = document.createElement("input");
        input.type = "checkbox";
        input.checked = state.formValues[key] === "1" || field.fieldValue === "Yes" || field.fieldValue === "On";
        input.addEventListener("change", () => { pushUndo(); state.formValues[key] = input.checked ? "1" : "0"; });
      } else if (field.comboBox || field.listBox || type === "Ch") {
        input = document.createElement("select");
        const options = field.options || [];
        if (!options.length) {
          const opt = document.createElement("option");
          opt.value = field.fieldValue || "";
          opt.textContent = field.fieldValue || "";
          input.appendChild(opt);
        }
        for (const opt of options) {
          const o = document.createElement("option");
          o.value = opt.exportValue || opt.displayValue || opt;
          o.textContent = opt.displayValue || opt.exportValue || opt;
          input.appendChild(o);
        }
        input.value = state.formValues[key] != null ? state.formValues[key] : (field.fieldValue || "");
        input.addEventListener("change", () => { pushUndo(); state.formValues[key] = input.value; });
      } else {
        input = document.createElement("input");
        input.type = "text";
        input.value = state.formValues[key] != null ? state.formValues[key] : (field.fieldValue || "");
        input.addEventListener("focus", () => pushUndo());
        input.addEventListener("change", () => { state.formValues[key] = input.value; });
      }
      input.className = "form-field";
      input.dataset.testid = "form-" + name;
      applyContentStyle(input, cx, cy, Math.max(cw, 8), Math.max(ch, 8), layout, zoom);
      input.style.fontSize = Math.max(10, Math.min(16, ch * layout.scale * zoom * 0.7)) + "px";
      input.addEventListener("pointerdown", (ev) => ev.stopPropagation());
      layer.appendChild(input);
    }
  }

  function pointOnPage(ev, wrap, pageState) {
    const layout = pageLayout(pageState);
    const box = wrap.getBoundingClientRect();
    const paperX = (ev.clientX - box.left) / state.zoom;
    const paperY = (ev.clientY - box.top) / state.zoom;
    return {
      x: (paperX - layout.ox) / layout.scale,
      y: (paperY - layout.oy) / layout.scale,
      layout,
    };
  }

  function bindPagePointers(wrap, layer, pageState, layout, zoom) {
    wrap.addEventListener("pointerdown", (ev) => {
      if (ev.target.closest(".annot, .form-field, .handle, path")) return;
      setSelected(null, null);
      state.currentPageId = pageState.id;
      highlightThumb();
      syncPaperUi();

      if (state.tool === "text") {
        ev.preventDefault();
        const pt = pointOnPage(ev, wrap, pageState);
        pushUndo();
        const annot = {
          id: uid("annot"),
          type: "text",
          x: pt.x,
          y: pt.y,
          w: 160,
          h: state.fontSize * 1.4,
          text: "",
          size: state.fontSize,
          color: state.color,
        };
        pageState.annotations.push(annot);
        setTool("select");
        renderAll().then(() => {
          const node = els.viewer.querySelector(`.annot.text[data-annot-id="${annot.id}"]`);
          if (node) { node.focus(); setSelected(pageState.id, annot.id); }
        });
        return;
      }

      if (state.tool === "image") {
        ev.preventDefault();
        const pt = pointOnPage(ev, wrap, pageState);
        if (state.pendingImage) {
          placeImage(pageState, pt, state.pendingImage);
        } else {
          els.imageInput.onchange = async () => {
            const file = els.imageInput.files && els.imageInput.files[0];
            els.imageInput.value = "";
            if (!file) return;
            const dataUrl = await fileToDataUrl(file);
            const dims = await imageSize(dataUrl);
            placeImage(pageState, pt, { dataUrl, dims });
          };
          els.imageInput.click();
        }
        return;
      }

      if (state.tool === "draw") {
        ev.preventDefault();
        beginDraw(ev, wrap, layer, pageState);
        return;
      }

      if (state.tool === "highlight" || state.tool === "whiteout") {
        ev.preventDefault();
        beginRect(ev, wrap, layer, pageState, state.tool);
      }
    });
  }

  function placeImage(pageState, pt, payload) {
    pushUndo();
    const maxW = Math.min(pageState.visualWidth * 0.45, 220);
    const ratio = payload.dims.h / payload.dims.w || 1;
    const w = Math.min(maxW, payload.dims.w);
    const h = w * ratio;
    const annot = {
      id: uid("annot"),
      type: "image",
      x: Math.max(0, pt.x - w / 2),
      y: Math.max(0, pt.y - h / 2),
      w,
      h,
      dataUrl: payload.dataUrl,
    };
    pageState.annotations.push(annot);
    state.pendingImage = null;
    setTool("select");
    renderAll().then(() => setSelected(pageState.id, annot.id));
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  function imageSize(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve({ w: 200, h: 80 });
      img.src = dataUrl;
    });
  }

  function beginDraw(ev, wrap, layer, pageState) {
    pushUndo();
    wrap.setPointerCapture(ev.pointerId);
    const annot = {
      id: uid("annot"),
      type: "draw",
      points: [pointOnPage(ev, wrap, pageState)],
      color: state.color,
      width: state.strokeWidth,
    };
    pageState.annotations.push(annot);
    const svg = layer.querySelector("svg.draw-svg");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", annot.color);
    path.setAttribute("stroke-width", String(annot.width));
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);
    const move = (e) => {
      annot.points.push(pointOnPage(e, wrap, pageState));
      path.setAttribute("d", pointsToPath(annot.points));
    };
    const up = () => {
      wrap.releasePointerCapture(ev.pointerId);
      wrap.removeEventListener("pointermove", move);
      wrap.removeEventListener("pointerup", up);
      wrap.removeEventListener("pointercancel", up);
      if (annot.points.length < 2) {
        pageState.annotations.pop();
        path.remove();
      } else {
        renderAll().then(() => setSelected(pageState.id, annot.id));
      }
    };
    wrap.addEventListener("pointermove", move);
    wrap.addEventListener("pointerup", up);
    wrap.addEventListener("pointercancel", up);
  }

  function beginRect(ev, wrap, layer, pageState, kind) {
    const start = pointOnPage(ev, wrap, pageState);
    const layout = start.layout;
    const zoom = state.zoom;
    wrap.setPointerCapture(ev.pointerId);
    const ghost = document.createElement("div");
    ghost.className = "ghost-rect";
    if (kind === "highlight") ghost.style.background = colorWithAlpha(state.highlightColor, 0.42);
    else ghost.style.background = "rgba(255,255,255,0.9)";
    layer.appendChild(ghost);
    const move = (e) => {
      const pt = pointOnPage(e, wrap, pageState);
      const x = Math.min(start.x, pt.x);
      const y = Math.min(start.y, pt.y);
      const w = Math.abs(pt.x - start.x);
      const h = Math.abs(pt.y - start.y);
      applyContentStyle(ghost, x, y, w, h, layout, zoom);
    };
    const up = (e) => {
      wrap.releasePointerCapture(ev.pointerId);
      wrap.removeEventListener("pointermove", move);
      wrap.removeEventListener("pointerup", up);
      wrap.removeEventListener("pointercancel", up);
      ghost.remove();
      const pt = pointOnPage(e, wrap, pageState);
      const x = Math.min(start.x, pt.x);
      const y = Math.min(start.y, pt.y);
      const w = Math.abs(pt.x - start.x);
      const h = Math.abs(pt.y - start.y);
      if (w < 3 || h < 3) return;
      pushUndo();
      const annot = {
        id: uid("annot"),
        type: kind,
        x, y, w, h,
        color: kind === "highlight" ? state.highlightColor : "#ffffff",
      };
      pageState.annotations.push(annot);
      renderAll().then(() => setSelected(pageState.id, annot.id));
    };
    wrap.addEventListener("pointermove", move);
    wrap.addEventListener("pointerup", up);
    wrap.addEventListener("pointercancel", up);
  }

  function beginMove(ev, pageState, annot, layout, zoom, node) {
    ev.preventDefault();
    pushUndo();
    const start = { x: ev.clientX, y: ev.clientY };
    const unit = zoom * layout.scale;
    const orig = annot.type === "draw"
      ? { points: annot.points.map((p) => ({ x: p.x, y: p.y })) }
      : { x: annot.x, y: annot.y };
    const target = ev.currentTarget && ev.currentTarget.setPointerCapture
      ? ev.currentTarget
      : (node || ev.target);
    try { target.setPointerCapture(ev.pointerId); } catch (_) {}
    const move = (e) => {
      const dx = (e.clientX - start.x) / unit;
      const dy = (e.clientY - start.y) / unit;
      if (annot.type === "draw") {
        annot.points = orig.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
        const path = els.viewer.querySelector(`path[data-annot-id="${annot.id}"]`);
        if (path) path.setAttribute("d", pointsToPath(annot.points));
        const frame = els.viewer.querySelector(`.draw-frame[data-annot-id="${annot.id}"]`);
        if (frame) {
          const box = drawBBox(annot);
          applyContentStyle(frame, box.x, box.y, box.w, box.h, layout, zoom);
        }
      } else {
        annot.x = orig.x + dx;
        annot.y = orig.y + dy;
        if (node) applyContentStyle(node, annot.x, annot.y, annot.w, annot.h, layout, zoom);
      }
    };
    const up = () => {
      if (!target) return;
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  }

  function resizeBox(startBox, dir, dx, dy, minSize, keepRatio) {
    let { x, y, w, h } = startBox;
    if (dir.includes("e")) w = startBox.w + dx;
    if (dir.includes("s")) h = startBox.h + dy;
    if (dir.includes("w")) { x = startBox.x + dx; w = startBox.w - dx; }
    if (dir.includes("n")) { y = startBox.y + dy; h = startBox.h - dy; }

    if (keepRatio && startBox.w > 0 && startBox.h > 0 && /^(nw|ne|sw|se)$/.test(dir)) {
      const ratio = startBox.w / startBox.h;
      if (Math.abs(w / h - ratio) > 0.001) {
        if (Math.abs(dx) * startBox.h > Math.abs(dy) * startBox.w) {
          h = w / ratio;
          if (dir.includes("n")) y = startBox.y + startBox.h - h;
        } else {
          w = h * ratio;
          if (dir.includes("w")) x = startBox.x + startBox.w - w;
        }
      }
    }

    if (w < minSize) {
      if (dir.includes("w")) x = startBox.x + startBox.w - minSize;
      w = minSize;
    }
    if (h < minSize) {
      if (dir.includes("n")) y = startBox.y + startBox.h - minSize;
      h = minSize;
    }
    return { x, y, w, h };
  }

  function beginResize(ev, pageState, annot, layout, zoom, node, dir) {
    pushUndo();
    const unit = zoom * layout.scale;
    const isDraw = annot.type === "draw";
    const startBox = isDraw ? drawBBox(annot) : { x: annot.x, y: annot.y, w: annot.w, h: annot.h };
    const startPts = isDraw ? annot.points.map((p) => ({ x: p.x, y: p.y })) : null;
    const startSize = annot.size;
    const startWidth = annot.width;
    const startX = ev.clientX;
    const startY = ev.clientY;
    const keepRatio = annot.type === "image" || annot.type === "draw" || ev.shiftKey;
    const handleEl = ev.currentTarget;
    try { handleEl.setPointerCapture(ev.pointerId); } catch (_) {}
    const move = (e) => {
      const dx = (e.clientX - startX) / unit;
      const dy = (e.clientY - startY) / unit;
      const box = resizeBox(startBox, dir, dx, dy, 12, keepRatio);
      if (isDraw) {
        const sx = box.w / startBox.w;
        const sy = box.h / startBox.h;
        annot.points = startPts.map((p) => ({
          x: box.x + (p.x - startBox.x) * sx,
          y: box.y + (p.y - startBox.y) * sy,
        }));
        annot.width = Math.max(0.5, startWidth * (Math.abs(sx) + Math.abs(sy)) / 2);
        const path = els.viewer.querySelector(`path[data-annot-id="${annot.id}"]`);
        if (path) {
          path.setAttribute("d", pointsToPath(annot.points));
          path.setAttribute("stroke-width", String(annot.width));
        }
        applyContentStyle(node, box.x, box.y, box.w, box.h, layout, zoom);
      } else {
        annot.x = box.x;
        annot.y = box.y;
        annot.w = box.w;
        annot.h = box.h;
        if (annot.type === "text" && /^(nw|ne|sw|se)$/.test(dir)) {
          annot.size = Math.max(8, startSize * (box.h / startBox.h));
          node.style.fontSize = annot.size * layout.scale * zoom + "px";
        }
        applyContentStyle(node, annot.x, annot.y, annot.w, annot.h, layout, zoom);
      }
    };
    const up = () => {
      if (!handleEl) return;
      handleEl.removeEventListener("pointermove", move);
      handleEl.removeEventListener("pointerup", up);
      handleEl.removeEventListener("pointercancel", up);
    };
    handleEl.addEventListener("pointermove", move);
    handleEl.addEventListener("pointerup", up);
    handleEl.addEventListener("pointercancel", up);
  }

  function renderThumbs() {
    els.thumbs.innerHTML = "";
    state.pages.forEach((page, index) => {
      const btn = document.createElement("div");
      btn.className = "thumb" + (page.id === state.currentPageId ? " active" : "");
      btn.draggable = true;
      btn.dataset.pageId = page.id;
      btn.dataset.testid = "thumb-" + index;
      const c = document.createElement("canvas");
      btn.appendChild(c);
      const label = document.createElement("span");
      label.className = "thumb-label";
      label.textContent = String(index + 1);
      btn.appendChild(label);
      const moves = document.createElement("div");
      moves.className = "thumb-move";
      const up = document.createElement("button");
      up.type = "button";
      up.textContent = "↑";
      up.disabled = index === 0;
      up.dataset.testid = "page-up-" + index;
      const down = document.createElement("button");
      down.type = "button";
      down.textContent = "↓";
      down.disabled = index === state.pages.length - 1;
      down.dataset.testid = "page-down-" + index;
      up.addEventListener("click", (e) => { e.stopPropagation(); movePage(index, index - 1); });
      down.addEventListener("click", (e) => { e.stopPropagation(); movePage(index, index + 1); });
      moves.append(up, down);
      btn.appendChild(moves);
      btn.addEventListener("click", () => {
        state.currentPageId = page.id;
        highlightThumb();
        syncPaperUi();
        const wrap = els.viewer.querySelector(`.page-wrap[data-page-id="${page.id}"]`);
        if (wrap) wrap.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      btn.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", String(index));
        e.dataTransfer.effectAllowed = "move";
      });
      btn.addEventListener("dragover", (e) => { e.preventDefault(); });
      btn.addEventListener("drop", (e) => {
        e.preventDefault();
        const from = Number(e.dataTransfer.getData("text/plain"));
        if (!Number.isNaN(from)) movePage(from, index);
      });
      els.thumbs.appendChild(btn);
      drawThumb(page, c);
    });
  }

  async function drawThumb(pageState, canvas) {
    try {
      const source = sources.get(pageState.sourceId);
      const pdfPage = await source.pdfJsDoc.getPage(pageState.srcIndex + 1);
      const rotation = ((pdfPage.rotate || 0) + pageState.rotation + 360) % 360;
      const layout = pageLayout(pageState);
      const thumbScale = 110 / layout.paperW;
      canvas.width = Math.max(1, Math.round(layout.paperW * thumbScale));
      canvas.height = Math.max(1, Math.round(layout.paperH * thumbScale));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const vp = pdfPage.getViewport({ scale: thumbScale * layout.scale, rotation });
      await pdfPage.render({
        canvasContext: ctx,
        viewport: vp,
        transform: [1, 0, 0, 1, layout.ox * thumbScale, layout.oy * thumbScale],
      }).promise;
    } catch (_) { /* ignore thumbnail errors */ }
  }

  function highlightThumb() {
    els.thumbs.querySelectorAll(".thumb").forEach((t) => {
      t.classList.toggle("active", t.dataset.pageId === state.currentPageId);
    });
  }

  function movePage(from, to) {
    if (to < 0 || to >= state.pages.length || from === to) return;
    pushUndo();
    const [item] = state.pages.splice(from, 1);
    state.pages.splice(to, 0, item);
    state.currentPageId = item.id;
    renderAll();
    updateChrome();
  }

  async function rotateCurrent() {
    const page = pageById(state.currentPageId) || state.pages[0];
    if (!page) return;
    pushUndo();
    page.rotation = (page.rotation + 90) % 360;
    const source = sources.get(page.sourceId);
    const size = await visualSize(source, page.srcIndex, page.rotation);
    page.visualWidth = size.width;
    page.visualHeight = size.height;
    await renderAll();
    updateChrome();
  }

  function deleteCurrentPage() {
    if (!state.pages.length) return;
    const id = state.currentPageId || state.pages[0].id;
    const idx = state.pages.findIndex((p) => p.id === id);
    if (idx < 0) return;
    pushUndo();
    state.pages.splice(idx, 1);
    state.currentPageId = state.pages[Math.min(idx, state.pages.length - 1)]?.id || null;
    if (state.selected && !pageById(state.selected.pageId)) setSelected(null, null);
    renderAll();
    updateChrome();
  }

  function deleteSelectedAnnot() {
    if (!state.selected) return;
    const page = pageById(state.selected.pageId);
    if (!page) return;
    pushUndo();
    page.annotations = page.annotations.filter((a) => a.id !== state.selected.annotId);
    setSelected(null, null);
    renderAll();
  }

  function undo() {
    const snap = state.undoStack.pop();
    if (!snap) return;
    state.pages = snap.pages;
    state.formValues = snap.formValues;
    state.fileName = snap.fileName;
    state.currentPageId = snap.currentPageId;
    state.selected = null;
    renderAll();
    updateChrome();
  }

  function toWinAnsi(text) {
    return String(text || "")
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2013\u2014]/g, "-")
      .replace(/\u2026/g, "...")
      .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "?");
  }

  function wrapText(font, text, size, maxWidth) {
    const lines = [];
    for (const raw of toWinAnsi(text).split(/\n/)) {
      const words = raw.split(/(\s+)/);
      let line = "";
      for (const word of words) {
        const trial = line + word;
        if (font.widthOfTextAtSize(trial, size) <= maxWidth || !line) {
          line = trial;
        } else {
          lines.push(line);
          line = word.trimStart();
        }
      }
      lines.push(line);
    }
    return lines;
  }

  function drawEmbeddedPage(outPage, embedded, mediaW, mediaH, rot, dest) {
    const r = ((rot % 360) + 360) % 360;
    const x = dest.x;
    const y = dest.y;
    const dw = dest.width;
    const dh = dest.height;
    if (r === 0) {
      outPage.drawPage(embedded, { x, y, width: dw, height: dh });
    } else if (r === 90) {
      outPage.drawPage(embedded, { x: x + dw, y, width: dh, height: dw, rotate: degrees(90) });
    } else if (r === 180) {
      outPage.drawPage(embedded, { x: x + dw, y: y + dh, width: dw, height: dh, rotate: degrees(180) });
    } else if (r === 270) {
      outPage.drawPage(embedded, { x, y: y + dh, width: dh, height: dw, rotate: degrees(270) });
    }
  }

  function lookupName(dict, key) {
    if (!dict) return null;
    try { return dict.lookup(PDFName.of(key)); } catch (_) { return null; }
  }

  function asNumber(obj) {
    if (obj == null) return null;
    if (typeof obj.asNumber === "function") return obj.asNumber();
    if (typeof obj === "number") return obj;
    return null;
  }

  function listFilters(filter) {
    if (!filter) return [];
    const items = [];
    try {
      if (typeof filter.size === "function") {
        for (let i = 0; i < filter.size(); i++) items.push(filter.get(i));
      } else if (typeof filter.asArray === "function") {
        items.push(...filter.asArray());
      } else {
        items.push(filter);
      }
    } catch (_) {
      items.push(filter);
    }
    return items.map((item) => String(item || "").replace(/^\//, "").replace(/^PDFName\((.*)\)$/, "$1"));
  }

  function filterIs(filter, name) {
    return listFilters(filter).some((item) => item === name || item.includes(name));
  }

  function asciiHexDecode(bytes) {
    const s = (typeof bytes === "string" ? bytes : new TextDecoder("latin1").decode(bytes)).replace(/\s+/g, "");
    const out = [];
    for (let i = 0; i < s.length; i += 2) {
      const pair = (s[i] + (s[i + 1] || "0")).replace(/>/g, "");
      if (!pair || pair[0] === ">") break;
      out.push(parseInt(pair, 16));
    }
    return new Uint8Array(out);
  }

  function ascii85Decode(input) {
    let s = typeof input === "string" ? input : new TextDecoder("latin1").decode(input);
    s = s.replace(/\s/g, "");
    if (s.startsWith("<~")) s = s.slice(2);
    if (s.endsWith("~>")) s = s.slice(0, -2);
    const out = [];
    let i = 0;
    while (i < s.length) {
      if (s[i] === "z") { out.push(0, 0, 0, 0); i += 1; continue; }
      const remain = s.length - i;
      const take = Math.min(5, remain);
      let chunk = s.slice(i, i + take);
      i += take;
      const pad = 5 - chunk.length;
      while (chunk.length < 5) chunk += "u";
      let n = 0;
      for (const ch of chunk) n = n * 85 + (ch.charCodeAt(0) - 33);
      const bytes = [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
      out.push(...bytes.slice(0, 4 - pad));
    }
    return new Uint8Array(out);
  }

  function decodeExceptDct(contents, filters) {
    let bytes = contents instanceof Uint8Array ? contents : new Uint8Array(contents);
    for (const name of filters) {
      if (name === "DCTDecode" || name === "JPXDecode" || name === "JBIG2Decode" || name === "CCITTFaxDecode") continue;
      if (name === "ASCII85Decode") bytes = ascii85Decode(bytes);
      else if (name === "ASCIIHexDecode") bytes = asciiHexDecode(bytes);
    }
    return bytes;
  }

  function canvasToJpeg(canvas, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error("Could not encode image"));
        blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject);
      }, "image/jpeg", quality);
    });
  }

  function loadHtmlImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  async function jpegFromElement(img, maxDim, quality) {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const scale = Math.min(1, maxDim / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    const c = document.createElement("canvas");
    c.width = cw;
    c.height = ch;
    c.getContext("2d").drawImage(img, 0, 0, cw, ch);
    const bytes = await canvasToJpeg(c, quality);
    return { bytes, w: cw, h: ch };
  }

  async function compressDataUrl(dataUrl, maxDim, quality) {
    const img = await loadHtmlImage(dataUrl);
    const { bytes } = await jpegFromElement(img, maxDim, quality);
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return "data:image/jpeg;base64," + btoa(binary);
  }

  async function recompressDocImages(pdfDoc, { maxDim = 1400, quality = 0.72 } = {}) {
    if (!PDFName) return 0;
    let changed = 0;
    const seen = new Set();
    for (const page of pdfDoc.getPages()) {
      let resources;
      try { resources = page.node.Resources(); } catch (_) { continue; }
      if (!resources) continue;
      let xobj;
      try { xobj = resources.lookup(PDFName.of("XObject")); } catch (_) { continue; }
      if (!xobj || typeof xobj.entries !== "function") continue;
      for (const [name, ref] of xobj.entries()) {
        const key = String(ref);
        if (seen.has(key)) continue;
        seen.add(key);
        try {
          const stream = pdfDoc.context.lookup(ref);
          if (!stream || !stream.dict) continue;
          const dict = stream.dict;
          const subtype = lookupName(dict, "Subtype");
          if (subtype !== PDFName.of("Image")) continue;
          const width = asNumber(lookupName(dict, "Width"));
          const height = asNumber(lookupName(dict, "Height"));
          if (!width || !height) continue;
          const smask = lookupName(dict, "SMask") || lookupName(dict, "Mask");
          if (smask) continue;
          const filter = lookupName(dict, "Filter");
          const filters = listFilters(filter);
          const contents = typeof stream.getContents === "function" ? stream.getContents() : null;
          if (!contents || !contents.length) continue;
          const tooBig = Math.max(width, height) > maxDim || contents.length > 80 * 1024;
          if (!tooBig) continue;

          let dataUrl = null;
          if (filterIs(filter, "DCTDecode")) {
            let jpeg = contents instanceof Uint8Array ? contents : new Uint8Array(contents);
            if (!(jpeg[0] === 0xff && jpeg[1] === 0xd8)) {
              jpeg = decodeExceptDct(jpeg, filters);
            }
            if (!(jpeg[0] === 0xff && jpeg[1] === 0xd8)) continue;
            let binary = "";
            for (const b of jpeg) binary += String.fromCharCode(b);
            dataUrl = "data:image/jpeg;base64," + btoa(binary);
          } else {
            let decoded = contents;
            try {
              if (PDFLib.decodePDFRawStream) {
                decoded = PDFLib.decodePDFRawStream(stream).decode();
              }
            } catch (_) { decoded = contents; }
            const bpc = asNumber(lookupName(dict, "BitsPerComponent")) || 8;
            if (bpc !== 8) continue;
            const cs = lookupName(dict, "ColorSpace");
            const csName = String(cs || "");
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            const imageData = ctx.createImageData(width, height);
            const pixels = width * height;
            if (csName.includes("DeviceGray") && decoded.length >= pixels) {
              for (let i = 0, j = 0; i < pixels; i++) {
                const v = decoded[i];
                imageData.data[j++] = v;
                imageData.data[j++] = v;
                imageData.data[j++] = v;
                imageData.data[j++] = 255;
              }
            } else if (decoded.length >= pixels * 3) {
              for (let i = 0, j = 0; i < pixels; i++) {
                imageData.data[j++] = decoded[i * 3];
                imageData.data[j++] = decoded[i * 3 + 1];
                imageData.data[j++] = decoded[i * 3 + 2];
                imageData.data[j++] = 255;
              }
            } else {
              continue;
            }
            ctx.putImageData(imageData, 0, 0);
            dataUrl = canvas.toDataURL("image/png");
          }
          if (!dataUrl) continue;
          const img = await loadHtmlImage(dataUrl);
          const jpg = await jpegFromElement(img, maxDim, quality);
          const imgDict = pdfDoc.context.obj({
            Type: "XObject",
            Subtype: "Image",
            Width: jpg.w,
            Height: jpg.h,
            ColorSpace: "DeviceRGB",
            BitsPerComponent: 8,
            Filter: "DCTDecode",
            Length: jpg.bytes.length,
          });
          pdfDoc.context.assign(ref, PDFRawStream.of(imgDict, jpg.bytes));
          changed += 1;
        } catch (err) {
          console.warn("Could not compress an image", err);
        }
      }
    }
    return changed;
  }

  async function buildPdf(compress) {
    const prepared = new Map();
    for (const [id, source] of sources) {
      const doc = await PDFDocument.load(source.bytes.slice(), { ignoreEncryption: true });
      try {
        const form = doc.getForm();
        for (const field of form.getFields()) {
          const name = field.getName();
          const key = id + ":" + name;
          if (state.formValues[key] === undefined) continue;
          const value = state.formValues[key];
          try {
            const ctor = field.constructor && field.constructor.name;
            if (ctor === "PDFCheckBox" || field.check || field.isChecked) {
              if (value === "1") field.check(); else field.uncheck();
            } else if (ctor === "PDFDropdown" || ctor === "PDFRadioGroup" || ctor === "PDFOptionList" || field.select) {
              if (value) field.select(value);
            } else if (field.setText) {
              field.setText(toWinAnsi(value));
            }
          } catch (_) { /* skip field */ }
        }
        try { form.updateFieldAppearances(); } catch (_) {}
        try { form.flatten(); } catch (_) {}
      } catch (_) { /* no form */ }
      if (compress) {
        try { await recompressDocImages(doc); } catch (err) { console.warn(err); }
      }
      prepared.set(id, doc);
    }

    const out = await PDFDocument.create();
    const font = await out.embedFont(StandardFonts.Helvetica);

    for (const pageState of state.pages) {
      const src = prepared.get(pageState.sourceId);
      const srcPage = src.getPages()[pageState.srcIndex];
      const mediaW = srcPage.getWidth();
      const mediaH = srcPage.getHeight();
      const srcRot = srcPage.getRotation().angle || 0;
      const rot = (srcRot + pageState.rotation + 360) % 360;
      const layout = pageLayout(pageState);
      const [embedded] = await out.embedPages([srcPage]);
      const page = out.addPage([layout.paperW, layout.paperH]);
      const dest = {
        x: layout.ox,
        y: layout.paperH - layout.oy - layout.visH * layout.scale,
        width: layout.visW * layout.scale,
        height: layout.visH * layout.scale,
      };
      drawEmbeddedPage(page, embedded, mediaW, mediaH, rot, dest);

      const sx = layout.scale;
      const ax = (x) => layout.ox + x * sx;
      const ay = (y, h = 0) => layout.paperH - (layout.oy + (y + h) * sx);

      for (const annot of pageState.annotations) {
        if (annot.type === "highlight") {
          page.drawRectangle({
            x: ax(annot.x),
            y: ay(annot.y, annot.h),
            width: annot.w * sx,
            height: annot.h * sx,
            color: hexToRgb(annot.color || "#ffe566"),
            opacity: 0.42,
            blendMode: "Multiply",
          });
        } else if (annot.type === "whiteout") {
          page.drawRectangle({
            x: ax(annot.x),
            y: ay(annot.y, annot.h),
            width: annot.w * sx,
            height: annot.h * sx,
            color: rgb(1, 1, 1),
          });
        } else if (annot.type === "text") {
          const size = (annot.size || 16) * sx;
          const lines = wrapText(font, annot.text || "", size, Math.max(8, annot.w * sx));
          let y = ay(annot.y, 0) - size;
          for (const line of lines) {
            if (y < 0) break;
            try {
              page.drawText(line, {
                x: ax(annot.x),
                y,
                size,
                font,
                color: hexToRgb(annot.color || "#111827"),
              });
            } catch (_) { /* skip undrawable line */ }
            y -= size * 1.25;
          }
        } else if (annot.type === "draw" && annot.points.length > 1) {
          const d = annot.points.map((p, i) =>
            (i ? "L" : "M") + ax(p.x).toFixed(2) + " " + ay(p.y, 0).toFixed(2)
          ).join(" ");
          page.drawSvgPath(d, {
            borderColor: hexToRgb(annot.color || "#111827"),
            borderWidth: (annot.width || 2) * sx,
            borderOpacity: 1,
            borderLineCap: LineCapStyle.Round,
            borderLineJoin: LineJoinStyle.Round,
          });
        } else if (annot.type === "image" && annot.dataUrl) {
          let dataUrl = annot.dataUrl;
          if (compress) {
            try { dataUrl = await compressDataUrl(dataUrl, 1400, 0.72); } catch (_) {}
          }
          const img = await embedDataUrl(out, dataUrl);
          if (img) {
            page.drawImage(img, {
              x: ax(annot.x),
              y: ay(annot.y, annot.h),
              width: annot.w * sx,
              height: annot.h * sx,
            });
          }
        }
      }
    }
    return out.save();
  }

  async function embedDataUrl(doc, dataUrl) {
    try {
      const res = await fetch(dataUrl);
      const bytes = await res.arrayBuffer();
      if (dataUrl.startsWith("data:image/jpeg") || dataUrl.startsWith("data:image/jpg")) {
        return await doc.embedJpg(bytes);
      }
      if (dataUrl.startsWith("data:image/png")) {
        return await doc.embedPng(bytes);
      }
      const png = await rasterToPng(dataUrl);
      return await doc.embedPng(png);
    } catch (err) {
      console.error(err);
      return null;
    }
  }

  function rasterToPng(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext("2d").drawImage(img, 0, 0);
        c.toBlob((blob) => {
          if (!blob) return reject(new Error("Could not convert image"));
          blob.arrayBuffer().then(resolve, reject);
        }, "image/png");
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  async function download() {
    if (!state.pages.length) return;
    try {
      const compress = Boolean(els.compressChk.checked);
      showStatus(compress ? "Compressing and building your PDF…" : "Building your PDF…");
      const bytes = await buildPdf(compress);
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = state.fileName || "edited.pdf";
      a.dataset.testid = "download-link";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      const kb = Math.max(1, Math.round(bytes.length / 1024));
      showStatus("Download started · " + kb + " KB.");
    } catch (err) {
      console.error(err);
      showStatus(err.message || "Could not build the PDF.", true);
    }
  }

  function onFiles(files, merge) {
    const file = [...files].find((f) => /pdf/i.test(f.type) || /\.pdf$/i.test(f.name));
    if (!file) {
      showStatus("Please choose a PDF file.", true);
      return;
    }
    openPdf(file, merge);
  }

  /* Events */
  document.querySelectorAll(".tool[data-tool]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tool = btn.dataset.tool;
      setTool(tool);
      if (tool === "image") {
        els.imageInput.onchange = async () => {
          const file = els.imageInput.files && els.imageInput.files[0];
          els.imageInput.value = "";
          if (!file) { setTool("select"); return; }
          const dataUrl = await fileToDataUrl(file);
          const dims = await imageSize(dataUrl);
          state.pendingImage = { dataUrl, dims };
          showStatus("Tap the page to place your image.");
        };
        els.imageInput.click();
      }
    });
  });

  els.openBtn.addEventListener("click", () => els.fileInput.click());
  els.mergeBtn.addEventListener("click", () => els.mergeInput.click());
  els.fileInput.addEventListener("change", () => {
    if (els.fileInput.files[0]) onFiles(els.fileInput.files, false);
    els.fileInput.value = "";
  });
  els.mergeInput.addEventListener("change", () => {
    if (els.mergeInput.files[0]) onFiles(els.mergeInput.files, true);
    els.mergeInput.value = "";
  });
  els.downloadBtn.addEventListener("click", download);
  els.undoBtn.addEventListener("click", undo);
  els.deleteAnnotBtn.addEventListener("click", deleteSelectedAnnot);
  els.rotateBtn.addEventListener("click", rotateCurrent);
  els.deletePageBtn.addEventListener("click", deleteCurrentPage);
  els.pageSize.addEventListener("change", () => {
    if (syncingPaperUi) return;
    if ((els.pageSize.value === "letter" || els.pageSize.value === "a4")) {
      const page = pageById(state.currentPageId) || state.pages[0];
      if (page && !els.pageLandscape.matches(":focus")) {
        els.pageLandscape.checked = page.visualWidth > page.visualHeight;
      }
    }
    applyPaperFromUi();
  });
  els.pagePercent.addEventListener("change", applyPaperFromUi);
  els.pageLandscape.addEventListener("change", applyPaperFromUi);
  els.zoomIn.addEventListener("click", () => {
    state.zoom = Math.min(2.2, Math.round((state.zoom + 0.15) * 100) / 100);
    renderAll();
    updateChrome();
  });
  els.zoomOut.addEventListener("click", () => {
    state.zoom = Math.max(0.4, Math.round((state.zoom - 0.15) * 100) / 100);
    renderAll();
    updateChrome();
  });
  els.fontSize.addEventListener("change", () => {
    state.fontSize = Math.max(8, Math.min(96, Number(els.fontSize.value) || 16));
    if (state.selected) {
      const page = pageById(state.selected.pageId);
      const annot = annotById(page, state.selected.annotId);
      if (annot && annot.type === "text") {
        pushUndo();
        annot.size = state.fontSize;
        renderAll();
      }
    }
  });
  els.inkColor.addEventListener("input", () => {
    state.color = els.inkColor.value;
    if (state.selected) {
      const page = pageById(state.selected.pageId);
      const annot = annotById(page, state.selected.annotId);
      if (annot && (annot.type === "text" || annot.type === "draw")) {
        annot.color = state.color;
        renderAll();
      }
    }
  });
  els.highlightColor.addEventListener("input", () => {
    state.highlightColor = els.highlightColor.value;
  });
  els.strokeWidth.addEventListener("input", () => {
    state.strokeWidth = Number(els.strokeWidth.value) || 2.5;
  });

  document.addEventListener("keydown", (ev) => {
    const typing = ev.target && (ev.target.isContentEditable || /input|textarea|select/i.test(ev.target.tagName));
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z") {
      ev.preventDefault();
      undo();
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "s") {
      ev.preventDefault();
      download();
      return;
    }
    if (!typing && (ev.key === "Backspace" || ev.key === "Delete") && state.selected) {
      ev.preventDefault();
      deleteSelectedAnnot();
    }
    if (ev.key === "Escape") {
      setSelected(null, null);
      setTool("select");
    }
  });

  ["dragenter", "dragover"].forEach((name) => {
    window.addEventListener(name, (ev) => {
      ev.preventDefault();
      document.body.classList.add("dragover");
    });
  });
  ["dragleave", "drop"].forEach((name) => {
    window.addEventListener(name, (ev) => {
      ev.preventDefault();
      if (name === "drop" || ev.target === document.body) document.body.classList.remove("dragover");
    });
  });
  window.addEventListener("drop", (ev) => {
    document.body.classList.remove("dragover");
    if (ev.dataTransfer && ev.dataTransfer.files.length) {
      const merge = state.pages.length > 0 && ev.shiftKey;
      onFiles(ev.dataTransfer.files, merge);
    }
  });

  if (sessionStorage.getItem("pdf-editor-tip") === "hidden") {
    els.tip.hidden = true;
  }
  els.tipClose.addEventListener("click", () => {
    els.tip.hidden = true;
    sessionStorage.setItem("pdf-editor-tip", "hidden");
  });

  let resizeTick = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTick);
    resizeTick = setTimeout(() => { if (state.pages.length) renderAll(); }, 200);
  });

  setTool("select");
  updateChrome();
})();
