import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MaximizeIcon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";
import { Button } from "../ui/button";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";
import { ZoomableImage, type ZoomableImageHandle } from "./ZoomableImage";

interface ExpandedImageDialogProps {
  preview: ExpandedImagePreview;
  onClose: () => void;
}

const ZOOM_STEP = 1.5;

export const ExpandedImageDialog = memo(function ExpandedImageDialog({
  preview,
  onClose,
}: ExpandedImageDialogProps) {
  const [imageOffset, setImageOffset] = useState(0);
  const [zoom, setZoom] = useState(1);
  const zoomableImageRef = useRef<ZoomableImageHandle>(null);
  const index = (preview.index + imageOffset + preview.images.length) % preview.images.length;

  const navigateImage = useCallback((direction: -1 | 1) => {
    setImageOffset((current) => current + direction);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      // A zoomed image owns the arrow keys for panning; gallery navigation
      // resumes once it is back to fit.
      if (zoomableImageRef.current?.pan(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (preview.images.length <= 1) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        event.stopPropagation();
        navigateImage(-1);
        return;
      }
      if (event.key !== "ArrowRight") return;
      event.preventDefault();
      event.stopPropagation();
      navigateImage(1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigateImage, onClose, preview.images.length]);

  const item = preview.images[index];
  if (!item) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4 py-6 [-webkit-app-region:no-drag]"
      role="dialog"
      aria-modal="true"
      aria-label="图片预览"
    >
      <button
        type="button"
        className="absolute inset-0 z-0 cursor-zoom-out"
        aria-label="关闭图片预览"
        onClick={onClose}
      />
      {preview.images.length > 1 && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="absolute left-2 top-1/2 z-20 -translate-y-1/2 text-white/90 hover:bg-white/10 hover:text-white sm:left-6"
          aria-label="上一张"
          onClick={() => navigateImage(-1)}
        >
          <ChevronLeftIcon className="size-5" />
        </Button>
      )}
      <div className="relative isolate z-10 flex max-h-[92vh] max-w-[92vw] flex-col items-center [--media-width:92vw] sm:[--media-width:calc(92vw-96px)]">
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="absolute right-2 top-2 z-10 bg-background/70 backdrop-blur-sm"
          onClick={onClose}
          aria-label="关闭图片预览"
        >
          <XIcon />
        </Button>
        <ZoomableImage
          ref={zoomableImageRef}
          key={`${index}:${item.src}`}
          src={item.src}
          name={item.name}
          onZoomChange={setZoom}
        />
        <div className="mt-2 flex max-w-[92vw] items-center gap-2 text-xs text-white/80">
          <span className="min-w-0 truncate">
            {item.name}
            {preview.images.length > 1 ? ` (${index + 1}/${preview.images.length})` : ""}
          </span>
          <span className="flex shrink-0 items-center gap-0.5 rounded-md bg-black/40 px-1 py-0.5">
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              className="text-white/90 hover:bg-white/10 hover:text-white"
              aria-label="缩小"
              title="缩小（-）"
              disabled={zoom <= 1}
              onClick={() => zoomableImageRef.current?.zoomBy(1 / ZOOM_STEP)}
            >
              <ZoomOutIcon />
            </Button>
            <span className="w-11 text-center tabular-nums" aria-hidden>
              {Math.round(zoom * 100)}%
            </span>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              className="text-white/90 hover:bg-white/10 hover:text-white"
              aria-label="放大"
              title="放大（+），也可以滚动鼠标滚轮"
              disabled={zoom >= 8}
              onClick={() => zoomableImageRef.current?.zoomBy(ZOOM_STEP)}
            >
              <ZoomInIcon />
            </Button>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              className="text-white/90 hover:bg-white/10 hover:text-white"
              aria-label="适应窗口"
              title="适应窗口（0）"
              disabled={zoom <= 1}
              onClick={() => zoomableImageRef.current?.reset()}
            >
              <MaximizeIcon />
            </Button>
          </span>
        </div>
      </div>
      {preview.images.length > 1 && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="absolute right-2 top-1/2 z-20 -translate-y-1/2 text-white/90 hover:bg-white/10 hover:text-white sm:right-6"
          aria-label="下一张"
          onClick={() => navigateImage(1)}
        >
          <ChevronRightIcon className="size-5" />
        </Button>
      )}
    </div>
  );
});
