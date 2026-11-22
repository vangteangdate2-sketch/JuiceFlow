import React, { useState } from 'react';
import { CupSoda } from 'lucide-react';

interface ProductPhotoProps {
  src: string;
  alt: string;
  className?: string;
}

export const ProductPhoto: React.FC<ProductPhotoProps> = ({ src, alt, className = 'w-full h-36' }) => {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div
        className={`${className} bg-stone-100 flex flex-col items-center justify-center text-stone-400 select-none`}
        aria-label={alt}
      >
        <CupSoda className="w-7 h-7 mb-1.5 text-stone-400" />
        <span className="text-xs text-stone-500 px-3 text-center truncate max-w-full">{alt}</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`${className} object-cover bg-stone-100`}
    />
  );
};
