import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

let activePortalCount = 0;
let previousBodyOverflow = '';

interface ModalPortalProps {
  children: React.ReactNode;
  lockScroll?: boolean;
}

/**
 * Portals modal overlays directly to document.body so fixed full-viewport
 * backdrops always span 100vw × 100vh over sidebars and headers without
 * ever being clipped by ancestor layout containers. Uses ref-counted body
 * scroll locking so stacked modals restore scroll cleanly when all close.
 */
export const ModalPortal: React.FC<ModalPortalProps> = ({
  children,
  lockScroll = true,
}) => {
  useEffect(() => {
    if (!lockScroll || typeof document === 'undefined') return;

    if (activePortalCount === 0) {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    activePortalCount += 1;

    return () => {
      activePortalCount = Math.max(0, activePortalCount - 1);
      if (activePortalCount === 0) {
        document.body.style.overflow = previousBodyOverflow;
      }
    };
  }, [lockScroll]);

  if (typeof document === 'undefined') return null;
  return createPortal(children, document.body);
};
