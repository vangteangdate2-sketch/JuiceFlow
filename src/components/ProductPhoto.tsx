import React, { useState } from 'react';
import {
  Citrus,
  Coffee,
  Cookie,
  CupSoda,
  GlassWater,
  Leaf,
  Package,
} from 'lucide-react';
import type { ProductCategory } from '../types';

interface ProductPhotoProps {
  src: string;
  alt: string;
  category?: ProductCategory;
  className?: string;
}

const CATEGORY_PLACEHOLDER_STYLES: Record<
  ProductCategory,
  {
    bg: string;
    iconBg: string;
    iconColor: string;
    Icon: React.ComponentType<{ className?: string }>;
  }
> = {
  juice: {
    bg: 'bg-amber-50/85',
    iconBg: 'bg-white/80',
    iconColor: 'text-amber-600',
    Icon: Citrus,
  },
  smoothie: {
    bg: 'bg-rose-50/85',
    iconBg: 'bg-white/80',
    iconColor: 'text-rose-500',
    Icon: CupSoda,
  },
  coffee: {
    bg: 'bg-orange-50/80',
    iconBg: 'bg-white/80',
    iconColor: 'text-amber-800',
    Icon: Coffee,
  },
  tea: {
    bg: 'bg-emerald-50/85',
    iconBg: 'bg-white/80',
    iconColor: 'text-[#0D5C3E]',
    Icon: Leaf,
  },
  packaged: {
    bg: 'bg-sky-50/85',
    iconBg: 'bg-white/80',
    iconColor: 'text-sky-600',
    Icon: Package,
  },
  snack: {
    bg: 'bg-yellow-50/85',
    iconBg: 'bg-white/80',
    iconColor: 'text-amber-700',
    Icon: Cookie,
  },
  specialty: {
    bg: 'bg-teal-50/85',
    iconBg: 'bg-white/80',
    iconColor: 'text-teal-700',
    Icon: GlassWater,
  },
};

export const ProductPhoto: React.FC<ProductPhotoProps> = ({
  src,
  alt,
  category,
  className = 'w-full h-36',
}) => {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    const style = category
      ? CATEGORY_PLACEHOLDER_STYLES[category]
      : {
          bg: 'bg-stone-100',
          iconBg: 'bg-white/80',
          iconColor: 'text-stone-400',
          Icon: CupSoda,
        };
    const Icon = style.Icon;

    return (
      <div
        role="img"
        aria-label={alt}
        className={`${className} ${style.bg} flex items-center justify-center select-none`}
      >
        <div
          className={`w-11 h-11 rounded-full ${style.iconBg} flex items-center justify-center shadow-2xs`}
        >
          <Icon className={`w-5 h-5 ${style.iconColor}`} />
        </div>
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
