'use client';
import { useState } from 'react';
import { ProductArt } from '../../product-art';
import css from '../../storefront.module.css';

export function Gallery({ images, name, category, brand = '' }: { images: { id: string; src: string }[]; name: string; category: string; brand?: string }) {
  const [i, setI] = useState(0);
  const cur = images[i];
  return (
    <div className={css.gallery}>
      <div className={css.mainPic} style={cur ? { backgroundImage: `url(${cur.src})` } : undefined} role="img" aria-label={cur ? `รูปสินค้า ${name}` : `ภาพประกอบ ${name}`}>
        {!cur && <ProductArt cat={category} brand={brand} label="" />}
      </div>
      {images.length > 1 && (
        <div className={css.thumbs} role="group" aria-label="รูปสินค้า">
          {images.map((im, k) => (
            <button key={im.id} type="button" className={css.thumb} style={{ backgroundImage: `url(${im.src})` }}
              aria-pressed={k === i} aria-label={`รูปที่ ${k + 1}`} onClick={() => setI(k)} />
          ))}
        </div>
      )}
    </div>
  );
}
