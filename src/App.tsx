import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { Document, Page, pdfjs } from 'react-pdf'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc

function App() {
  const [fileUrl, setFileUrl] = useState<string | null>(null)
  const [numPages, setNumPages] = useState<number | null>(null)
  const [pageNumber, setPageNumber] = useState<number>(1)
  const [scale, setScale] = useState<number>(1)
  const [rotation, setRotation] = useState<number>(0)
  const [isCropping, setIsCropping] = useState<boolean>(false)
  const [selection, setSelection] = useState<
    | { startX: number; startY: number; x: number; y: number; width: number; height: number; dragging: boolean }
    | null
  >(null)
  const [croppedDataUrl, setCroppedDataUrl] = useState<string | null>(null)
  const [selectionHistory, setSelectionHistory] = useState<
    Array<{ x: number; y: number; width: number; height: number }>
  >([])
  const [historyIndex, setHistoryIndex] = useState<number>(-1)
  const [thumbnails, setThumbnails] = useState<string[]>([])
  const objectUrlRef = useRef<string | null>(null)
  const pageViewportRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = null
      }
    }
  }, [])

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.type !== 'application/pdf') {
      alert('Please select a PDF file')
      return
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
    }
    const url = URL.createObjectURL(file)
    objectUrlRef.current = url
    setFileUrl(url)
    setNumPages(null)
    setPageNumber(1)
    setScale(1)
    setRotation(0)
    setIsCropping(false)
    setSelection(null)
    setCroppedDataUrl(null)
    setSelectionHistory([])
    setHistoryIndex(-1)
  }

  function onDocumentLoadSuccess({ numPages }: { numPages: number }) {
    setNumPages(numPages)
    setPageNumber(1)
    setThumbnails([])
  }

  useEffect(() => {
    if (!fileUrl || !numPages) return
    let isCancelled = false
    pdfjs.getDocument(fileUrl).promise.then(async (pdf: any) => {
      for (let i = 1; i <= numPages; i++) {
        try {
          const page = await pdf.getPage(i)
          const viewport = page.getViewport({ scale: 0.12 })
          const canvas = document.createElement('canvas')
          canvas.width = viewport.width
          canvas.height = viewport.height
          const ctx = canvas.getContext('2d')
          if (!ctx) continue
          await page.render({ canvasContext: ctx, viewport }).promise
          const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png', 0.2))
          if (blob) {
            const objectUrl = URL.createObjectURL(blob)
            if (!isCancelled) {
              setThumbnails((prev) => {
                const next = [...prev]
                next[i - 1] = objectUrl
                return next
              })
            }
          }
        } catch (err) {
          // skip on error
        }
      }
    })
    return () => {
      isCancelled = true
      setThumbnails([])
    }
  }, [fileUrl, numPages])

  const customRenderer = ({ pdf, pageNumber }: { pdf: any; pageNumber: number }) => {
    // Only generate thumbnail for sidebar
    const page = pdf.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 0.15 }) // small scale for low quality
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    return page.render({ canvasContext: ctx, viewport }).promise.then(() => canvas.toDataURL('image/png', 0.3))
  }

  const canGoPrev = useMemo(() => pageNumber > 1, [pageNumber])
  const canGoNext = useMemo(
    () => (numPages ? pageNumber < numPages : false),
    [pageNumber, numPages]
  )

  const baseWidth = 860
  const zoomOut = () => setScale((s) => Math.max(0.25, parseFloat((s - 0.1).toFixed(2))))
  const zoomIn = () => setScale((s) => Math.min(3, parseFloat((s + 0.1).toFixed(2))))
  const resetZoom = () => setScale(1)
  const rotateLeft = () => setRotation((r) => (r - 90 + 360) % 360)
  const rotateRight = () => setRotation((r) => (r + 90) % 360)
  const canUndo = historyIndex >= 0
  const canRedo = historyIndex < selectionHistory.length - 1 && selectionHistory.length > 0
  function undoSelection() {
    if (!canUndo) return
    const newIndex = historyIndex - 1
    setHistoryIndex(newIndex)
    if (newIndex >= 0) {
      const rect = selectionHistory[newIndex]
      setSelection({ startX: rect.x, startY: rect.y, x: rect.x, y: rect.y, width: rect.width, height: rect.height, dragging: false })
    } else {
      setSelection(null)
    }
  }
  function redoSelection() {
    if (!canRedo) return
    const newIndex = historyIndex + 1
    const rect = selectionHistory[newIndex]
    setHistoryIndex(newIndex)
    setSelection({ startX: rect.x, startY: rect.y, x: rect.x, y: rect.y, width: rect.width, height: rect.height, dragging: false })
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!isCropping) return
    const container = pageViewportRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    setSelection({ startX: x, startY: y, x, y, width: 0, height: 0, dragging: true })
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!isCropping || !selection?.dragging) return
    const container = pageViewportRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const x = Math.min(Math.max(e.clientX - rect.left, 0), rect.width)
    const y = Math.min(Math.max(e.clientY - rect.top, 0), rect.height)
    const sx = selection.startX
    const sy = selection.startY
    const nx = Math.min(sx, x)
    const ny = Math.min(sy, y)
    const nw = Math.abs(x - sx)
    const nh = Math.abs(y - sy)
    setSelection({ ...selection, x: nx, y: ny, width: nw, height: nh })
  }

  function handlePointerUp() {
    if (!isCropping || !selection) return
    const finalized = { ...selection, dragging: false }
    setSelection(finalized)
    setSelectionHistory((prev) => {
      const normalized = { x: finalized.x, y: finalized.y, width: finalized.width, height: finalized.height }
      const next = historyIndex >= 0 && historyIndex < prev.length - 1 ? prev.slice(0, historyIndex + 1) : prev.slice()
      next.push(normalized)
      return next
    })
    setHistoryIndex((i) => {
      const nextIndex = i >= 0 ? i + 1 : 0
      return nextIndex
    })
  }

  function performCrop() {
    if (!selection || selection.width < 2 || selection.height < 2) return
    const container = pageViewportRef.current
    if (!container) return
    const canvas = container.querySelector('canvas') as HTMLCanvasElement | null
    if (!canvas) return
    const canvasRect = canvas.getBoundingClientRect()
    // Intersection of selection with canvas rect in client px
    const sel = selection
    const containerRect = container.getBoundingClientRect()
    const selAbs = {
      left: containerRect.left + sel.x,
      top: containerRect.top + sel.y,
      right: containerRect.left + sel.x + sel.width,
      bottom: containerRect.top + sel.y + sel.height
    }
    const interLeft = Math.max(selAbs.left, canvasRect.left)
    const interTop = Math.max(selAbs.top, canvasRect.top)
    const interRight = Math.min(selAbs.right, canvasRect.right)
    const interBottom = Math.min(selAbs.bottom, canvasRect.bottom)
    const interW = interRight - interLeft
    const interH = interBottom - interTop
    if (interW <= 1 || interH <= 1) return

    const scaleX = canvas.width / canvasRect.width
    const scaleY = canvas.height / canvasRect.height
    const sx = (interLeft - canvasRect.left) * scaleX
    const sy = (interTop - canvasRect.top) * scaleY
    const sw = interW * scaleX
    const sh = interH * scaleY

    const out = document.createElement('canvas')
    out.width = Math.max(1, Math.floor(sw))
    out.height = Math.max(1, Math.floor(sh))
    const ctx = out.getContext('2d')
    if (!ctx) return
    ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, out.width, out.height)
    const url = out.toDataURL('image/png')
    setCroppedDataUrl(url)
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: 16 }}>
      <h1>Upload and View PDF</h1>
      <input
        type="file"
        accept="application/pdf"
        onChange={handleFileChange}
        style={{ marginBottom: 16 }}
      />

      {fileUrl ? (
        <Document
          file={fileUrl}
          onLoadSuccess={onDocumentLoadSuccess}
          onLoadError={(e) => console.error(e)}
        >
          <div style={{ display: 'flex', gap: 16 }}>
            <aside
              style={{
                width: 150,
                maxHeight: '75vh',
                overflowY: 'auto',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                padding: 8
              }}
            >
              {numPages ? (
                Array.from({ length: numPages }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    onClick={() => setPageNumber(n)}
                    style={{
                      display: 'block',
                      width: '100%',
                      background: 'transparent',
                      border: 'none',
                      padding: 0,
                      marginBottom: 8,
                      cursor: 'pointer',
                      outline: 'none'
                    }}
                    aria-label={`Go to page ${n}`}
                  >
                    <div
                      style={{
                        border: n === pageNumber ? '2px solid #3b82f6' : '1px solid #e5e7eb',
                        borderRadius: 6,
                        padding: 4,
                        background: '#fff'
                      }}
                    >
                      {thumbnails[n - 1] ? (
                        <img src={thumbnails[n - 1]} alt={`Thumbnail page ${n}`} style={{ width: 120, height: 'auto', display: 'block', filter: 'blur(0.5px)' }} />
                      ) : (
                        <div style={{ width: 120, height: 160, background: '#f3f4f6', color: '#6b7280', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading…</div>
                      )}
                      <div style={{ textAlign: 'center', fontSize: 12, marginTop: 4 }}>Page {n}</div>
                    </div>
                  </button>
                ))
              ) : (
                <div style={{ padding: 8, color: '#6b7280' }}>Loading thumbnails…</div>
              )}
            </aside>

            <section style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                <button onClick={() => setPageNumber((p) => Math.max(p - 1, 1))} disabled={!canGoPrev}>
                  Prev
                </button>
                <span>
                  Page {pageNumber}
                  {numPages ? ` / ${numPages}` : ''}
                </span>
                <button
                  onClick={() => setPageNumber((p) => (numPages ? Math.min(p + 1, numPages) : p))}
                  disabled={!canGoNext}
                >
                  Next
                </button>

                <span style={{ marginLeft: 12, marginRight: 4 }}>|</span>
                <button onClick={zoomOut} aria-label="Zoom out">-</button>
                <span>{Math.round(scale * 100)}%</span>
                <button onClick={zoomIn} aria-label="Zoom in">+</button>
                <button onClick={resetZoom} aria-label="Reset zoom">Reset</button>

                <span style={{ marginLeft: 12, marginRight: 4 }}>|</span>
                <button onClick={rotateLeft} aria-label="Rotate left">⟲</button>
                <button onClick={rotateRight} aria-label="Rotate right">⟳</button>
              </div>
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8, overflow: 'auto', maxHeight: '75vh' }}>
                <div
                  ref={pageViewportRef}
                  style={{ position: 'relative', display: 'inline-block' }}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                >
                  <Page
                    pageNumber={pageNumber}
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                    width={Math.round(baseWidth * scale)}
                    rotate={rotation}
                  />
                  {isCropping && selection && (
                    <div
                      style={{
                        position: 'absolute',
                        left: selection.x,
                        top: selection.y,
                        width: selection.width,
                        height: selection.height,
                        border: '2px solid #3b82f6',
                        background: 'rgba(59,130,246,0.1)',
                        pointerEvents: 'none'
                      }}
                    />
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <button onClick={() => { setIsCropping((v) => !v); }} aria-pressed={isCropping}>
                  {isCropping ? 'Exit crop' : 'Crop mode'}
                </button>
                <button onClick={undoSelection} disabled={!canUndo}>
                  Undo
                </button>
                <button onClick={redoSelection} disabled={!canRedo}>
                  Redo
                </button>
                <button onClick={() => { setSelection(null); setCroppedDataUrl(null); }} disabled={!isCropping && !selection}>
                  Clear selection
                </button>
                <button onClick={performCrop} disabled={!selection || (selection.width < 2 || selection.height < 2)}>
                  Crop selection
                </button>
                {rotation !== 0 && (
                  <span style={{ color: '#6b7280' }}>(Cropping also works when rotated)</span>
                )}
              </div>

              {croppedDataUrl && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
                    <strong>Crop preview</strong>
                    <a href={croppedDataUrl} download={`crop-page-${pageNumber}.png`} style={{ textDecoration: 'underline', color: '#2563eb' }}>
                      Download PNG
        </a>
      </div>
                  <img src={croppedDataUrl} alt="Cropped selection preview" style={{ maxWidth: '100%', height: 'auto', border: '1px solid #e5e7eb', borderRadius: 6 }} />
                </div>
              )}
            </section>
          </div>
        </Document>
      ) : (
        <p>Select a PDF to preview.</p>
      )}
      </div>
  )
}

export default App
