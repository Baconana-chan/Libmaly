import { useCallback, useEffect, useMemo, useState } from "preact/hooks";

export function useVirtualList<T>(
  items: T[],
  getHeight: (item: T) => number,
  overscan = 5,
) {
  const [scrollTop, setScrollTop] = useState(0);
  const [containerH, setContainerH] = useState(600);
  const [containerEl, setContainerEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!containerEl) return;
    const onScroll = () => setScrollTop(containerEl.scrollTop);
    const ro = new ResizeObserver(() => setContainerH(containerEl.clientHeight));
    containerEl.addEventListener("scroll", onScroll, { passive: true });
    ro.observe(containerEl);
    setContainerH(containerEl.clientHeight);
    return () => { containerEl.removeEventListener("scroll", onScroll); ro.disconnect(); };
  }, [containerEl]);

  const state = useMemo(() => {
    if (items.length === 0) return { virtualItems: [], totalHeight: 0, offsetTop: 0 };

    const offsets = new Array<number>(items.length + 1);
    offsets[0] = 0;
    for (let i = 0; i < items.length; i++) {
      offsets[i + 1] = offsets[i] + getHeight(items[i]);
    }
    const totalHeight = offsets[items.length];

    const top = Math.max(0, scrollTop);
    const bottom = top + containerH;

    let start = 0;
    let end = items.length - 1;
    let lo = 0, hi = items.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (offsets[mid + 1] < top) lo = mid + 1;
      else hi = mid - 1;
    }
    start = Math.max(0, lo - overscan);
    lo = start; hi = items.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (offsets[mid] < bottom) lo = mid + 1;
      else hi = mid - 1;
    }
    end = Math.min(items.length - 1, lo + overscan);

    return {
      virtualItems: items.slice(start, end + 1).map((item, i) => ({
        item,
        index: start + i,
        offsetTop: offsets[start + i],
      })),
      totalHeight,
      offsetTop: offsets[start],
    };
  }, [items, getHeight, scrollTop, containerH, overscan]); // eslint-disable-line

  const scrollToIndex = useCallback((index: number) => {
    if (!containerEl || index < 0 || index >= items.length) return;
    const offsets = new Array<number>(items.length + 1);
    offsets[0] = 0;
    for (let i = 0; i < items.length; i++) offsets[i + 1] = offsets[i] + getHeight(items[i]);

    const top = offsets[index];
    const bottom = offsets[index + 1];
    if (top < containerEl.scrollTop) {
      containerEl.scrollTop = top;
    } else if (bottom > containerEl.scrollTop + containerEl.clientHeight) {
      containerEl.scrollTop = bottom - containerEl.clientHeight;
    }
  }, [items, getHeight, containerEl]);

  return { ...state, scrollToIndex, containerRef: setContainerEl };
}
