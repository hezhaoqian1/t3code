/**
 * A transparent strip across the top of a page without a header (login,
 * loading, error pages). The desktop window is frameless, so without it those
 * pages can't be dragged; the window buttons stay native on top.
 *
 * It spans the nearest positioned parent: the whole page on full-screen pages,
 * or the main area beside the sidebar, where it never covers the sidebar's own
 * buttons.
 */
export function WindowDragStrip() {
  return (
    <div
      aria-hidden
      data-window-drag-strip="true"
      className="drag-region absolute inset-x-0 top-0 z-40 h-10"
    />
  );
}
