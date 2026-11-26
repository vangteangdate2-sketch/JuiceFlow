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

interface ProductPhotoProps {
  src: string;
  alt: string;
  category?: string;
  className?: string;
}

const CATEGORY_PLACEHOLDER_STYLES: Record<
  string,
  {
    bg: string;
    iconBg: string;
    iconColor: string;
    Icon: React.ComponentType<{ className?: string }>;
  }
> = {
  juice: {
    bg: 'bg-amber-50/85 dark:bg-amber-950/35',
    iconBg: 'bg-white/80 dark:bg-[#131D18]/90',
    iconColor: 'text-amber-600 dark:text-amber-400',
    Icon: Citrus,
  },
  smoothie: {
    bg: 'bg-rose-50/85 dark:bg-rose-950/35',
    iconBg: 'bg-white/80 dark:bg-[#131D18]/90',
    iconColor: 'text-rose-500 dark:text-rose-400',
    Icon: CupSoda,
  },
  coffee: {
    bg: 'bg-orange-50/80 dark:bg-orange-950/35',
    iconBg: 'bg-white/80 dark:bg-[#131D18]/90',
    iconColor: 'text-amber-800 dark:text-amber-300',
    Icon: Coffee,
  },
  tea: {
    bg: 'bg-emerald-50/85 dark:bg-emerald-950/40',
    iconBg: 'bg-white/80 dark:bg-[#131D18]/90',
    iconColor: 'text-[#0D5C3E] dark:text-[#34D399]',
    Icon: Leaf,
  },
  packaged: {
    bg: 'bg-sky-50/85 dark:bg-sky-950/35',
    iconBg: 'bg-white/80 dark:bg-[#131D18]/90',
    iconColor: 'text-sky-600 dark:text-sky-400',
    Icon: Package,
  },
  snack: {
    bg: 'bg-yellow-50/85 dark:bg-yellow-950/35',
    iconBg: 'bg-white/80 dark:bg-[#131D18]/90',
    iconColor: 'text-amber-700 dark:text-yellow-300',
    Icon: Cookie,
  },
  specialty: {
    bg: 'bg-teal-50/85 dark:bg-teal-950/40',
    iconBg: 'bg-white/80 dark:bg-[#131D18]/90',
    iconColor: 'text-teal-700 dark:text-teal-300',
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
    const style =
      (category && CATEGORY_PLACEHOLDER_STYLES[category]) || {
        bg: 'bg-stone-100 dark:bg-[#18251F]',
        iconBg: 'bg-white/80 dark:bg-[#131D18]/90',
        iconColor: 'text-stone-400 dark:text-[#94A39B]',
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
          className={`w-11 h-11 rounded-full ${style.iconBg} flex items-center justify-center shadow-2xs border border-transparent dark:border-[#24352C]`}
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
      className={`${className} object-cover bg-stone-100 dark:bg-[#18251F]`}
    />
  );
};
